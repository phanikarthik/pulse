"use client";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import {
  adminCreateQuestion,
  adminDeleteQuestion,
  adminSetStatus,
  adminTotals,
  canUseConsole,
  demoBecomeAdmin,
  useStore,
  verifyAdmin2fa,
} from "@/lib/demo-store";
import { useProfile } from "@/components/SessionProvider";
import { fmt, relative } from "@/lib/format";
import type { Question, QuestionStatus } from "@/lib/types";

const MAX_BODY = 160;

export function AdminConsole() {
  const s = useStore();
  const profile = useProfile();
  if (!s) return <div className="container page"><div className="skeleton" style={{ height: 260 }} /></div>;
  if (!profile || !canUseConsole(s, profile.role)) return <NotAuthorised signedIn={!!profile} />;
  if (!s.adminVerified) return <TwoFactor />;
  return <Console />;
}

function NotAuthorised({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="container-narrow">
      <div className="card gate">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--pulse)" strokeWidth="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        <h1>Not authorised</h1>
        <p>This area is for the Pulse team only.</p>
        <Link href={signedIn ? "/dashboard" : "/"} className="btn btn-sm">{signedIn ? "Back to questions" : "Go to Pulse"}</Link>
        {signedIn && (
          <details style={{ marginTop: "1.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer" }}>Preview build: view the admin console</summary>
            <p style={{ margin: "0.75rem auto", maxWidth: "44ch" }}>
              In production the admin role is granted only by the owner, directly in the database. This preview lets
              you try the console with sample data.
            </p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={demoBecomeAdmin}>Preview as admin</button>
          </details>
        )}
      </div>
    </div>
  );
}

function TwoFactor() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  return (
    <div className="container-narrow">
      <form
        className="card gate"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!verifyAdmin2fa(code)) setError("Enter the 6-digit code from your authenticator app.");
        }}
      >
        <span className="tag">Step 2 of 2</span>
        <h1>Confirm it&apos;s you</h1>
        <p>Admin actions need a two-factor verified session. Enter the code from your authenticator app.</p>
        <div className="field" style={{ width: "min(100%, 280px)" }}>
          <label htmlFor={id} className="sr-only">Authenticator code</label>
          <input id={id} className="input otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-invalid={!!error} aria-describedby={error ? `${id}-e` : `${id}-h`} autoFocus />
          {error ? <span id={`${id}-e`} className="error-text">{error}</span> : <span id={`${id}-h`} className="hint">Preview: any 6 digits.</span>}
        </div>
        <button className="btn btn-pulse">Verify</button>
      </form>
    </div>
  );
}

function Console() {
  const s = useStore()!;
  const [view, setView] = useState<QuestionStatus | "all">("all");
  const list = s.questions.filter((q) => view === "all" || q.status === view);
  return (
    <div className="container page">
      <div className="admin-banner" role="note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
        Admin · 2FA verified · every action is recorded in the audit log
      </div>
      <div className="admin-grid">
        <NewQuestionForm />
        <div style={{ display: "grid", gap: "1.25rem", alignContent: "start" }}>
          <div className="section-head">
            <h2>Questions</h2>
            <div className="filters" role="group" aria-label="Filter by status">
              {(["all", "open", "draft", "closed"] as const).map((v) => (
                <button key={v} type="button" className={`btn btn-sm ${view === v ? "" : "btn-ghost"}`}
                  aria-pressed={view === v} onClick={() => setView(v)}>
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {list.length === 0 ? (
            <div className="card empty">No {view} questions.</div>
          ) : (
            list.map((q) => <AdminQuestion key={q.id} q={q} />)
          )}
          <div className="section-head"><h2>Audit log</h2></div>
          {s.audit.length === 0 ? (
            <p className="hint">No admin actions yet in this session.</p>
          ) : (
            <ul className="audit">
              {s.audit.slice(0, 12).map((a) => (
                <li key={a.id}>
                  <b>{a.action}</b>
                  <span>{a.detail} · {relative(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminQuestion({ q }: { q: Question }) {
  const s = useStore()!;
  const totals = adminTotals(s, q);
  const total = totals.reduce((n, o) => n + o.votes, 0);
  return (
    <article className="card admin-q">
      <div className="q-meta">
        <span className={`tag ${q.status === "open" ? "tag-voted" : q.status === "closed" ? "tag-closed" : ""}`}>{q.status}</span>
        <span className="tag">{q.topic}</span>
        <span>{fmt(total)} votes</span>
        {q.closesAt && <span>· closes {relative(q.closesAt)}</span>}
      </div>
      <p style={{ fontWeight: 620, fontSize: "1.05rem" }}>{q.body}</p>
      <div className="mini-bars">
        {totals.map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
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
        {q.status === "draft" && <button className="btn btn-sm" onClick={() => adminSetStatus(q.id, "open")}>Publish</button>}
        {q.status === "open" && <button className="btn btn-sm btn-ghost" onClick={() => adminSetStatus(q.id, "closed")}>Close</button>}
        {q.status === "closed" && <button className="btn btn-sm btn-ghost" onClick={() => adminSetStatus(q.id, "open")}>Reopen</button>}
        <Link className="btn btn-sm btn-ghost" href={`/q/${q.id}`}>View</Link>
        <button className="btn btn-sm btn-danger"
          onClick={() => confirm("Delete this question and all its votes? This can't be undone.") && adminDeleteQuestion(q.id)}>
          Delete
        </button>
      </div>
    </article>
  );
}

function NewQuestionForm() {
  const [topic, setTopic] = useState("");
  const [body, setBody] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [status, setStatus] = useState<QuestionStatus>("open");
  const [closesAt, setClosesAt] = useState("");
  const [error, setError] = useState("");
  const [posted, setPosted] = useState(false);
  const id = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!topic.trim()) return setError("Add a topic.");
    if (!body.trim() || body.length > MAX_BODY) return setError(`Question text must be 1–${MAX_BODY} characters.`);
    if (opts.length < 2) return setError("Add at least two options.");
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return setError("Options must be different.");
    if (closesAt && new Date(closesAt).getTime() <= Date.now()) return setError("Close time must be in the future.");
    adminCreateQuestion({
      topic: topic.trim(),
      body: body.trim(),
      options: opts,
      status,
      closesAt: closesAt ? new Date(closesAt).toISOString() : null,
    });
    setTopic(""); setBody(""); setOptions(["", ""]); setClosesAt(""); setError("");
    setPosted(true);
    setTimeout(() => setPosted(false), 3000);
  };

  return (
    <form className="card admin-form" onSubmit={submit} noValidate aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} style={{ fontSize: "1.3rem" }}>Post a question</h2>
      <div className="field">
        <label htmlFor={`${id}-topic`}>Topic</label>
        <input id={`${id}-topic`} className="input" maxLength={32} placeholder="e.g. Economy" value={topic} onChange={(e) => setTopic(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-body`}>Question</label>
        <textarea id={`${id}-body`} className="textarea" value={body} onChange={(e) => setBody(e.target.value)}
          aria-describedby={`${id}-count`} />
        <span id={`${id}-count`} className="counter" data-over={body.length > MAX_BODY}>{body.length}/{MAX_BODY}</span>
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
        <legend>Status</legend>
        <div className="chips" style={{ marginTop: "0.4rem" }}>
          {(["draft", "open", "closed"] as QuestionStatus[]).map((v) => (
            <label key={v} className="chip">
              <input type="radio" name="status" checked={status === v} onChange={() => setStatus(v)} />
              <span>{v[0].toUpperCase() + v.slice(1)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-close`}>Close time <span className="hint">(optional)</span></label>
        <input id={`${id}-close`} className="input" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn btn-pulse">{status === "open" ? "Post question" : "Save question"}</button>
      <p aria-live="polite" className="hint">{posted ? "Saved. Open questions appear on voters' dashboards straight away." : ""}</p>
    </form>
  );
}
