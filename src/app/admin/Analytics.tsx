"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { downloadCsv } from "@/lib/csv";
import {
  ADMIN_MIN_GROUP,
  fetchAnalytics,
  isVotable,
  useAdminData,
  type Analytics as Data,
  type AnalyticsGroup,
  type TimeSlot,
} from "@/lib/data";
import { fmt, relative } from "@/lib/format";
import type { Question } from "@/lib/types";

const REFRESH_MS = 20_000;
const MAX_SLOTS = 500;

/** Each option keeps its colour (series-1…4) on every chart. */
const swatch = (i: number) => `var(--series-${i + 1})`;
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

export function Analytics({ id }: { id: string }) {
  const admin = useAdminData();
  const q = admin.data?.questions.find((x) => x.id === id);
  const live = !!q && isVotable(q);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  // Hours for a question's first three days, days after that.
  useEffect(() => {
    if (q && !slot) setSlot(Date.now() - new Date(q.opensAt).getTime() > 3 * 86_400_000 ? "day" : "hour");
  }, [q, slot]);

  const { reload } = admin;
  const load = useCallback(async () => {
    if (!slot) return;
    try {
      setData(await fetchAnalytics(id, slot));
      setError("");
    } catch (e) {
      setError((e as { message?: string }).message || "Couldn't load analytics.");
    }
  }, [id, slot]);

  useEffect(() => {
    load();
    if (!live) return;
    const t = setInterval(() => {
      load();
      reload();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, reload, live]);

  if (admin.error || error) return <div className="container page"><div className="card empty" role="alert">{admin.error || error}</div></div>;
  if (!admin.data) return <div className="container page"><div className="skeleton" style={{ height: 320 }} /></div>;
  if (!q) {
    return (
      <div className="container page">
        <div className="card empty">This question doesn&apos;t exist any more. <Link href="/admin">Back to questions</Link></div>
      </div>
    );
  }

  const counts = q.options.map((o) => admin.data!.counts[o.id] ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);

  return (
    <div className="container page analytics">
      <Link href="/admin" className="back-link">← All questions</Link>
      <header className="analytics-head">
        <div className="q-meta">
          <span className={`tag ${q.status === "open" ? "tag-voted" : q.status === "closed" ? "tag-closed" : ""}`}>{q.status}</span>
          <span className="tag">{q.topic}</span>
          {live && <span className="live-dot">Live · updates every 20 s</span>}
        </div>
        <h1>{q.body}</h1>
        <p className="hint">
          {fmt(total)} {total === 1 ? "voter" : "voters"} · opened {relative(q.opensAt)}
          {q.closesAt && ` · ${new Date(q.closesAt).getTime() > Date.now() ? "closes" : "closed"} ${relative(q.closesAt)}`}
        </p>
        <div>
          <button className="btn btn-sm btn-ghost" disabled={!data} onClick={() => data && exportCsv(q, counts, data, slot!)}>
            Download CSV
          </button>
        </div>
      </header>

      <section className="card viz" aria-labelledby="res-h">
        <h2 id="res-h">Result</h2>
        <ResultBars q={q} counts={counts} total={total} />
      </section>

      <section className="card viz" aria-labelledby="age-h">
        <div className="viz-head">
          <h2 id="age-h">By age</h2>
          <Legend q={q} />
        </div>
        {data ? <Breakdown q={q} groups={data.byAge} /> : <div className="skeleton" style={{ height: 160 }} />}
      </section>

      <section className="card viz" aria-labelledby="time-h">
        <div className="viz-head">
          <h2 id="time-h">Votes over time</h2>
          <div className="filters" role="group" aria-label="Group votes by">
            {(["hour", "day"] as const).map((s) => (
              <button key={s} type="button" className={`btn btn-sm ${slot === s ? "" : "btn-ghost"}`}
                aria-pressed={slot === s} onClick={() => setSlot(s)}>
                Per {s}
              </button>
            ))}
          </div>
        </div>
        {data && slot ? <Timeline q={q} groups={data.timeline} slot={slot} /> : <div className="skeleton" style={{ height: 180 }} />}
      </section>

      <p className="hint">
        Totals only: nobody, including admins, can see how a particular person voted. Groups and time slots with fewer
        than {ADMIN_MIN_GROUP} voters show the number of voters but not their answers.
      </p>
    </div>
  );
}

function ResultBars({ q, counts, total }: { q: Question; counts: number[]; total: number }) {
  if (!total) return <p className="hint">No votes yet.</p>;
  return (
    <div className="result-rows">
      {q.options.map((o, i) => (
        <div key={o.id} className="result-row">
          <span><i className="key" style={{ background: swatch(i) }} />{o.label}</span>
          <b>{pct(counts[i], total)}%</b>
          <span className="hint">{fmt(counts[i])}</span>
          <div className="mini-bar-track"><div style={{ ["--p" as string]: counts[i] / total, background: swatch(i) }} /></div>
        </div>
      ))}
    </div>
  );
}

function Legend({ q }: { q: Question }) {
  return (
    <ul className="legend" aria-label="Colours">
      {q.options.map((o, i) => (
        <li key={o.id}><i className="key" style={{ background: swatch(i) }} />{o.label}</li>
      ))}
    </ul>
  );
}

/** One 100% bar per group, split by answer, with the numbers written underneath. */
function Breakdown({ q, groups }: { q: Question; groups: AnalyticsGroup[] }) {
  return (
    <div className="stack-rows">
      {groups.map((g) => (
        <div key={g.key} className="stack-row">
          <span className="stack-label">{g.key}</span>
          <span className="hint stack-n">{fmt(g.voters)} {g.voters === 1 ? "voter" : "voters"}</span>
          {!g.voters ? (
            <span className="stack-note">No votes</span>
          ) : !g.votes ? (
            <span className="stack-note">Hidden: fewer than {ADMIN_MIN_GROUP} voters</span>
          ) : (
            <>
              <div className="stack" role="img"
                aria-label={q.options.map((o) => `${o.label} ${pct(g.votes![o.id] ?? 0, g.voters)}%`).join(", ")}>
                {q.options.map((o, i) => {
                  const n = g.votes![o.id] ?? 0;
                  return n ? (
                    <div key={o.id} style={{ flexGrow: n, background: swatch(i) }}
                      title={`${g.key} · ${o.label}: ${pct(n, g.voters)}% (${fmt(n)})`} />
                  ) : null;
                })}
              </div>
              <span className="stack-text">
                {q.options.map((o) => `${o.label} ${pct(g.votes![o.id] ?? 0, g.voters)}%`).join(" · ")}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Every hour/day from the first vote to the last, including empty ones. */
function fillSlots(groups: AnalyticsGroup[], slot: TimeSlot): AnalyticsGroup[] {
  if (!groups.length) return [];
  const byTime = new Map(groups.map((g) => [new Date(g.key).getTime(), g]));
  const end = new Date(groups[groups.length - 1].key).getTime();
  const out: AnalyticsGroup[] = [];
  for (const d = new Date(groups[0].key); d.getTime() <= end && out.length < MAX_SLOTS; ) {
    out.push(byTime.get(d.getTime()) ?? { key: d.toISOString(), voters: 0, votes: null });
    if (slot === "hour") d.setHours(d.getHours() + 1);
    else d.setDate(d.getDate() + 1);
  }
  return out;
}

const slotLabel = (iso: string, slot: TimeSlot) =>
  new Date(iso).toLocaleString("en-IN", slot === "hour"
    ? { day: "numeric", month: "short", hour: "numeric" }
    : { day: "numeric", month: "short" });

function Timeline({ q, groups, slot }: { q: Question; groups: AnalyticsGroup[]; slot: TimeSlot }) {
  const slots = fillSlots(groups, slot);
  if (!slots.length) return <p className="hint">No votes yet.</p>;
  const max = Math.max(...slots.map((s) => s.voters));
  const busiest = slots.find((s) => s.voters === max)!;
  const tip = (s: AnalyticsGroup) => {
    const head = `${slotLabel(s.key, slot)}: ${fmt(s.voters)} ${s.voters === 1 ? "vote" : "votes"}`;
    if (!s.voters) return head;
    if (!s.votes) return `${head} (split hidden, fewer than ${ADMIN_MIN_GROUP})`;
    return `${head} · ${q.options.map((o) => `${o.label} ${pct(s.votes![o.id] ?? 0, s.voters)}%`).join(", ")}`;
  };
  return (
    <>
      <p className="hint">Busiest {slot}: {slotLabel(busiest.key, slot)} with {fmt(max)} {max === 1 ? "vote" : "votes"}.</p>
      <div className="columns-wrap">
        <span className="columns-max hint">{fmt(max)}</span>
        <div className="columns" role="img" aria-label={`Votes per ${slot}, highest ${fmt(max)}`}>
          {slots.map((s) => (
            <div key={s.key} className="column" title={tip(s)}>
              <div style={{ ["--p" as string]: s.voters / max }} />
            </div>
          ))}
        </div>
      </div>
      <div className="columns-axis hint">
        <span>{slotLabel(slots[0].key, slot)}</span>
        {slots.length > 1 && <span>{slotLabel(slots[slots.length - 1].key, slot)}</span>}
      </div>
      <details className="table-view">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr><th scope="col">{slot === "hour" ? "Hour" : "Day"}</th><th scope="col">Votes</th>{q.options.map((o) => <th key={o.id} scope="col">{o.label}</th>)}</tr>
          </thead>
          <tbody>
            {slots.filter((s) => s.voters).map((s) => (
              <tr key={s.key}>
                <td>{slotLabel(s.key, slot)}</td>
                <td>{fmt(s.voters)}</td>
                {q.options.map((o) => <td key={o.id}>{s.votes ? fmt(s.votes[o.id] ?? 0) : "hidden"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function exportCsv(q: Question, counts: number[], data: Data, slot: TimeSlot) {
  const total = counts.reduce((a, b) => a + b, 0);
  const rows: (string | number | null)[][] = [["section", "group", "voters in group", "answer", "votes", "percent"]];
  q.options.forEach((o, i) => rows.push(["result", "all", total, o.label, counts[i], pct(counts[i], total)]));
  const add = (section: string, groups: AnalyticsGroup[], label: (k: string) => string) => {
    for (const g of groups) {
      if (!g.voters) continue;
      for (const o of q.options) {
        const n = g.votes ? g.votes[o.id] ?? 0 : null;
        rows.push([section, label(g.key), g.voters, o.label, n ?? "hidden", n === null ? "hidden" : pct(n, g.voters)]);
      }
    }
  };
  add("age", data.byAge, (k) => k);
  add(`per ${slot}`, data.timeline, (k) => new Date(k).toLocaleString("en-IN"));
  downloadCsv(`pulse-${q.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${q.id.slice(0, 8)}.csv`, rows);
}
