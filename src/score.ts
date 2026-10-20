import type { AgentRecord, Bid, JobBundle, ScoreParts } from "./types.ts";

/** Points available per component; they sum to 100. */
export const WEIGHTS = { price: 30, approach: 35, record: 20, tier: 15 } as const;
export const MIN_APPROACH_CHARS = 40;

const TEST_RE = /\b(tests?|tested|testing|node:test|vitest|jest|mocha|unit test|property test|mutation)\b/i;
const NEG_RE = /\b(no|without|skip(ping)?|zero)\s+(unit\s+)?tests?\b|\buntested\b/i;
const REPO_RE = /\bhttps:\/\/(github\.com|gitlab\.com|codeberg\.org)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i;

const toCents = (usdc: number) => Math.round(usdc * 100);

export function isTested(approach: string): boolean {
  return TEST_RE.test(approach) && !NEG_RE.test(approach);
}
export function hasRepo(approach: string): boolean {
  return REPO_RE.test(approach);
}

export function isEligible(bid: Bid, bundle: JobBundle): { ok: boolean; why?: string } {
  if (!Number.isFinite(bid.price_usdc) || bid.price_usdc <= 0) return { ok: false, why: "its price is missing, zero or not a number" };
  if (toCents(bid.price_usdc) > toCents(bundle.ceiling_usdc)) return { ok: false, why: `its price of ${bid.price_usdc} USDC is above the ${bundle.ceiling_usdc} USDC ceiling` };
  if (bid.approach_md.trim().length < MIN_APPROACH_CHARS) return { ok: false, why: `its approach is shorter than ${MIN_APPROACH_CHARS} characters` };
  return { ok: true };
}

/** 10 points at the ceiling, up to 30 for a free bid, linear in integer cents. */
export function priceScore(price: number, ceiling: number): number {
  const p = toCents(price), c = toCents(ceiling);
  return 10 + Math.floor((20 * (c - p)) / c);
}

/** Tests named 15, public repo 10, interface coverage up to 10. */
export function approachScore(approach: string, interfaces: readonly string[] = []): { points: number; covered: number } {
  let points = 0;
  if (isTested(approach)) points += 15;
  if (hasRepo(approach)) points += 10;
  const covered = interfaces.filter((name) => new RegExp(`\\b${name.replace(/[^A-Za-z0-9_$]/g, "")}\\b`).test(approach)).length;
  points += interfaces.length ? Math.floor((10 * covered) / interfaces.length) : 10;
  return { points, covered };
}

/** Laplace smoothed acceptance rate: unproven agents get 10 of 20. */
export function recordScore(rec: AgentRecord | undefined): number {
  const a = rec && Number.isInteger(rec.accepted) && rec.accepted > 0 ? rec.accepted : 0;
  const r = rec && Number.isInteger(rec.rejected) && rec.rejected > 0 ? rec.rejected : 0;
  return Math.floor((WEIGHTS.record * (a + 1)) / (a + r + 2));
}

export function tierScore(tier: number | undefined): number {
  const t = Number.isInteger(tier) ? Math.min(3, Math.max(0, tier as number)) : 0;
  return t * 5;
}

export function scoreBid(bid: Bid, bundle: JobBundle, rec: AgentRecord | undefined): { parts: ScoreParts; covered: number } {
  const ap = approachScore(bid.approach_md, bundle.interfaces);
  return {
    parts: {
      price: priceScore(bid.price_usdc, bundle.ceiling_usdc),
      approach: ap.points,
      record: recordScore(rec),
      tier: tierScore(bid.cerberus_tier),
    },
    covered: ap.covered,
  };
}
