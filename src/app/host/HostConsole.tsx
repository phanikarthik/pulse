"use client";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { useProfile } from "@/components/SessionProvider";
import { fmt, relative } from "@/lib/format";
import {
  applyToHost,
  hostCreatePoll,
  hostDeletePoll,
  hostSetStatus,
  joinUrl,
  useHostPolls,
  type HostPoll,
} from "@/lib/live";
import type { ResultsMode } from "@/lib/types";

const MAX_BODY = 160;

export const RESULTS_MODES: { mode: ResultsMode; label: string; hint: string }[] = [
  { mode: "after_vote", label: "After they vote", hint: "Each person sees results once they've voted." },
  { mode: "live", label: "Live for everyone", hint: "Results show on every phone, even before voting." },
  { mode: "presenter", label: "Presenter screen only", hint: "Phones never show results; you reveal them on screen." },
];

type Res = { ok: true } | { ok: false; error: string };

export function HostConsole() {
  const profile = useProfile()!;
  if (!profile.isHost) return <ApplyPanel />;
  return <Polls userId={profile.id} />;
}

function Polls({ userId }: { userId: string }) {
  const { data, error, reload } = useHostPolls(userId);
  /** Runs a host action, then reloads. Returns the error, or "". */
  const act = async (fn: () => Promise<Res>) => {
    const res = await fn();
    await reload();
    return res.ok ? "" : res.error;
  };

  if (error) return <div className="container page"><div className="card empty" role="alert">{error}</div></div>;
  if (!data) return <div className="container page"><div className="skeleton" style={{ height: 260 }} /></div>;

  const open = data.polls.filter((p) => p.status === "open").length;
  return (
    <div className="container page">
      <div className="section-head">
        <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.4rem)" }}>Your live polls</h1>
      </div>
      {data.info.livePollsPaused && (
        <div className="admin-banner" role="status">Pulse Live is paused by the Pulse team. Polls won&apos;t take votes until it resumes.</div>
      )}
      <p className="hint">
        {open} of {data.info.maxActivePolls} open polls · up to {fmt(data.info.maxVotersPerPoll)} voters per poll. You see
        totals only, never who voted.
      </p>
      <div className="admin-grid">
        <NewPollForm act={act} />
        <div style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
          {data.polls.length === 0 ? (
            <div className="card empty">No polls yet. Create one, then share its code or QR code with the room.</div>
          ) : (
            data.polls.map((p) => <PollCard key={p.id} p={p} act={act} />)
          )}
        </div>
      </div>
    </div>
  );
}

type Act = (fn: () => Promise<Res>) => Promise<string>;

function PollCard({ p, act }: { p: HostPoll; act: Act }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const run = async (fn: () => Promise<Res>) => {
    setBusy(true);
    setError(await act(fn));
    setBusy(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl(p.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. The link is " + joinUrl(p.code));
    }
  };
  const blocked = p.moderation !== "ok";

  return (
    <article className="card admin-q">
      <div className="q-meta">
        <span className={`tag ${p.status === "open" ? "tag-voted" : p.status === "closed" ? "tag-closed" : ""}`}>
          {p.status === "draft" ? "not started" : p.status}
        </span>
        {p.moderation === "awaiting_approval" && <span className="tag tag-alert">Waiting for Pulse approval</span>}
        {p.moderation === "hidden" && <span className="tag tag-alert">Removed by Pulse</span>}
        <span className="tag">{p.topic}</span>
        <span>{fmt(p.voters)} {p.voters === 1 ? "vote" : "votes"} · created {relative(p.createdAt)}</span>
      </div>
      <p style={{ fontWeight: 620, fontSize: "1.05rem" }}>{p.body}</p>
      <p className="join-code-line">Code <b>{p.code}</b></p>
      <div className="mini-bars">
        {p.options.map((o) => {
          const pct = p.voters ? Math.round((o.votes / p.voters) * 100) : 0;
          return (
            <div key={o.id} className="mini-bar">
              <span>{o.label}</span>
              <b style={{ textAlign: "right" }}>{pct}%</b>
              <div className="mini-bar-track"><div style={{ ["--p" as string]: pct / 100 }} /></div>
            </div>
          );
        })}
      </div>
      <div className="admin-q-actions">
        {!blocked && <Link className="btn btn-sm btn-pulse" href={`/host/${p.id}`}>Presenter screen</Link>}
        <Link className="btn btn-sm btn-ghost" href={`/host/${p.id}/results`}>Results</Link>
        {p.status === "draft" && <button className="btn btn-sm" disabled={busy} onClick={() => run(() => hostSetStatus(p.id, "open"))}>Start voting</button>}
        {p.status === "open" && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => hostSetStatus(p.id, "closed"))}>Close voting</button>}
        {p.status === "closed" && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => hostSetStatus(p.id, "open"))}>Reopen</button>}
        {!blocked && <button className="btn btn-sm btn-ghost" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>}
        <button className="btn btn-sm btn-danger" disabled={busy}
          onClick={() => confirm("Delete this poll and all its votes? This can't be undone.") && run(() => hostDeletePoll(p.id))}>
          Delete
        </button>
      </div>
      {p.moderation === "awaiting_approval" && (
        <p className="hint">Polls about politics or elections go live once the Pulse team approves them.</p>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </article>
  );
}

function NewPollForm({ act }: { act: Act }) {
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [mode, setMode] = useState<ResultsMode>("after_vote");
  const [sensitive, setSensitive] = useState(false);
  const [startNow, setStartNow] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!body.trim() || body.length > MAX_BODY) return setError(`Question must be 1–${MAX_BODY} characters.`);
    if (opts.length < 2) return setError("Add at least two options.");
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return setError("Options must be different.");
    setError("");
    setBusy(true);
    const err = await act(() =>
      hostCreatePoll({ topic: topic.trim() || "Live", body: body.trim(), options: opts, sensitive, resultsMode: mode, open: startNow }),
    );
    setBusy(false);
    if (err) return setError(err);
    setBody(""); setTopic(""); setOptions(["", ""]); setSensitive(false);
    setDone(true);
    setTimeout(() => setDone(false), 3000);
  };

  return (
    <form className="card admin-form" onSubmit={submit} noValidate aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} style={{ fontSize: "1.3rem" }}>New live poll</h2>
      <div className="field">
        <label htmlFor={`${id}-body`}>Question</label>
        <textarea id={`${id}-body`} className="textarea" value={body} onChange={(e) => setBody(e.target.value)}
          aria-describedby={`${id}-count`} placeholder="Which topic should we cover next?" />
        <span id={`${id}-count`} className="counter" data-over={body.length > MAX_BODY}>{body.length}/{MAX_BODY}</span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-topic`}>Label <span className="hint">(optional, e.g. your event or class)</span></label>
        <input id={`${id}-topic`} className="input" maxLength={32} value={topic} onChange={(e) => setTopic(e.target.value)} />
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Options (2–4)</legend>
        <div className="option-inputs" style={{ marginTop: "0.4rem" }}>
          {options.map((o, i) => (
            <div key={i} className="option-input-row">
              <input className="input" aria-label={`Option ${i + 1}`} maxLength={60} value={o}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
              <button type="button" className="icon-btn" aria-label={`Remove option ${i + 1}`} disabled={options.length <= 2}
                onClick={() => setOptions(options.filter((_, j) => j !== i))} style={{ opacity: options.length <= 2 ? 0.35 : 1 }}>×</button>
            </div>
          ))}
          {options.length < 4 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOptions([...options, ""])}>+ Add option</button>
          )}
        </div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Who sees the results?</legend>
        <div className="mode-list">
          {RESULTS_MODES.map((m) => (
            <label key={m.mode} className="checkbox">
              <input type="radio" name={`${id}-mode`} checked={mode === m.mode} onChange={() => setMode(m.mode)} />
              <span><b>{m.label}</b> <span className="hint">{m.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="checkbox">
        <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
        <span>This poll is about <b>politics or elections</b> <span className="hint">(the Pulse team approves it before it goes live)</span></span>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
        <span>Start voting straight away</span>
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn btn-pulse" disabled={busy}>{busy ? "Creating…" : "Create poll"}</button>
      <p aria-live="polite" className="hint">{done ? "Created. Open its presenter screen to show the code and QR code." : ""}</p>
    </form>
  );
}

/** Members who aren't hosts: apply, or see where their application stands. */
function ApplyPanel() {
  const profile = useProfile()!;
  const [org, setOrg] = useState("");
  const [note, setNote] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const id = useId();
  const status = sent ? "pending" : profile.hostStatus;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 20) return setError("Tell us a little more (at least 20 characters).");
    if (!agree) return setError("Please agree to the host rules.");
    setError("");
    setBusy(true);
    const res = await applyToHost(org.trim(), note.trim());
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSent(true);
  };

  if (status === "pending" || status === "suspended") {
    return (
      <div className="container-narrow">
        <div className="card gate">
          <span className="tag">Pulse Live</span>
          <h1>{status === "pending" ? "Application received" : "Hosting suspended"}</h1>
          <p>
            {status === "pending"
              ? "Thanks. The Pulse team reviews every application. Once you're approved, a Pulse Live button appears at the top of the page."
              : "Your hosting has been suspended by the Pulse team, and your polls aren't taking votes. Contact the Pulse team if you think this is a mistake."}
          </p>
          <Link href="/dashboard" className="btn btn-sm">Back to questions</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container-narrow page">
      <h1 style={{ fontSize: "clamp(2rem, 6vw, 2.8rem)" }}>Run live polls with Pulse Live</h1>
      <p className="hint">
        Put a question on screen, and your room votes from their phones in seconds by scanning a QR code. No accounts
        needed for your audience. Hosting is by approval.
        {profile.role === "admin" && " As the owner, you can also add yourself under Admin → Hosts & switches."}
      </p>
      {status === "rejected" && (
        <p className="hint">Your last application wasn't approved. You can apply again 30 days after that decision.</p>
      )}
      <form className="card admin-form" onSubmit={submit} noValidate aria-labelledby={`${id}-h`}>
        <h2 id={`${id}-h`} style={{ fontSize: "1.3rem" }}>Apply to host</h2>
        <div className="field">
          <label htmlFor={`${id}-o`}>Organisation <span className="hint">(optional)</span></label>
          <input id={`${id}-o`} className="input" maxLength={80} placeholder="e.g. RV College, Prestige RWA"
            value={org} onChange={(e) => setOrg(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-n`}>How would you use Pulse Live?</label>
          <textarea id={`${id}-n`} className="textarea" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Quick polls in my lectures for about 120 students." aria-describedby={`${id}-c`} />
          <span id={`${id}-c`} className="counter">{note.length}/500</span>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I agree to the <Link href="/terms#host-rules">host rules</Link>.</span>
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn btn-pulse" disabled={busy}>{busy ? "Sending…" : "Send application"}</button>
      </form>
    </div>
  );
}
