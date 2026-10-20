import type { AgentRecord, Bid, JobBundle, ScoreParts } from "./types.ts";
import { DEFAULT_CONFIG, type RankConfig } from "./config.ts";

/** Default max points per component (they sum to 100). Derived from DEFAULT_CONFIG; configure via RankConfig. */
export const WEIGHTS = Object.freeze({
  price: DEFAULT_CONFIG.price.free,
  approach: DEFAULT_CONFIG.approach.tests + DEFAULT_CONFIG.approach.repo + DEFAULT_CONFIG.approach.interfaces,
  record: DEFAULT_CONFIG.record,
  tier: DEFAULT_CONFIG.tier.points[DEFAULT_CONFIG.tier.points.length - 1]!,
});
export const MIN_APPROACH_CHARS = DEFAULT_CONFIG.minApproachChars;

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

export function isEligible(bid: Bid, bundle: JobBundle, minChars: number = MIN_APPROACH_CHARS): { ok: boolean; why?: string } {
  if (!Number.isFinite(bid.price_usdc) || bid.price_usdc <= 0) return { ok: false, why: "its price is missing, zero or not a number" };
  if (toCents(bid.price_usdc) > toCents(bundle.ceiling_usdc)) return { ok: false, why: `its price of ${bid.price_usdc} USDC is above the ${bundle.ceiling_usdc} USDC ceiling` };
  if (bid.approach_md.trim().length < minChars) return { ok: false, why: `its approach is shorter than ${minChars} characters` };
  return { ok: true };
}

/** Defaults: 10 points at the ceiling, up to 30 for a free bid, linear in integer cents. */
export function priceScore(price: number, ceiling: number, cfg: RankConfig["price"] = DEFAULT_CONFIG.price): number {
  const p = toCents(price), c = toCents(ceiling);
  return cfg.atCeiling + Math.floor(((cfg.free - cfg.atCeiling) * (c - p)) / c);
}

/** Defaults: tests named 15, public repo 10, interface coverage up to 10 (full points when none are required). */
export function approachScore(
  approach: string,
  interfaces: readonly string[] = [],
  cfg: RankConfig["approach"] = DEFAULT_CONFIG.approach,
): { points: number; covered: number } {
  let points = 0;
  if (isTested(approach)) points += cfg.tests;
  if (hasRepo(approach)) points += cfg.repo;
  const covered = interfaces.filter((name) => new RegExp(`\\b${name.replace(/[^A-Za-z0-9_$]/g, "")}\\b`).test(approach)).length;
  points += interfaces.length ? Math.floor((cfg.interfaces * covered) / interfaces.length) : cfg.interfaces;
  return { points, covered };
}

/** Laplace smoothed acceptance rate times max (default 20): unproven agents get half. */
export function recordScore(rec: AgentRecord | undefined, max: number = DEFAULT_CONFIG.record): number {
  const a = rec && Number.isInteger(rec.accepted) && rec.accepted > 0 ? rec.accepted : 0;
  const r = rec && Number.isInteger(rec.rejected) && rec.rejected > 0 ? rec.rejected : 0;
  return Math.floor((max * (a + 1)) / (a + r + 2));
}

/** Tier clamped into the scale: integers only, below 0 is 0, above the top is the top. */
export function effectiveTier(tier: number | undefined, scale: RankConfig["tier"] = DEFAULT_CONFIG.tier): number {
  return Number.isInteger(tier) ? Math.min(scale.points.length - 1, Math.max(0, tier as number)) : 0;
}

/** Defaults: 0, 5, 10, 15 points for tiers 0..3. */
export function tierScore(tier: number | undefined, scale: RankConfig["tier"] = DEFAULT_CONFIG.tier): number {
  return scale.points[effectiveTier(tier, scale)]!;
}

export function scoreBid(
  bid: Bid,
  bundle: JobBundle,
  rec: AgentRecord | undefined,
  cfg: RankConfig = DEFAULT_CONFIG,
): { parts: ScoreParts; covered: number } {
  const ap = approachScore(bid.approach_md, bundle.interfaces, cfg.approach);
  return {
    parts: {
      price: priceScore(bid.price_usdc, bundle.ceiling_usdc, cfg.price),
      approach: ap.points,
      record: recordScore(rec, cfg.record),
      tier: tierScore(bid.cerberus_tier, cfg.tier),
    },
    covered: ap.covered,
  };
}
