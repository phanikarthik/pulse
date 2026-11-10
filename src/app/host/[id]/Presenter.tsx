"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { QrCode } from "@/components/QrCode";
import { fmt } from "@/lib/format";
import { fmtDistance } from "@/lib/geo";
import { fetchHostPoll, hostSetStatus, joinUrl, type HostPoll } from "@/lib/live";

const REFRESH_MS = 2_000;

/** Big, projector-friendly: the question, how to join, and the bars moving as votes come in. */
export function Presenter({ id }: { id: string }) {
  const [poll, setPoll] = useState<HostPoll | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [showResults, setShowResults] = useState(true);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");

  const load = useCallback(async () => {
    try {
      setPoll(await fetchHostPoll(id));
      setError("");
    } catch (e) {
      setError((e as { message?: string }).message || "Couldn't load this poll.");
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const code = poll?.code;
  useEffect(() => {
    if (code) setUrl(joinUrl(code));
  }, [code]);

  if (error && !poll) return <div className="container page"><div className="card empty" role="alert">{error}</div></div>;
  if (poll === undefined) return <div className="container page"><div className="skeleton" style={{ height: 420 }} /></div>;
  if (poll === null) {
    return (
      <div className="container page">
        <div className="card empty">This poll isn&apos;t yours, or it was deleted. <Link href="/host">Back to your polls</Link></div>
      </div>
    );
  }

  const setStatus = async (status: "open" | "closed") => {
    setBusy(true);
    const res = await hostSetStatus(poll.id, status);
    if (!res.ok) setError(res.error);
    await load();
    setBusy(false);
  };
  const shortUrl = url.replace(/^https?:\/\//, "");

  return (
    <div className="presenter">
      <div className="presenter-bar">
        <span className="admin-q-actions">
          <Link href="/host" className="back-link">← Your polls</Link>
          <Link href={`/host/${poll.id}/results`} className="back-link">Detailed results</Link>
        </span>
        <div className="admin-q-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowResults(!showResults)} aria-pressed={showResults}>
            {showResults ? "Hide results" : "Show results"}
          </button>
          {poll.status === "open"
            ? <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setStatus("closed")}>Close voting</button>
            : <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setStatus("open")}>{poll.status === "draft" ? "Start voting" : "Reopen voting"}</button>}
        </div>
      </div>

      <div className="presenter-main">
        <section className="presenter-join" aria-label="How to join">
          {url && <QrCode value={url} size={240} label={`QR code to join: ${shortUrl}`} />}
          <p className="presenter-step">Scan, or go to</p>
          <p className="presenter-url">{shortUrl ? shortUrl.replace(/\/live\/.*/, "/live") : ""}</p>
          <p className="presenter-step">and enter</p>
          <p className="presenter-code" aria-label={`Code ${poll.code.split("").join(" ")}`}>{poll.code}</p>
          {poll.geo && <p className="presenter-step">📍 Only for people within {fmtDistance(poll.geo.radiusM)} of {poll.geo.label}. Allow location when asked.</p>}
        </section>

        <section className="presenter-poll" aria-live="polite">
          <h1>{poll.body}</h1>
          {poll.moderation !== "ok" && (
            <p className="error-text">{poll.moderation === "hidden" ? "Removed by the Pulse team." : "Waiting for Pulse approval; the audience can't see it yet."}</p>
          )}
          <ul className="bars presenter-bars">
            {poll.options.map((o, i) => {
              const pct = poll.voters ? Math.round((o.votes / poll.voters) * 100) : 0;
              return (
                <li key={o.id} className="bar-row">
                  <div className="bar-label">
                    <span>{o.label}</span>
                    <b>{showResults ? `${pct}%` : ""}</b>
                  </div>
                  <div className="bar-track" role="img" aria-label={showResults ? `${o.label}: ${pct}%` : o.label}>
                    {showResults && <div className="bar-fill" style={{ ["--p" as string]: pct / 100, ["--i" as string]: i }} />}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="presenter-count">
            <b>{fmt(poll.voters)}</b> {poll.voters === 1 ? "vote" : "votes"}
            {poll.status === "open" ? " · voting open" : poll.status === "closed" ? " · voting closed" : " · not started"}
          </p>
        </section>
      </div>
    </div>
  );
}
