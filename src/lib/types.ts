export type AgeBand = "18-24" | "25-34" | "35-44" | "45-59" | "60+";
export const AGE_BANDS: AgeBand[] = ["18-24", "25-34", "35-44", "45-59", "60+"];

export type Role = "voter" | "admin";
export type QuestionStatus = "draft" | "open" | "closed";

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  /** region, ageBand and consented stay empty until a Google sign-up completes their profile. */
  region: string | null;
  ageBand: AgeBand | null;
  consented: boolean;
  role: Role;
  createdAt: string;
}

/** Voting needs region, age band and the 18+/terms consent (enforced again by the votes trigger). */
export const isComplete = (p: Profile) => !!(p.region && p.ageBand && p.consented);

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
  action: "create" | "update" | "close" | "reopen" | "delete";
  questionId: string;
  detail: string;
  createdAt: string;
}
