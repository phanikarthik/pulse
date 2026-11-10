"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Breakdown, exportCsv, Legend, ResultBars, Timeline } from "@/app/admin/Analytics";
import { ADMIN_MIN_GROUP, fetchAnalytics, type Analytics, type TimeSlot } from "@/lib/data";
import { fmt, relative } from "@/lib/format";
import { fetchHostPoll, type HostPoll } from "@/lib/live";

const REFRESH_MS = 10_000;

/** A host's results for one of their own live polls: totals, age split (members only), timing. */
export function HostResults({ id }: { id: string }) {
  const [poll, setPoll] = useState<HostPoll | null | undefined>(undefined);
  const [data, setData] = useState<Analytics | null>(null);
  const [slot, setSlot] = useState<TimeSlot>("hour");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const p = await fetchHostPoll(id);
      setPoll(p);
      if (p && p.moderation === "ok") setData(await fetchAnalytics(id, slot, "state"));
      setError("");
    } catch (e) {
      setError((e as { message?: string }).message || "Couldn't load results.");
    }
  }, [id, slot]);

  const open = poll?.status === "open";
  useEffect(() => {
    load();
    if (!open) return;
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, open]);

  if (error) return <div className="container page"><div className="card empty" role="alert">{error}</div></div>;
  if (poll === undefined) return <div className="container page"><div className="skeleton" style={{ height: 320 }} /></div>;
  if (poll === null) {
    return (
      <div className="container page">
        <div className="card empty">This poll isn&apos;t yours, or it was deleted. <Link href="/host">Back to your polls</Link></div>
      </div>
    );
  }

  const counts = poll.options.map((o) => o.votes);
  const members = data ? data.byAge.reduce((n, g) => n + g.voters, 0) : 0;
  const guests = Math.max(0, poll.voters - members);

  return (
    <div className="container page analytics">
      <Link href="/host" className="back-link">← Your polls</Link>
      <header className="analytics-head">
        <div className="q-meta">
          <span className={`tag ${open ? "tag-voted" : "tag-closed"}`}>{poll.status === "draft" ? "not started" : poll.status}</span>
          <span className="tag">{poll.topic} · {poll.code}</span>
          {open && <span className="live-dot">Live · updates every 10 s</span>}
        </div>
        <h1>{poll.body}</h1>
        <p className="hint">{fmt(poll.voters)} {poll.voters === 1 ? "vote" : "votes"} · created {relative(poll.createdAt)}</p>
        <div className="admin-q-actions">
          <Link className="btn btn-sm btn-ghost" href={`/host/${poll.id}`}>Presenter screen</Link>
          <button className="btn btn-sm btn-ghost" disabled={!data} onClick={() => data && exportCsv(poll, counts, null, data, slot, "state")}>
            Download CSV
          </button>
        </div>
      </header>

      <section className="card viz" aria-labelledby="hr-res">
        <h2 id="hr-res">Result</h2>
        <ResultBars q={poll} counts={counts} total={poll.voters} />
      </section>

      {poll.moderation !== "ok" ? (
        <p className="hint">Detailed results appear once the poll is approved and live.</p>
      ) : (
        <>
          <section className="card viz" aria-labelledby="hr-age">
            <div className="viz-head">
              <h2 id="hr-age">By age</h2>
              <Legend q={poll} />
            </div>
            {data ? <Breakdown q={poll} groups={data.byAge} /> : <div className="skeleton" style={{ height: 160 }} />}
            <p className="hint">
              Only voters signed in to Pulse share an age band. {fmt(guests)} {guests === 1 ? "guest" : "guests"} voted without an
              account and aren&apos;t included here.
            </p>
          </section>

          <section className="card viz" aria-labelledby="hr-time">
            <div className="viz-head">
              <h2 id="hr-time">Votes over time</h2>
              <div className="filters" role="group" aria-label="Group votes by">
                {(["hour", "day"] as const).map((s) => (
                  <button key={s} type="button" className={`btn btn-sm ${slot === s ? "" : "btn-ghost"}`}
                    aria-pressed={slot === s} onClick={() => setSlot(s)}>
                    Per {s}
                  </button>
                ))}
              </div>
            </div>
            {data ? <Timeline q={poll} groups={data.timeline} slot={slot} /> : <div className="skeleton" style={{ height: 180 }} />}
          </section>
        </>
      )}

      <p className="hint">
        You see totals only: nobody, including you, can see how a particular person voted. Groups and time slots with fewer
        than {ADMIN_MIN_GROUP} voters show the number of voters but not their answers.
      </p>
    </div>
  );
}
