/**
 * Scoring configuration. Every number is an integer number of points.
 * The defaults are BluThunder's own assumptions, not values published by the job poster;
 * see the README "Default assumptions" section for the reasoning behind each one.
 */
export interface RankConfig {
  /** Price points: `atCeiling` for a bid exactly at the ceiling, rising linearly (in cents) to `free` at price 0. */
  price: { atCeiling: number; free: number };
  /** Approach points: names tests, links a public repo, mentions the required interfaces (pro rata). */
  approach: { tests: number; repo: number; interfaces: number };
  /** Max record points; Laplace smoothed acceptance rate times this. Unproven agents get half. */
  record: number;
  /**
   * Cerberus tier scale: points[t] is awarded for tier t. Tiers are integers 0..points.length-1;
   * higher tiers are clamped to the top, negative or non integer tiers count as 0.
   */
  tier: { points: number[] };
  /** Bids whose approach is shorter than this (trimmed) are ineligible. */
  minApproachChars: number;
}

export const DEFAULT_CONFIG: RankConfig = Object.freeze({
  price: Object.freeze({ atCeiling: 10, free: 30 }),
  approach: Object.freeze({ tests: 15, repo: 10, interfaces: 10 }),
  record: 20,
  tier: Object.freeze({ points: Object.freeze([0, 5, 10, 15]) as unknown as number[] }),
  minApproachChars: 40,
}) as RankConfig;

export type RankConfigInput = {
  price?: Partial<RankConfig["price"]>;
  approach?: Partial<RankConfig["approach"]>;
  record?: number;
  tier?: { points: number[] };
  minApproachChars?: number;
};

export class ConfigError extends Error {}

const nonNegInt = (v: number, name: string) => {
  if (!Number.isInteger(v) || v < 0) throw new ConfigError(`${name} must be a non negative integer`);
};

/** Fill defaults and validate. Throws ConfigError on bad values. */
export function resolveConfig(input: RankConfigInput = {}): RankConfig {
  const c: RankConfig = {
    price: { ...DEFAULT_CONFIG.price, ...input.price },
    approach: { ...DEFAULT_CONFIG.approach, ...input.approach },
    record: input.record ?? DEFAULT_CONFIG.record,
    tier: { points: [...(input.tier?.points ?? DEFAULT_CONFIG.tier.points)] },
    minApproachChars: input.minApproachChars ?? DEFAULT_CONFIG.minApproachChars,
  };
  nonNegInt(c.price.atCeiling, "price.atCeiling");
  nonNegInt(c.price.free, "price.free");
  if (c.price.free < c.price.atCeiling) throw new ConfigError("price.free must be >= price.atCeiling (cheaper never scores lower)");
  nonNegInt(c.approach.tests, "approach.tests");
  nonNegInt(c.approach.repo, "approach.repo");
  nonNegInt(c.approach.interfaces, "approach.interfaces");
  nonNegInt(c.record, "record");
  nonNegInt(c.minApproachChars, "minApproachChars");
  if (c.tier.points.length < 1) throw new ConfigError("tier.points needs at least one entry");
  c.tier.points.forEach((p, i) => {
    nonNegInt(p, `tier.points[${i}]`);
    if (i > 0 && p < c.tier.points[i - 1]!) throw new ConfigError("tier.points must be non decreasing");
  });
  return c;
}

/** Highest possible total score under a config (100 with the defaults). */
export function maxScore(c: RankConfig): number {
  return c.price.free + c.approach.tests + c.approach.repo + c.approach.interfaces + c.record + c.tier.points[c.tier.points.length - 1]!;
}
