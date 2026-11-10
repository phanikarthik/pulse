"use client";
import { useState } from "react";
import { adminResolveReports, useReports, type ReportedPoll } from "@/lib/data";
import { relative } from "@/lib/format";

const REASON_LABEL: Record<string, string> = {
  offensive: "Offensive",
  misleading: "Misleading",
  political: "Political campaigning",
  spam: "Spam",
  other: "Other",
};

/** Live polls the audience has reported. Reports never hide anything until the owner decides. */
export function ReportsPanel({ onChange }: { onChange: () => void }) {
  const { data, error, reload } = useReports();
  if (error) return <div className="card empty" role="alert">{error}</div>;
  if (!data) return <div className="skeleton" style={{ height: 200 }} />;
  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: 760 }}>
      <p className="hint">
        Anyone in a live poll&apos;s audience can report it once. Hide the poll if it breaks the host rules, or dismiss the
        reports to keep it live. To act on the host too, suspend them under Hosts &amp; switches.
      </p>
      {data.length === 0 ? (
        <div className="card empty">No open reports.</div>
      ) : (
        data.map((r) => <ReportCard key={r.questionId} r={r} onDone={async () => { await reload(); onChange(); }} />)
      )}
    </div>
  );
}

function ReportCard({ r, onDone }: { r: ReportedPoll; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolve = async (hide: boolean) => {
    if (hide && !confirm("Hide this poll? Its audience can't see it or vote until you restore it under Questions.")) return;
    setBusy(true);
    const res = await adminResolveReports(r.questionId, hide);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    await onDone();
  };
  return (
    <article className="card admin-q">
      <div className="q-meta">
        <span className="tag tag-alert">{r.openReports} {r.openReports === 1 ? "report" : "reports"}</span>
        {r.reasons.map((x) => <span key={x} className="tag">{REASON_LABEL[x] ?? x}</span>)}
        {r.moderation === "hidden" && <span className="tag">Already hidden</span>}
        <span>last {relative(r.lastReported)}</span>
      </div>
      <p style={{ fontWeight: 620, fontSize: "1.05rem" }}>{r.body}</p>
      <p className="hint">Host: {r.hostEmail ?? "unknown"}{r.code ? ` · code ${r.code}` : ""}</p>
      {r.details.map((d, i) => <p key={i} className="applicant-note">“{d}”</p>)}
      <div className="admin-q-actions">
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => resolve(true)}>Hide poll</button>
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => resolve(false)}>Dismiss reports</button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </article>
  );
}
