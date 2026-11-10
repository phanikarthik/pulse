"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { castVote } from "@/lib/data";
import { fmt } from "@/lib/format";
import { fmtDistance, getPosition, type Position } from "@/lib/geo";
import { ensureSession, fetchLivePoll, REPORT_REASONS, reportPoll, type LivePoll, type ReportReason } from "@/lib/live";

/** Faster while results are moving on screen, slower while just waiting. */
const REFRESH_RESULTS_MS = 4_000;
const REFRESH_IDLE_MS = 10_000;

export function LivePollView({ code }: { code: string }) {
  const [poll, setPoll] = useState<LivePoll | null | undefined>(undefined);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setPoll(await fetchLivePoll(code));
      setError("");
    } catch (e) {
      setError((e as { message?: string }).message || "Couldn't load this poll.");
    }
  }, [code]);

  useEffect(() => {
    ensureSession().then(load, (e) =>
      setError(/anonymous/i.test(e?.message ?? "")
        ? "Pulse Live isn't switched on yet. Please tell the host."
        : "Couldn't connect. Check your internet and refresh."));
  }, [load]);

  const showing = !!poll?.results;
  useEffect(() => {
    if (!poll || poll.status === "closed") return;
    const t = setInterval(load, showing ? REFRESH_RESULTS_MS : REFRESH_IDLE_MS);
    return () => clearInterval(t);
  }, [poll, showing, load]);

  if (error) return <Shell><div className="card empty" role="alert">{error}</div></Shell>;
  if (poll === undefined) return <Shell><div className="skeleton" style={{ height: 320 }} /></Shell>;
  if (poll === null) {
    return (
      <Shell>
        <div className="card empty">
          <strong style={{ color: "var(--text)", fontSize: "1.2rem" }}>No live poll with code {code}</strong>
          <span>Check the code on the screen. The poll may not have started yet, or may have been removed.</span>
          <Link href="/live" className="btn btn-sm" style={{ marginTop: "0.5rem" }}>Enter a different code</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="question-head">
        <div className="q-meta">
          <span className="tag">Pulse Live · {poll.code}</span>
          <span className="tag">{poll.topic}</span>
          {!poll.open && <span className="tag tag-closed">{poll.status === "closed" ? "Closed" : "Paused"}</span>}
        </div>
        <h1>{poll.body}</h1>
      </header>
      {poll.myOption || !poll.open ? null : <LiveVoteForm poll={poll} onVoted={load} />}
      {poll.myOption && !poll.results && (
        <div className="card empty">
          <strong style={{ color: "var(--text)" }}>Vote counted ✓</strong>
          <span>
            You chose <b>{poll.options.find((o) => o.id === poll.myOption)?.label}</b>.{" "}
            {poll.resultsMode === "presenter" ? "Watch the presenter's screen for results." : "Results will appear here."}
          </span>
        </div>
      )}
      {!poll.myOption && !poll.open && !poll.results && (
        <div className="card empty">
          <strong style={{ color: "var(--text)" }}>{poll.status === "closed" ? "Voting has closed" : "Voting is paused"}</strong>
          <span>{poll.status === "closed" ? "This poll isn't taking votes any more." : "Check back in a moment."}</span>
        </div>
      )}
      {poll.results && <LiveResults poll={poll} />}
      <ReportPoll questionId={poll.id} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="container-narrow page live-page">{children}</div>;
}

function LiveVoteForm({ poll, onVoted }: { poll: LivePoll; onVoted: () => Promise<void> }) {
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "locating" | "voting">("");
  const legend = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!choice) return setError("Choose an option first.");
    let at: Position | undefined;
    if (poll.geo) {
      setBusy("locating");
      try {
        at = await getPosition();
      } catch (err) {
        setError((err as Error).message);
        setBusy("");
        return;
      }
    }
    setBusy("voting");
    const res = await castVote(poll.id, choice, at);
    if (!res.ok) {
      setError(res.error);
      setBusy("");
      return;
    }
    await onVoted();
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: "1.25rem" }}>
      {poll.geo && (
        <p className="geo-note">
          <span aria-hidden="true">📍</span>
          <span>
            Only people within <b>{fmtDistance(poll.geo.radiusM)}</b> of <b>{poll.geo.label}</b> can vote. Your phone will ask to
            share your location; Pulse checks the distance and keeps nothing.
          </span>
        </p>
      )}
      <fieldset className="options" aria-labelledby={legend}>
        <legend id={legend} className="sr-only">Your answer</legend>
        {poll.options.map((o) => (
          <label key={o.id} className="option">
            <input type="radio" name="option" value={o.id} checked={choice === o.id}
              onChange={() => { setChoice(o.id); setError(""); }} />
            <span className="option-face">
              <span className="option-radio" aria-hidden="true" />
              {o.label}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="vote-row">
        <button className="btn btn-pulse" disabled={!!busy}>
          {busy === "locating" ? "Finding your location…" : busy ? "Counting…" : poll.geo ? "Share location & vote" : "Vote"}
        </button>
        <span className="locked-note">Anonymous · one vote · final</span>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <p className="hint">
        No account needed. By voting you agree to Pulse&apos;s <Link href="/terms">Terms</Link> and{" "}
        <Link href="/privacy">Privacy Policy</Link>. Nobody, including the host, can see how you voted.
      </p>
    </form>
  );
}

function LiveResults({ poll }: { poll: LivePoll }) {
  const total = poll.results!.reduce((n, r) => n + r.votes, 0);
  return (
    <section className="results" aria-labelledby="live-results-h">
      <h2 id="live-results-h" className="sr-only">Results</h2>
      <ul className="bars">
        {poll.options.map((o, i) => {
          const votes = poll.results!.find((r) => r.optionId === o.id)?.votes ?? 0;
          const pct = total ? Math.round((votes / total) * 100) : 0;
          return (
            <li key={o.id} className="bar-row" data-mine={o.id === poll.myOption}>
              <div className="bar-label">
                <span>
                  {o.label}
                  {o.id === poll.myOption && <span className="mine-badge">Your vote</span>}
                </span>
                <b>{pct}%</b>
              </div>
              <div className="bar-track" role="img" aria-label={`${o.label}: ${pct}% (${fmt(votes)} votes)`}>
                <div className="bar-fill" style={{ ["--p" as string]: pct / 100, ["--i" as string]: i }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="total">
        {fmt(total)} {total === 1 ? "vote" : "votes"}
        {poll.open ? " · updates live" : " · final result"}
      </p>
    </section>
  );
}

/** Anyone can flag a poll once; the Pulse team reviews it. Nothing is hidden automatically. */
function ReportPoll({ questionId }: { questionId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const id = useId();

  if (sent) return <p className="hint" role="status">Thanks for reporting. The Pulse team will review this poll.</p>;
  if (!open) {
    return (
      <p>
        <button type="button" className="link-btn hint" onClick={() => setOpen(true)}>Report this poll</button>
      </p>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return setError("Choose a reason.");
    setBusy(true);
    const res = await reportPoll(questionId, reason, detail.trim());
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSent(true);
  };

  return (
    <form className="card admin-form" onSubmit={submit} noValidate aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} style={{ fontSize: "1.1rem" }}>Report this poll</h2>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-only">Reason</legend>
        <div className="mode-list">
          {REPORT_REASONS.map((r) => (
            <label key={r.reason} className="checkbox">
              <input type="radio" name={`${id}-reason`} checked={reason === r.reason} onChange={() => { setReason(r.reason); setError(""); }} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-d`}>Anything else? <span className="hint">(optional)</span></label>
        <textarea id={`${id}-d`} className="textarea" maxLength={300} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="vote-row">
        <button className="btn btn-sm" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
