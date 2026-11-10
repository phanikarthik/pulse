export type AgeBand = "18-24" | "25-34" | "35-44" | "45-59" | "60+";
export const AGE_BANDS: AgeBand[] = ["18-24", "25-34", "35-44", "45-59", "60+"];

export type Role = "voter" | "admin";
export type QuestionStatus = "draft" | "open" | "closed";
/** public = the owner's curated questions; live = a Pulse Live poll run by a host. */
export type QuestionKind = "public" | "live";
/** Only "ok" is visible to voters and takes votes. */
export type Moderation = "ok" | "awaiting_approval" | "hidden";
export type ResultsMode = "after_vote" | "live" | "presenter";
export type HostStatus = "pending" | "approved" | "suspended" | "rejected";

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  /**
   * districtCode, ageBand and consented stay empty until a Google sign-up completes their
   * profile. Older accounts have a typed region but no district until they pick one.
   */
  districtCode: number | null;
  /** "Mysuru, Karnataka", set by the database from the district. */
  region: string | null;
  ageBand: AgeBand | null;
  consented: boolean;
  role: Role;
  /** Approved by the owner to run Pulse Live polls. */
  isHost: boolean;
  /** null = never applied. */
  hostStatus: HostStatus | null;
  createdAt: string;
}

/** Voting needs a district, age band and the 18+/terms consent (enforced again by the votes trigger). */
export const isComplete = (p: Profile) => !!(p.districtCode && p.ageBand && p.consented);

export interface Option {
  id: string;
  label: string;
  position: number;
}

export interface Question {
  id: string;
  topic: string;
  body: string;
  status: QuestionStatus;
  opensAt: string;
  closesAt: string | null;
  createdAt: string;
  options: Option[];
  kind: QuestionKind;
  moderation: Moderation;
  /** Politics or elections: a host's poll waits for the owner's approval. */
  sensitive: boolean;
  resultsMode: ResultsMode;
  createdBy: string | null;
}

export interface OptionResult {
  optionId: string;
  label: string;
  votes: number;
  pct: number;
}

export interface Results {
  total: number;
  options: OptionResult[];
  myOptionId: string;
  agreePct: number;
  /** Share of each age band that chose the caller's option; null = under 20 voters (hidden). */
  byAge: { band: AgeBand; voters: number; pct: number | null }[];
}

export interface AuditEntry {
  id: string;
  action: "create" | "update" | "close" | "reopen" | "delete" | "hide" | "restore" | "approve" | "host" | "settings";
  questionId: string;
  detail: string;
  createdAt: string;
}
