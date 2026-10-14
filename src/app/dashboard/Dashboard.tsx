"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RequireUser } from "@/components/RequireUser";
import { useProfile } from "@/components/SessionProvider";
import { isNew, useStore } from "@/lib/demo-store";
import { greeting, relative } from "@/lib/format";
import type { Question } from "@/lib/types";

type Filter = "all" | "new" | "answered";

function Skeleton() {
  return (
    <div className="container page" aria-busy="true" aria-label="Loading your questions">
      <div className="skeleton" style={{ height: 90, maxWidth: 420 }} />
      <div className="stats">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 72 }} />)}
      </div>
      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 110 }} />)}
    </div>
  );
}

export function Dashboard() {
  return (
    <RequireUser fallback={<Skeleton />}>
      <DashboardInner />
    </RequireUser>
  );
}

function DashboardInner() {
  const s = useStore()!;
  const profile = useProfile()!;
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState<Question | null>(null);
  const known = useRef<Set<string> | null>(null);

  const open = s.questions.filter((q) => q.status === "open");
  const closed = s.questions.filter((q) => q.status === "closed");

  // "Live" updates: when a question appears that we haven't seen in this session, announce it.
  useEffect(() => {
    const ids = new Set(open.map((q) => q.id));
    if (known.current) {
      const fresh = open.find((q) => !known.current!.has(q.id));
      if (fresh) setToast(fresh);
    }
    known.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.map((q) => q.id).join(",")]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const newCount = open.filter((q) => isNew(s, q)).length;
  const answered = open.filter((q) => s.votes[q.id]).length;
  const shown = open.filter((q) =>
    filter === "new" ? isNew(s, q) : filter === "answered" ? !!s.votes[q.id] : true,
  );

  return (
    <div className="container page">
      <section className="greeting">
        <h1>
          {greeting()}, <span>{profile.displayName}</span>.
        </h1>
        <p>
          {newCount > 0
            ? `${newCount} new question${newCount > 1 ? "s" : ""} waiting for your vote.`
            : "You're all caught up. New questions appear here the moment they're posted."}
        </p>
      </section>

      <div className="stats">
        <div className="card stat"><b>{open.length}</b><span>Open now</span></div>
        <div className="card stat"><b style={{ color: "var(--pulse)" }}>{newCount}</b><span>New for you</span></div>
        <div className="card stat"><b>{answered}</b><span>You&apos;ve voted</span></div>
      </div>

      <section aria-labelledby="open-h" style={{ display: "grid", gap: "1rem" }}>
        <div className="section-head">
          <h2 id="open-h">Open questions</h2>
          <div className="filters" role="group" aria-label="Filter questions">
            {(["all", "new", "answered"] as Filter[]).map((f) => (
              <button key={f} type="button" className={`btn btn-sm ${filter === f ? "" : "btn-ghost"}`}
                aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "new" ? "New" : "Voted"}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="card empty">
            <svg viewBox="0 0 120 30" aria-hidden="true"><path d="M0 15 H45 L52 5 L60 25 L68 2 L75 18 L80 15 H120" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <strong style={{ color: "var(--text)" }}>{filter === "answered" ? "No votes yet" : "Nothing new right now"}</strong>
            <span>{filter === "answered" ? "Pick a question to cast your first vote." : "We'll flag fresh questions here as soon as they go live."}</span>
          </div>
        ) : (
          <ul className="q-list">
            {shown.map((q, i) => <QuestionRow key={q.id} q={q} i={i} fresh={isNew(s, q)} voted={!!s.votes[q.id]} />)}
          </ul>
        )}
      </section>

      {closed.length > 0 && (
        <section aria-labelledby="closed-h" style={{ display: "grid", gap: "1rem" }}>
          <div className="section-head"><h2 id="closed-h">Recently closed</h2></div>
          <ul className="q-list">
            {closed.map((q, i) => <QuestionRow key={q.id} q={q} i={i} fresh={false} voted={!!s.votes[q.id]} />)}
          </ul>
        </section>
      )}

      <div aria-live="polite" className="sr-only">{toast ? `New question posted: ${toast.body}` : ""}</div>
      {toast && (
        <div className="toast" role="status">
          <span className="live-dot" aria-hidden="true" />
          <span>New question: {toast.topic}</span>
          <Link href={`/q/${toast.id}`} className="btn btn-pulse btn-sm">Vote</Link>
        </div>
      )}
    </div>
  );
}

function QuestionRow({ q, i, fresh, voted }: { q: Question; i: number; fresh: boolean; voted: boolean }) {
  return (
    <li className="q-item" style={{ ["--i" as string]: i }}>
      <Link href={`/q/${q.id}`} className="card q-link" data-new={fresh}>
        <div className="q-meta">
          {fresh && <span className="tag tag-new">New</span>}
          {voted && <span className="tag tag-voted">Voted</span>}
          {q.status === "closed" && <span className="tag tag-closed">Closed</span>}
          <span className="tag">{q.topic}</span>
          <span>
            {q.status === "closed"
              ? `Closed ${q.closesAt ? relative(q.closesAt) : ""}`
              : q.closesAt
                ? `Closes ${relative(q.closesAt)}`
                : `Posted ${relative(q.opensAt)}`}
          </span>
        </div>
        <span className="q-arrow" aria-hidden="true">→</span>
        <p className="q-body">{q.body}</p>
      </Link>
    </li>
  );
}
