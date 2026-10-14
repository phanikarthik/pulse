"use client";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { PulseLine } from "@/components/Logo";
import { useProfile } from "@/components/SessionProvider";
import { castVote, fetchResults, isVotable, markSeen, MIN_GROUP, useVoterData } from "@/lib/data";
import { fmt, relative } from "@/lib/format";
import type { Question, Results } from "@/lib/types";

const REFRESH_RESULTS_MS = 20_000;

export function QuestionView({ id }: { id: string }) {
  const profile = useProfile()!;
  const { data, error, reload } = useVoterData();
  // Drafts are hidden from voters, even from an admin's 2FA session.
  const q = data?.questions.find((x) => x.id === id && x.status !== "draft");
  const voted = !!data?.votes[id];
  const results = useResults(id, voted, !!q && isVotable(q));

  useEffect(() => {
    if (q) markSeen(profile.id, q.id);
  }, [q, profile.id]);

  if (error) {
    return (
      <div className="container-narrow page">
        <div className="card empty" role="alert">
          <strong style={{ color: "var(--text)" }}>Couldn&apos;t load this question</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }
  if (!data || (voted && !results)) {
    return <div className="container-narrow page"><div className="skeleton" style={{ height: 320 }} /></div>;
  }

  if (!q) {
    return (
      <div className="container-narrow page">
        <div className="card empty">
          <strong style={{ color: "var(--text)", fontSize: "1.2rem" }}>Question not found</strong>
          <span>It may have been removed, or isn&apos;t live yet.</span>
          <Link href="/dashboard" className="btn btn-sm" style={{ marginTop: "0.5rem" }}>Back to questions</Link>
        </div>
      </div>
    );
  }

  const open = isVotable(q);

  return (
    <div className="container-narrow page">
      <Link href="/dashboard" className="back">← All questions</Link>
      <header className="question-head">
        <div className="q-meta">
          <span className="tag">{q.topic}</span>
          {!open ? (
            <span className="tag tag-closed">Closed</span>
          ) : (
            <span>{q.closesAt ? `Closes ${relative(q.closesAt)}` : "Open"}</span>
          )}
        </div>
        <h1>{q.body}</h1>
      </header>
      {results ? (
        <ResultsView q={q} r={results} open={open} />
      ) : open ? (
        <VoteForm q={q} onVoted={reload} />
      ) : (
        <div className="card empty">
          <strong style={{ color: "var(--text)" }}>Voting has closed</strong>
          <span>Results are only shown to people who voted while this question was open.</span>
        </div>
      )}
    </div>
  );
}

/** Results once I've voted: loaded from the database and refreshed while voting is open. */
function useResults(questionId: string, voted: boolean, open: boolean) {
  const [results, setResults] = useState<Results | null>(null);
  useEffect(() => {
    if (!voted) return setResults(null);
    let cancelled = false;
    const load = () =>
      fetchResults(questionId)
        .then((r) => !cancelled && setResults(r))
        .catch(() => {}); // keep the last results on a failed refresh
    load();
    const timer = open ? setInterval(load, REFRESH_RESULTS_MS) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [questionId, voted, open]);
  return results;
}

function VoteForm({ q, onVoted }: { q: Question; onVoted: () => Promise<void> }) {
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const legend = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!choice) return setError("Choose an option first.");
    setBusy(true);
    const res = await castVote(q.id, choice);
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    await onVoted(); // reloads my votes, which unlocks the results
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: "1.25rem" }}>
      <fieldset className="options" aria-labelledby={legend}>
        <legend id={legend} className="sr-only">Your answer</legend>
        {[...q.options].sort((a, b) => a.position - b.position).map((o) => (
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
        <button className="btn btn-pulse" disabled={busy}>{busy ? "Counting…" : "Cast my vote"}</button>
        <span className="locked-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          Results unlock after you vote. Votes are final.
        </span>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </form>
  );
}

function useCountUp(target: number, ms = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(target);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function ResultsView({ q, r, open }: { q: Question; r: Results; open: boolean }) {
  const agree = useCountUp(r.agreePct);
  const [copied, setCopied] = useState(false);
  const mine = r.options.find((o) => o.optionId === r.myOptionId)!;

  const shareText = `I voted "${mine.label}" on Pulse — ${r.agreePct}% agree with me. "${q.body}"`;
  const url = typeof window !== "undefined" ? `${window.location.origin}/q/${q.id}` : "";
  const xHref = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;

  const copy = async () => {
    const text = `${q.body}\n${r.options.map((o) => `${o.label}: ${o.pct}%`).join("\n")}\nI voted "${mine.label}" — ${r.agreePct}% agree with me.\n${url}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="results" aria-labelledby="results-h">
      <h2 id="results-h" className="sr-only">Results</h2>
      <div className="card agree">
        <PulseLine />
        <span className="agree-num" aria-hidden="true">{agree}<span>%</span></span>
        <p>agree with you — you voted <strong>{mine.label}</strong>.</p>
        <span className="sr-only">{r.agreePct}% agree with you.</span>
      </div>

      <ul className="bars">
        {r.options.map((o, i) => (
          <li key={o.optionId} className="bar-row" data-mine={o.optionId === r.myOptionId}>
            <div className="bar-label">
              <span>
                {o.label}
                {o.optionId === r.myOptionId && <span className="mine-badge">Your vote</span>}
              </span>
              <b>{o.pct}%</b>
            </div>
            <div className="bar-track" role="img" aria-label={`${o.label}: ${o.pct}% (${fmt(o.votes)} votes)`}>
              <div className="bar-fill" style={{ ["--p" as string]: o.pct / 100, ["--i" as string]: i }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="total">{fmt(r.total)} {r.total === 1 ? "vote" : "votes"} so far{open ? " · updates automatically" : " · final result"}</p>

      <div className="share-row">
        <a className="btn" href={xHref} target="_blank" rel="noopener noreferrer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
          Share on X
        </a>
        <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? "Copied ✓" : "Copy result"}</button>
        <span aria-live="polite" className="sr-only">{copied ? "Result copied to clipboard" : ""}</span>
      </div>

      <div className="card breakdown">
        <h2>Who agrees with you, by age</h2>
        <div className="age-grid">
          {r.byAge.map((g) => (
            <div key={g.band} className="age-col">
              <b>{g.pct === null ? "—" : `${g.pct}%`}</b>
              <div className="age-bar" data-hidden={g.pct === null}
                role="img" aria-label={g.pct === null ? `${g.band}: hidden, fewer than ${MIN_GROUP} voters` : `${g.band}: ${g.pct}% agree`}>
                {g.pct !== null && <div style={{ ["--p" as string]: g.pct / 100 }} />}
              </div>
              <span>{g.band}</span>
            </div>
          ))}
        </div>
        <p className="hint">Groups with fewer than {MIN_GROUP} voters are hidden to protect privacy.</p>
      </div>
    </section>
  );
}
