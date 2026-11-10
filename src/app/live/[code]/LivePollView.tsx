"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { castVote } from "@/lib/data";
import { fmt } from "@/lib/format";
import { ensureSession, fetchLivePoll, type LivePoll } from "@/lib/live";

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
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="container-narrow page live-page">{children}</div>;
}

function LiveVoteForm({ poll, onVoted }: { poll: LivePoll; onVoted: () => Promise<void> }) {
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const legend = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!choice) return setError("Choose an option first.");
    setBusy(true);
    const res = await castVote(poll.id, choice);
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    await onVoted();
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: "1.25rem" }}>
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
        <button className="btn btn-pulse" disabled={busy}>{busy ? "Counting…" : "Vote"}</button>
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
