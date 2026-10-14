"use client";
/**
 * Browser-only demo store standing in for the backend (auth session, votes, admin writes).
 * It mirrors the rules the database will enforce later:
 *  - one vote per question, insert-only
 *  - results only after the caller has voted (see getResults)
 *  - age groups under 20 voters are hidden
 *  - every admin action appends to the audit log
 * Persisted to localStorage; the `storage` event gives cross-tab "live" updates,
 * standing in for Realtime. Swap this module for real API calls in a later milestone.
 */
import { useSyncExternalStore } from "react";
import { DEMO_PROFILE, SEED_COUNTS, SEED_QUESTIONS, stubAgeBreakdown } from "./fixtures";
import type { AuditEntry, Profile, Question, QuestionStatus, Results } from "./types";

const KEY = "pulse-demo-v1";
export const MIN_GROUP = 20;

interface State {
  user: Profile | null;
  adminVerified: boolean;
  questions: Question[];
  counts: Record<string, number>;
  votes: Record<string, string>;
  seen: string[];
  audit: AuditEntry[];
}

const initial = (): State => ({
  user: null,
  adminVerified: false,
  questions: SEED_QUESTIONS,
  counts: { ...SEED_COUNTS },
  votes: {},
  seen: [],
  audit: [],
});

let state: State | null = null;
const listeners = new Set<() => void>();

function load(): State {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...initial(), ...JSON.parse(raw) } : initial();
  } catch {
    state = initial();
  }
  return state!;
}

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const s = load();
  state = { ...s, ...(typeof patch === "function" ? patch(s) : patch) };
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    state = null;
    load();
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Returns null during SSR / before hydration so pages can render a skeleton. */
export function useStore(): State | null {
  return useSyncExternalStore(subscribe, load, () => null);
}

const uid = () => Math.random().toString(36).slice(2, 10);

// ---- auth ----------------------------------------------------------------

export function signIn(email: string) {
  const s = load();
  if (s.user && s.user.email === email) return;
  set({
    user: {
      ...DEMO_PROFILE,
      email,
      displayName: email.split("@")[0].replace(/[._-]+/g, " "),
      region: "London",
      ageBand: "25-34",
    },
    adminVerified: false,
  });
}

export function createAccount(p: Pick<Profile, "email" | "displayName" | "region" | "ageBand">) {
  // Role is never taken from the client: signup always creates a voter.
  set({ user: { ...DEMO_PROFILE, ...p, role: "voter", createdAt: new Date().toISOString() }, adminVerified: false });
}

export function signOut() {
  set({ user: null, adminVerified: false });
}

export function updateProfile(p: Pick<Profile, "displayName" | "region" | "ageBand">) {
  set((s) => (s.user ? { user: { ...s.user, ...p } } : {}));
}

export function deleteAccount() {
  set((s) => {
    const counts = { ...s.counts };
    Object.values(s.votes).forEach((o) => (counts[o] = Math.max(0, (counts[o] ?? 1) - 1)));
    return { user: null, adminVerified: false, votes: {}, seen: [], counts };
  });
}

// ---- voting ----------------------------------------------------------------

export function markSeen(questionId: string) {
  set((s) => (s.seen.includes(questionId) ? {} : { seen: [...s.seen, questionId] }));
}

export function castVote(questionId: string, optionId: string): { ok: boolean; error?: string } {
  const s = load();
  if (!s.user) return { ok: false, error: "Sign in to vote." };
  const q = s.questions.find((x) => x.id === questionId);
  if (!q || q.status !== "open") return { ok: false, error: "This question isn't open for votes." };
  if (s.votes[questionId]) return { ok: false, error: "You've already voted on this question." };
  if (!q.options.some((o) => o.id === optionId)) return { ok: false, error: "Unknown option." };
  set({
    votes: { ...s.votes, [questionId]: optionId },
    counts: { ...s.counts, [optionId]: (s.counts[optionId] ?? 0) + 1 },
  });
  return { ok: true };
}

/** Mirrors the planned `get_results(question_id)` function: nothing until the caller has voted. */
export function getResults(s: State, questionId: string): Results | null {
  const mine = s.votes[questionId];
  const q = s.questions.find((x) => x.id === questionId);
  if (!mine || !q) return null;
  const total = q.options.reduce((n, o) => n + (s.counts[o.id] ?? 0), 0);
  const options = [...q.options]
    .sort((a, b) => a.position - b.position)
    .map((o) => {
      const votes = s.counts[o.id] ?? 0;
      return { optionId: o.id, label: o.label, votes, pct: total ? Math.round((votes / total) * 100) : 0 };
    });
  const agreePct = options.find((o) => o.optionId === mine)?.pct ?? 0;
  const byAge = stubAgeBreakdown(questionId, mine, agreePct).map((g) => ({
    ...g,
    pct: g.voters < MIN_GROUP ? null : g.pct,
  }));
  return { total, options, myOptionId: mine, agreePct, byAge };
}

export function isNew(s: State, q: Question) {
  return !s.votes[q.id] && !s.seen.includes(q.id);
}

// ---- admin (stub of role=admin + 2FA gate) ---------------------------------

/** Demo only: in production the role is set directly in the database by the owner. */
export function demoBecomeAdmin() {
  set((s) => (s.user ? { user: { ...s.user, role: "admin" }, adminVerified: false } : {}));
}

export function verifyAdmin2fa(code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  set({ adminVerified: true });
  return true;
}

function audit(s: State, action: AuditEntry["action"], questionId: string, detail: string): AuditEntry[] {
  return [{ id: uid(), action, questionId, detail, createdAt: new Date().toISOString() }, ...s.audit];
}

function assertAdmin(s: State) {
  if (s.user?.role !== "admin" || !s.adminVerified) throw new Error("Not authorised");
}

export function adminCreateQuestion(input: {
  topic: string;
  body: string;
  options: string[];
  status: QuestionStatus;
  closesAt: string | null;
}) {
  set((s) => {
    assertAdmin(s);
    const id = "q-" + uid();
    const now = new Date().toISOString();
    const q: Question = {
      id,
      topic: input.topic,
      body: input.body,
      status: input.status,
      opensAt: now,
      closesAt: input.closesAt,
      createdAt: now,
      options: input.options.map((label, i) => ({ id: `${id}-o${i + 1}`, label, position: i + 1 })),
    };
    return { questions: [q, ...s.questions], audit: audit(s, "create", id, `${input.status}: ${input.body}`) };
  });
}

export function adminSetStatus(questionId: string, status: QuestionStatus) {
  set((s) => {
    assertAdmin(s);
    const prev = s.questions.find((q) => q.id === questionId);
    const action = status === "closed" ? "close" : prev?.status === "closed" ? "reopen" : "update";
    return {
      questions: s.questions.map((q) => (q.id === questionId ? { ...q, status } : q)),
      audit: audit(s, action, questionId, `${prev?.status} → ${status}`),
    };
  });
}

export function adminDeleteQuestion(questionId: string) {
  set((s) => {
    assertAdmin(s);
    const q = s.questions.find((x) => x.id === questionId);
    const votes = { ...s.votes };
    delete votes[questionId];
    return {
      questions: s.questions.filter((x) => x.id !== questionId),
      votes,
      audit: audit(s, "delete", questionId, q?.body ?? ""),
    };
  });
}

export function adminTotals(s: State, q: Question) {
  return q.options.map((o) => ({ ...o, votes: s.counts[o.id] ?? 0 }));
}
