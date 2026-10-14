/**
 * Stubbed data for the product surface.
 * Everything here is replaced by Postgres tables + RLS-guarded functions in a later
 * milestone (see PLAN.md). Keep all fake data in this one file.
 */
import type { AgeBand, Question } from "./types";
import { AGE_BANDS } from "./types";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

export const SEED_QUESTIONS: Question[] = [
  {
    id: "q-four-day-week",
    topic: "Work",
    body: "Should employers be required to offer a four-day working week option?",
    status: "open",
    opensAt: hoursAgo(3),
    closesAt: hoursFromNow(45),
    createdAt: hoursAgo(3),
    options: [
      { id: "o1", label: "Yes, by law", position: 1 },
      { id: "o2", label: "Encourage it, don't require it", position: 2 },
      { id: "o3", label: "No, leave it to employers", position: 3 },
    ],
  },
  {
    id: "q-phones-schools",
    topic: "Education",
    body: "Should smartphones be banned in schools for under-16s for the whole school day?",
    status: "open",
    opensAt: hoursAgo(20),
    closesAt: hoursFromNow(28),
    createdAt: hoursAgo(20),
    options: [
      { id: "o4", label: "Yes, full-day ban", position: 1 },
      { id: "o5", label: "Only during lessons", position: 2 },
      { id: "o6", label: "No ban", position: 3 },
    ],
  },
  {
    id: "q-ai-labels",
    topic: "Technology",
    body: "Should AI-generated images in political ads carry a mandatory label?",
    status: "open",
    opensAt: hoursAgo(30),
    closesAt: null,
    createdAt: hoursAgo(30),
    options: [
      { id: "o7", label: "Yes", position: 1 },
      { id: "o8", label: "No", position: 2 },
    ],
  },
  {
    id: "q-transit-fares",
    topic: "Cities",
    body: "Would you support free public transport, funded by a congestion charge on city centres?",
    status: "open",
    opensAt: hoursAgo(52),
    closesAt: hoursFromNow(4),
    createdAt: hoursAgo(52),
    options: [
      { id: "o9", label: "Strongly support", position: 1 },
      { id: "o10", label: "Somewhat support", position: 2 },
      { id: "o11", label: "Somewhat oppose", position: 3 },
      { id: "o12", label: "Strongly oppose", position: 4 },
    ],
  },
  {
    id: "q-voting-age",
    topic: "Politics",
    body: "Should the national voting age be lowered to 16?",
    status: "closed",
    opensAt: hoursAgo(200),
    closesAt: hoursAgo(30),
    createdAt: hoursAgo(200),
    options: [
      { id: "o13", label: "Yes", position: 1 },
      { id: "o14", label: "No", position: 2 },
      { id: "o15", label: "Not sure", position: 3 },
    ],
  },
  {
    id: "q-draft-housing",
    topic: "Housing",
    body: "Should short-term holiday lets be capped at 90 nights a year in big cities?",
    status: "draft",
    opensAt: hoursFromNow(24),
    closesAt: null,
    createdAt: hoursAgo(1),
    options: [
      { id: "o16", label: "Yes", position: 1 },
      { id: "o17", label: "No", position: 2 },
    ],
  },
];

/** Baseline votes per option (what option_counts would hold before the demo user votes). */
export const SEED_COUNTS: Record<string, number> = {
  o1: 1204, o2: 2210, o3: 998,
  o4: 3120, o5: 1840, o6: 702,
  o7: 5480, o8: 611,
  o9: 812, o10: 1290, o11: 744, o12: 980,
  o13: 1450, o14: 2380, o15: 410,
};

/** Deterministic pseudo-random so stubbed breakdowns are stable between renders. */
function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Stubbed age-band breakdown: voters per band and the share choosing a given option.
 * One band per question is deliberately small (<20) to show the privacy floor.
 */
export function stubAgeBreakdown(questionId: string, optionId: string, overallPct: number) {
  return AGE_BANDS.map((band: AgeBand) => {
    const r = seeded(questionId + band);
    const small = seeded(questionId) * AGE_BANDS.length;
    const voters = Math.floor(small) === AGE_BANDS.indexOf(band) ? 4 + Math.floor(r * 14) : 80 + Math.floor(r * 900);
    const drift = (seeded(optionId + band) - 0.5) * 30;
    const pct = Math.max(1, Math.min(99, Math.round(overallPct + drift)));
    return { band, voters, pct };
  });
}

export const REGION_SUGGESTIONS = [
  "London", "Manchester", "Scotland", "Wales", "California", "New York", "Texas",
  "Ontario", "New South Wales", "Maharashtra", "Dublin", "Berlin",
];
