"use client";
/**
 * Pulse Live: polls run by approved hosts, joined by a 6-character code. Audiences don't
 * need an account: a guest's browser signs in anonymously, so the database still allows one
 * vote each. Hosts only ever get totals.
 */
import { useCallback, useEffect, useState } from "react";
import { createClient } from "./supabase/client";
import type { Moderation, QuestionStatus, ResultsMode } from "./types";

type Result = { ok: true } | { ok: false; error: string };
const fail = (e: { message: string }): Result => ({ ok: false, error: e.message || "Something went wrong. Please try again." });

/** Join codes avoid look-alike characters (no 0/O, 1/I/L). */
export const normaliseCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
export const isCode = (s: string) => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(s);
export const joinUrl = (code: string) => `${window.location.origin}/live/${code}`;

// ---- audience ------------------------------------------------------------------

export type LivePoll = {
  id: string;
  code: string;
  topic: string;
  body: string;
  status: QuestionStatus;
  /** Taking votes right now (open, inside its time window, not paused or suspended). */
  open: boolean;
  resultsMode: ResultsMode;
  myOption: string | null;
  options: { id: string; label: string }[];
  /** null when this poll's results mode doesn't show results to the audience yet. */
  results: { optionId: string; votes: number }[] | null;
};

/** Members keep their session; anyone else becomes an anonymous guest (once per browser). */
export async function ensureSession() {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}

type LivePollJson = {
  id: string;
  code: string;
  topic: string;
  body: string;
  status: QuestionStatus;
  open: boolean;
  results_mode: ResultsMode;
  my_option: string | null;
  options: { id: string; label: string }[];
  results: { option_id: string; votes: number }[] | null;
};

/** The poll as its audience may see it, or null if the code is wrong or the poll isn't live. */
export async function fetchLivePoll(code: string): Promise<LivePoll | null> {
  const { data, error } = await createClient().rpc("live_poll", { p_code: code });
  if (error) throw error;
  const p = data as LivePollJson | null;
  if (!p) return null;
  return {
    id: p.id,
    code: p.code,
    topic: p.topic,
    body: p.body,
    status: p.status,
    open: p.open,
    resultsMode: p.results_mode,
    myOption: p.my_option,
    options: p.options ?? [],
    results: p.results?.map((r) => ({ optionId: r.option_id, votes: r.votes })) ?? null,
  };
}

// ---- hosts ---------------------------------------------------------------------

export type HostPoll = {
  id: string;
  code: string;
  topic: string;
  body: string;
  status: QuestionStatus;
  moderation: Moderation;
  sensitive: boolean;
  resultsMode: ResultsMode;
  createdAt: string;
  options: { id: string; label: string; votes: number }[];
  voters: number;
};

type HostPollRow = {
  id: string;
  join_code: string;
  topic: string;
  body: string;
  status: QuestionStatus;
  moderation: Moderation;
  sensitive: boolean;
  results_mode: ResultsMode;
  created_at: string;
  options: { id: string; label: string; position: number }[];
};

const HOST_POLL_COLUMNS =
  "id, join_code, topic, body, status, moderation, sensitive, results_mode, created_at, options(id, label, position)";

async function fetchTotals(): Promise<Record<string, number>> {
  const { data, error } = await createClient().rpc("host_poll_totals");
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as { option_id: string; votes: number }[]).map((t) => [t.option_id, t.votes]));
}

const toHostPoll = (r: HostPollRow, totals: Record<string, number>): HostPoll => {
  const options = [...r.options]
    .sort((a, b) => a.position - b.position)
    .map((o) => ({ id: o.id, label: o.label, votes: totals[o.id] ?? 0 }));
  return {
    id: r.id,
    code: r.join_code,
    topic: r.topic,
    body: r.body,
    status: r.status,
    moderation: r.moderation,
    sensitive: r.sensitive,
    resultsMode: r.results_mode,
    createdAt: r.created_at,
    options,
    voters: options.reduce((n, o) => n + o.votes, 0),
  };
};

export type HostInfo = {
  maxActivePolls: number;
  maxVotersPerPoll: number;
  livePollsPaused: boolean;
};

/** My live polls with totals, my limits, and whether the owner has paused Pulse Live. */
export function useHostPolls(userId: string) {
  const [data, setData] = useState<{ polls: HostPoll[]; info: HostInfo } | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const supabase = createClient();
    try {
      const [polls, totals, host, settings] = await Promise.all([
        supabase
          .from("questions")
          .select(HOST_POLL_COLUMNS)
          .eq("kind", "live")
          .eq("created_by", userId)
          .order("created_at", { ascending: false }),
        fetchTotals(),
        supabase.from("hosts").select("max_active_polls, max_voters_per_poll").eq("user_id", userId).maybeSingle(),
        supabase.from("platform_settings").select("live_polls_paused").single(),
      ]);
      if (polls.error) throw polls.error;
      setData({
        polls: (polls.data as HostPollRow[]).map((r) => toHostPoll(r, totals)),
        info: {
          maxActivePolls: host.data?.max_active_polls ?? 0,
          maxVotersPerPoll: host.data?.max_voters_per_poll ?? 0,
          livePollsPaused: !!settings.data?.live_polls_paused,
        },
      });
      setError("");
    } catch (e) {
      setError((e as { message?: string }).message || "Couldn't load your polls.");
    }
  }, [userId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}

/** One of my polls with live totals (presenter screen). null if it isn't mine. */
export async function fetchHostPoll(id: string): Promise<HostPoll | null> {
  const supabase = createClient();
  const [poll, totals] = await Promise.all([
    supabase.from("questions").select(HOST_POLL_COLUMNS).eq("id", id).eq("kind", "live").maybeSingle(),
    fetchTotals(),
  ]);
  if (poll.error) throw poll.error;
  return poll.data ? toHostPoll(poll.data as HostPollRow, totals) : null;
}

export async function hostCreatePoll(input: {
  topic: string;
  body: string;
  options: string[];
  sensitive: boolean;
  resultsMode: ResultsMode;
  open: boolean;
}): Promise<Result> {
  const { error } = await createClient().rpc("host_create_live_poll", {
    p_topic: input.topic,
    p_body: input.body,
    p_options: input.options,
    p_sensitive: input.sensitive,
    p_results_mode: input.resultsMode,
    p_open: input.open,
  });
  return error ? fail(error) : { ok: true };
}

export async function hostSetStatus(id: string, status: QuestionStatus): Promise<Result> {
  const { error } = await createClient().from("questions").update({ status }).eq("id", id);
  return error ? fail(error) : { ok: true };
}

export async function hostSetResultsMode(id: string, resultsMode: ResultsMode): Promise<Result> {
  const { error } = await createClient().from("questions").update({ results_mode: resultsMode }).eq("id", id);
  return error ? fail(error) : { ok: true };
}

/** Deletes the poll and its votes. */
export async function hostDeletePoll(id: string): Promise<Result> {
  const { error } = await createClient().from("questions").delete().eq("id", id);
  return error ? fail(error) : { ok: true };
}

// ---- applying and reporting ----------------------------------------------------

export async function applyToHost(organisation: string, note: string): Promise<Result> {
  const { error } = await createClient().rpc("apply_to_host", { p_organisation: organisation, p_note: note, p_agree: true });
  return error ? fail(error) : { ok: true };
}

export type ReportReason = "offensive" | "misleading" | "spam" | "political" | "other";

export const REPORT_REASONS: { reason: ReportReason; label: string }[] = [
  { reason: "offensive", label: "Offensive, hateful or harassing" },
  { reason: "misleading", label: "Misleading or false" },
  { reason: "political", label: "Election or political campaigning" },
  { reason: "spam", label: "Spam or advertising" },
  { reason: "other", label: "Something else" },
];

/** One report per person per poll; repeats are ignored. The Pulse team reviews every report. */
export async function reportPoll(questionId: string, reason: ReportReason, detail: string): Promise<Result> {
  const { error } = await createClient().rpc("report_poll", { p_question_id: questionId, p_reason: reason, p_detail: detail || null });
  return error ? fail(error) : { ok: true };
}
