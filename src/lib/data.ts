"use client";
/**
 * Questions, votes, results and admin actions, all against Supabase. Components call
 * only these functions. The database enforces every rule (RLS, triggers, RPCs); the
 * checks here exist only to give friendly messages.
 */
import { useCallback, useEffect, useState } from "react";
import { createClient } from "./supabase/client";
import { AGE_BANDS, type AgeBand, type AuditEntry, type Question, type QuestionStatus, type Results } from "./types";

type Result = { ok: true } | { ok: false; error: string };
type DbError = { message: string; code?: string };

/** Breakdown groups smaller than this are hidden (get_breakdown returns pct = null). */
export const MIN_GROUP = 20;

const fail = (e: DbError, fallback = "Something went wrong. Please try again."): Result => ({
  ok: false,
  error: e.message || fallback,
});

// ---- questions ---------------------------------------------------------------

const QUESTION_COLUMNS = "id, topic, body, status, opens_at, closes_at, created_at, options(id, label, position)";

type QuestionRow = {
  id: string;
  topic: string;
  body: string;
  status: QuestionStatus;
  opens_at: string;
  closes_at: string | null;
  created_at: string;
  options: { id: string; label: string; position: number }[];
};

const toQuestion = (r: QuestionRow): Question => ({
  id: r.id,
  topic: r.topic,
  body: r.body,
  status: r.status,
  opensAt: r.opens_at,
  closesAt: r.closes_at,
  createdAt: r.created_at,
  options: [...r.options].sort((a, b) => a.position - b.position),
});

/** Open and accepting votes right now (same test as the database's question_is_open). */
export function isVotable(q: Question) {
  const now = Date.now();
  return (
    q.status === "open" && new Date(q.opensAt).getTime() <= now && (!q.closesAt || new Date(q.closesAt).getTime() > now)
  );
}

/** Voters get published questions; an admin with a 2FA session also gets drafts (RLS decides). */
async function fetchQuestions(): Promise<Question[]> {
  const { data, error } = await createClient()
    .from("questions")
    .select(QUESTION_COLUMNS)
    .order("opens_at", { ascending: false });
  if (error) throw error;
  return (data as QuestionRow[]).map(toQuestion);
}

/** questionId → the option I chose. RLS returns only my own votes. */
async function fetchMyVotes(): Promise<Record<string, string>> {
  const { data, error } = await createClient().from("votes").select("question_id, option_id");
  if (error) throw error;
  return Object.fromEntries(data.map((v) => [v.question_id, v.option_id]));
}

/** Re-runs `onChange` whenever any visible question is created, edited or deleted. */
function subscribeToQuestions(onChange: () => void) {
  const supabase = createClient();
  const channel = supabase.channel(`questions-${Math.random().toString(36).slice(2)}`);
  let stopped = false;
  // Realtime applies RLS using the signed-in user's token.
  supabase.auth.getSession().then(({ data }) => {
    if (stopped) return;
    if (data.session) supabase.realtime.setAuth(data.session.access_token);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "questions" }, onChange).subscribe();
  });
  return () => {
    stopped = true;
    supabase.removeChannel(channel);
  };
}

type Loaded<T> = { data: T | null; error: string; reload: () => Promise<void> };

function useLoad<T>(load: () => Promise<T>, live: boolean): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError("");
    } catch (e) {
      setError((e as DbError).message || "Couldn't load questions.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    reload();
    if (!live) return;
    return subscribeToQuestions(reload);
  }, [reload, live]);
  return { data, error, reload };
}

/** Dashboard and question page: questions + my votes, kept live. */
export function useVoterData() {
  return useLoad(async () => {
    const [questions, votes] = await Promise.all([fetchQuestions(), fetchMyVotes()]);
    return { questions, votes };
  }, true);
}

/** How many questions I have voted on (account page). */
export async function countMyVotes(): Promise<number> {
  const { count } = await createClient().from("votes").select("question_id", { count: "exact", head: true });
  return count ?? 0;
}

// ---- "New" tags (per browser, per user) -------------------------------------

const seenKey = (userId: string) => `pulse-seen-${userId}`;

export function useSeen(userId: string) {
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => {
    try {
      setSeen(JSON.parse(localStorage.getItem(seenKey(userId)) ?? "[]"));
    } catch {
      setSeen([]);
    }
  }, [userId]);
  return seen;
}

export function markSeen(userId: string, questionId: string) {
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(seenKey(userId)) ?? "[]");
    if (!seen.includes(questionId)) localStorage.setItem(seenKey(userId), JSON.stringify([...seen, questionId]));
  } catch {
    // Storage unavailable: questions just stay flagged as New.
  }
}

// ---- voting and results --------------------------------------------------------

/** Insert-only, one per question; region and age band are copied from the profile by trigger. */
export async function castVote(questionId: string, optionId: string): Promise<Result> {
  const { error } = await createClient().from("votes").insert({ question_id: questionId, option_id: optionId });
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, error: "You've already voted on this question." };
  if (/complete your profile/i.test(error.message)) return { ok: false, error: "Finish your profile before voting." };
  if (error.code === "42501") return { ok: false, error: "This question isn't open for votes any more." };
  return fail(error);
}

/** Nothing until I have voted (enforced by get_results / get_breakdown in the database). */
export async function fetchResults(questionId: string): Promise<Results | null> {
  const supabase = createClient();
  const [res, ages] = await Promise.all([
    supabase.rpc("get_results", { p_question_id: questionId }),
    supabase.rpc("get_breakdown", { p_question_id: questionId, p_dimension: "age" }),
  ]);
  if (res.error) throw res.error;
  const rows = (res.data ?? []) as { option_id: string; label: string; votes: number; is_mine: boolean }[];
  const mine = rows.find((r) => r.is_mine);
  if (!mine) return null;

  const total = rows.reduce((n, r) => n + r.votes, 0);
  const options = rows.map((r) => ({
    optionId: r.option_id,
    label: r.label,
    votes: r.votes,
    pct: total ? Math.round((r.votes / total) * 100) : 0,
  }));
  const groups = new Map(
    ((ages.data ?? []) as { grp: string; voters: number; pct: number | null }[]).map((g) => [g.grp, g]),
  );
  return {
    total,
    options,
    myOptionId: mine.option_id,
    agreePct: options.find((o) => o.optionId === mine.option_id)?.pct ?? 0,
    byAge: AGE_BANDS.map((band: AgeBand) => {
      const g = groups.get(band);
      return { band, voters: g?.voters ?? 0, pct: g?.pct ?? null };
    }),
  };
}

// ---- admin: two-factor ---------------------------------------------------------

export type AdminGate =
  | { step: "verified" }
  | { step: "challenge"; factorId: string }
  | { step: "enroll" };

/** Where an admin is in the 2FA flow. Admin writes need an aal2 (2FA-verified) session. */
export async function getAdminGate(): Promise<AdminGate> {
  const supabase = createClient();
  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (aal.currentLevel === "aal2") return { step: "verified" };
  const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
  if (fErr) throw fErr;
  const totp = factors.totp.find((f) => f.status === "verified");
  return totp ? { step: "challenge", factorId: totp.id } : { step: "enroll" };
}

/** Starts authenticator-app setup; returns the QR code (an SVG data URL) and the manual key. */
export async function startTotpEnrollment(): Promise<{ factorId: string; qr: string; secret: string }> {
  const supabase = createClient();
  // Clear any half-finished setup so a fresh QR code can be issued.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Pulse admin" });
  if (error) throw error;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Checks a 6-digit authenticator code and upgrades the session to aal2. */
export async function verifyTotp(factorId: string, code: string): Promise<Result> {
  const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code });
  if (!error) return { ok: true };
  if (/invalid|expired/i.test(error.message)) return { ok: false, error: "That code didn't match. Use the current code in your app." };
  return fail(error);
}

// ---- admin: questions ----------------------------------------------------------

/** All questions (drafts included), vote totals per option and the audit log. */
export function useAdminData() {
  return useLoad(async () => {
    const supabase = createClient();
    const [questions, totals, audit] = await Promise.all([
      fetchQuestions(),
      supabase.rpc("admin_option_totals"),
      supabase
        .from("admin_audit_log")
        .select("id, action, question_id, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
    if (totals.error) throw totals.error;
    if (audit.error) throw audit.error;
    const counts: Record<string, number> = Object.fromEntries(
      ((totals.data ?? []) as { option_id: string; votes: number }[]).map((t) => [t.option_id, t.votes]),
    );
    const log: AuditEntry[] = audit.data.map((a) => ({
      id: String(a.id),
      action: a.action as AuditEntry["action"],
      questionId: a.question_id ?? "",
      detail: a.detail,
      createdAt: a.created_at,
    }));
    return { questions, counts, audit: log };
  }, true);
}

export async function adminCreateQuestion(input: {
  topic: string;
  body: string;
  options: string[];
  status: QuestionStatus;
  closesAt: string | null;
}): Promise<Result> {
  const { error } = await createClient().rpc("admin_create_question", {
    p_topic: input.topic,
    p_body: input.body,
    p_options: input.options,
    p_status: input.status,
    p_closes_at: input.closesAt,
  });
  return error ? fail(error) : { ok: true };
}

/** Publishing or reopening also clears a close time that has already passed. */
export async function adminSetStatus(q: Question, status: QuestionStatus): Promise<Result> {
  const expired = !!q.closesAt && new Date(q.closesAt).getTime() <= Date.now();
  const patch = status === "open" && expired ? { status, closes_at: null } : { status };
  const { error } = await createClient().from("questions").update(patch).eq("id", q.id);
  return error ? fail(error) : { ok: true };
}

/** Deletes the question; its options and votes go with it (ON DELETE CASCADE). */
export async function adminDeleteQuestion(questionId: string): Promise<Result> {
  const { error } = await createClient().from("questions").delete().eq("id", questionId);
  return error ? fail(error) : { ok: true };
}
