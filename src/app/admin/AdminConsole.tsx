"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useProfile } from "@/components/SessionProvider";
import {
  adminCreateQuestion,
  adminDeleteQuestion,
  adminSetStatus,
  getAdminGate,
  startTotpEnrollment,
  useAdminData,
  verifyTotp,
  type AdminGate,
} from "@/lib/data";
import { fmt, relative } from "@/lib/format";
import type { Question, QuestionStatus } from "@/lib/types";

const MAX_BODY = 160;

const Loading = () => <div className="container page"><div className="skeleton" style={{ height: 260 }} /></div>;

export function AdminConsole() {
  const profile = useProfile();
  const [gate, setGate] = useState<AdminGate | null>(null);
  const [error, setError] = useState("");
  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    getAdminGate().then(setGate, (e) => setError(e.message ?? "Couldn't check your sign-in."));
  }, [isAdmin]);

  if (!profile || !isAdmin) return <NotAuthorised signedIn={!!profile} />;
  if (error) return <div className="container-narrow"><div className="card gate"><p className="error-text" role="alert">{error}</p></div></div>;
  if (!gate) return <Loading />;
  if (gate.step === "enroll") return <EnrollTotp onDone={() => setGate({ step: "verified" })} />;
  if (gate.step === "challenge") return <TwoFactor factorId={gate.factorId} onDone={() => setGate({ step: "verified" })} />;
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
      </div>
    </div>
  );
}

/** The 6-digit field shared by setup and sign-in. */
function CodeField({ code, setCode, error, hint }: { code: string; setCode: (v: string) => void; error: string; hint: string }) {
  const id = useId();
  return (
    <div className="field" style={{ width: "min(100%, 280px)" }}>
      <label htmlFor={id} className="sr-only">Authenticator code</label>
      <input id={id} className="input otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        aria-invalid={!!error} aria-describedby={`${id}-m`} autoFocus />
      {error ? <span id={`${id}-m`} className="error-text" role="alert">{error}</span> : <span id={`${id}-m`} className="hint">{hint}</span>}
    </div>
  );
}

function useVerify(factorId: string | undefined, onDone: () => void) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from your authenticator app.");
    setBusy(true);
    const res = await verifyTotp(factorId, code);
    setBusy(false);
    if (!res.ok) {
      setCode("");
      return setError(res.error);
    }
    onDone();
  };
  return { code, setCode, error, busy, submit };
}

/** First visit: link an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). */
function EnrollTotp({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const v = useVerify(setup?.factorId, onDone);

  const begin = useCallback(() => {
    setLoadError("");
    startTotpEnrollment().then(setSetup, (e) => setLoadError(e.message ?? "Couldn't start setup."));
  }, []);
  useEffect(begin, [begin]);

  return (
    <div className="container-narrow">
      <form className="card gate" noValidate onSubmit={v.submit}>
        <span className="tag">One-time setup</span>
        <h1>Set up two-factor sign-in</h1>
        <p>Admin actions need a code from an authenticator app on your phone, so a stolen email login can&apos;t post questions.</p>
        <ol style={{ textAlign: "left", display: "grid", gap: "0.4rem", paddingLeft: "1.2rem", maxWidth: "44ch", margin: "0 auto" }}>
          <li>Open an authenticator app, such as Google Authenticator, Microsoft Authenticator or 1Password.</li>
          <li>Add an account and scan this QR code.</li>
          <li>Type the 6-digit code it shows.</li>
        </ol>
        {loadError ? (
          <>
            <p className="error-text" role="alert">{loadError}</p>
            <button type="button" className="btn btn-sm" onClick={begin}>Try again</button>
          </>
        ) : !setup ? (
          <div className="skeleton" style={{ width: 200, height: 200, margin: "0 auto" }} />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URL from Supabase */}
            <img src={setup.qr} alt="QR code to add Pulse to your authenticator app" width={200} height={200}
              style={{ background: "#fff", padding: 8, borderRadius: 12, margin: "0 auto" }} />
            <details style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              <summary style={{ cursor: "pointer" }}>Can&apos;t scan? Enter this key instead</summary>
              <code style={{ wordBreak: "break-all", display: "block", marginTop: "0.5rem" }}>{setup.secret}</code>
            </details>
            <CodeField code={v.code} setCode={v.setCode} error={v.error} hint="The code changes every 30 seconds." />
            <button className="btn btn-pulse" disabled={v.busy}>{v.busy ? "Checking…" : "Verify and finish"}</button>
          </>
        )}
      </form>
    </div>
  );
}

function TwoFactor({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  const v = useVerify(factorId, onDone);
  return (
    <div className="container-narrow">
      <form className="card gate" noValidate onSubmit={v.submit}>
        <span className="tag">Step 2 of 2</span>
        <h1>Confirm it&apos;s you</h1>
        <p>Admin actions need a two-factor verified session. Enter the code from your authenticator app.</p>
        <CodeField code={v.code} setCode={v.setCode} error={v.error} hint="Open your authenticator app and find Pulse." />
        <button className="btn btn-pulse" disabled={v.busy}>{v.busy ? "Checking…" : "Verify"}</button>
      </form>
    </div>
  );
}

function Console() {
  const { data, error, reload } = useAdminData();
  const [view, setView] = useState<QuestionStatus | "all">("all");
  /** Runs an admin action, then reloads totals and the audit log. Returns the error, or "". */
  const act = useCallback(
    async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
      const res = await fn();
      await reload();
      return res.ok ? "" : res.error;
    },
    [reload],
  );

  if (error) return <div className="container page"><div className="card empty" role="alert">{error}</div></div>;
  if (!data) return <Loading />;

  const list = data.questions.filter((q) => view === "all" || q.status === view);
  return (
    <div className="container page">
      <div className="admin-banner" role="note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
        Admin · 2FA verified · every action is recorded in the audit log
      </div>
      <div className="admin-grid">
        <NewQuestionForm act={act} />
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
            <div className="card empty">No {view === "all" ? "" : `${view} `}questions yet.</div>
          ) : (
            list.map((q) => <AdminQuestion key={q.id} q={q} counts={data.counts} act={act} />)
          )}
          <div className="section-head"><h2>Audit log</h2></div>
          {data.audit.length === 0 ? (
            <p className="hint">No admin actions yet.</p>
          ) : (
            <ul className="audit">
              {data.audit.slice(0, 12).map((a) => (
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

type Act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => Promise<string>;

function AdminQuestion({ q, counts, act }: { q: Question; counts: Record<string, number>; act: Act }) {
  const totals = q.options.map((o) => ({ ...o, votes: counts[o.id] ?? 0 }));
  const total = totals.reduce((n, o) => n + o.votes, 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true);
    setError(await act(fn));
    setBusy(false);
  };
  return (
    <article className="card admin-q">
      <div className="q-meta">
        <span className={`tag ${q.status === "open" ? "tag-voted" : q.status === "closed" ? "tag-closed" : ""}`}>{q.status}</span>
        <span className="tag">{q.topic}</span>
        <span>{fmt(total)} {total === 1 ? "vote" : "votes"}</span>
        {q.closesAt && <span>· {new Date(q.closesAt).getTime() > Date.now() ? "closes" : "ended"} {relative(q.closesAt)}</span>}
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
        {q.status === "draft" && <button className="btn btn-sm" disabled={busy} onClick={() => run(() => adminSetStatus(q, "open"))}>Publish</button>}
        {q.status === "open" && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => adminSetStatus(q, "closed"))}>Close</button>}
        {q.status === "closed" && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => adminSetStatus(q, "open"))}>Reopen</button>}
        {q.status !== "draft" && <Link className="btn btn-sm btn-ghost" href={`/q/${q.id}`}>View</Link>}
        <button className="btn btn-sm btn-danger" disabled={busy}
          onClick={() => confirm("Delete this question and all its votes? This can't be undone.") && run(() => adminDeleteQuestion(q.id))}>
          Delete
        </button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </article>
  );
}

function NewQuestionForm({ act }: { act: Act }) {
  const [topic, setTopic] = useState("");
  const [body, setBody] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [status, setStatus] = useState<QuestionStatus>("open");
  const [closesAt, setClosesAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!topic.trim()) return setError("Add a topic.");
    if (!body.trim() || body.length > MAX_BODY) return setError(`Question text must be 1–${MAX_BODY} characters.`);
    if (opts.length < 2) return setError("Add at least two options.");
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return setError("Options must be different.");
    if (closesAt && new Date(closesAt).getTime() <= Date.now()) return setError("Close time must be in the future.");
    setError("");
    setBusy(true);
    const err = await act(() =>
      adminCreateQuestion({
        topic: topic.trim(),
        body: body.trim(),
        options: opts,
        status,
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      }),
    );
    setBusy(false);
    if (err) return setError(err);
    setTopic(""); setBody(""); setOptions(["", ""]); setClosesAt("");
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
      <button className="btn btn-pulse" disabled={busy}>{busy ? "Saving…" : status === "open" ? "Post question" : "Save question"}</button>
      <p aria-live="polite" className="hint">{posted ? "Saved. Open questions appear on voters' dashboards straight away." : ""}</p>
    </form>
  );
}
