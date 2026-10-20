import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rankBids, resolveConfig, maxScore, DEFAULT_CONFIG, ConfigError, WEIGHTS, type Bid, type JobBundle } from "../src/index.ts";

const BUNDLE: JobBundle = { job_id: "job-1", ceiling_usdc: 50, interfaces: ["rankBids"] };
const TESTED = "Repo https://github.com/acme/ranker. Exports rankBids. Tests: node:test suite with mutation checks.";
const UNTESTED = "I will write rankBids quickly and carefully, delivered as a single file soon.";
const bid = (id: string, over: Partial<Bid> = {}): Bid => ({ bid_id: id, agent_id: `agent-${id}`, price_usdc: 40, approach_md: TESTED, cerberus_tier: 0, ...over });
const one = (cfg?: Parameters<typeof rankBids>[3], over: Partial<Bid> = {}) => rankBids(BUNDLE, [bid("a", over)], {}, cfg)[0]!;

describe("defaults", () => {
  test("documented defaults: 10..30 price, 15/10/10 approach, 20 record, 0/5/10/15 tiers, 40 chars, max 100", () => {
    assert.deepEqual(resolveConfig(), {
      price: { atCeiling: 10, free: 30 },
      approach: { tests: 15, repo: 10, interfaces: 10 },
      record: 20,
      tier: { points: [0, 5, 10, 15] },
      minApproachChars: 40,
    });
    assert.equal(maxScore(DEFAULT_CONFIG), 100);
    assert.deepEqual({ ...WEIGHTS }, { price: 30, approach: 35, record: 20, tier: 15 });
  });
  test("no config, empty config and explicit defaults rank identically", () => {
    const bids = [bid("a"), bid("b", { price_usdc: 20, cerberus_tier: 2 }), bid("c", { approach_md: UNTESTED })];
    const ref = rankBids(BUNDLE, bids);
    assert.deepEqual(rankBids(BUNDLE, bids, {}, {}), ref);
    assert.deepEqual(rankBids(BUNDLE, bids, {}, DEFAULT_CONFIG), ref);
  });
  test("resolveConfig does not mutate or share DEFAULT_CONFIG", () => {
    const c = resolveConfig();
    c.tier.points.push(99);
    assert.deepEqual(resolveConfig().tier.points, [0, 5, 10, 15]);
  });
});

describe("overrides", () => {
  test("price weights", () => {
    assert.equal(one({ price: { atCeiling: 0, free: 100 } }).parts.price, 20);
    assert.equal(one({ price: { free: 50 } }).parts.price, 18); // partial: atCeiling keeps its default 10
  });
  test("approach weights", () => {
    assert.equal(one({ approach: { tests: 0, repo: 0, interfaces: 5 } }).parts.approach, 5);
    assert.equal(one({ approach: { tests: 1 } }).parts.approach, 21);
  });
  test("record weight", () => {
    assert.equal(one({ record: 40 }).parts.record, 20);
  });
  test("tier scale: custom length and points, clamped to its top", () => {
    const cfg = { tier: { points: [0, 1, 2, 3, 4, 50] } };
    assert.equal(one(cfg, { cerberus_tier: 5 }).parts.tier, 50);
    assert.equal(one(cfg, { cerberus_tier: 9 }).parts.tier, 50);
    assert.equal(one(cfg, { cerberus_tier: 2 }).parts.tier, 2);
    assert.match(one(cfg, { cerberus_tier: 9 }).reason, /Cerberus tier 5 \(50 points\)/);
    assert.equal(one(undefined, { cerberus_tier: 5 }).parts.tier, 15);
    assert.match(one(undefined, { cerberus_tier: 5 }).reason, /Cerberus tier 3 \(15 points\)/);
  });
  test("min approach length", () => {
    assert.equal(one({ minApproachChars: 500 }).eligible, false);
    assert.match(one({ minApproachChars: 500 }).reason, /shorter than 500 characters/);
  });
  test("score stays the sum of parts and reason names the configured max", () => {
    const cfg = { price: { atCeiling: 0, free: 100 }, tier: { points: [0, 50] } };
    const r = one(cfg, { cerberus_tier: 1 });
    assert.equal(r.score, r.parts.price + r.parts.approach + r.parts.record + r.parts.tier);
    assert.match(r.reason, new RegExp(`scores ${r.score} of ${maxScore(resolveConfig(cfg))}\\.`));
  });
  test("tested gate holds under any weights", () => {
    const r = rankBids(BUNDLE, [bid("t", { price_usdc: 50 }), bid("u", { price_usdc: 0.01, approach_md: UNTESTED, cerberus_tier: 3 })], {}, {
      price: { atCeiling: 0, free: 1000 },
      approach: { tests: 0 },
    });
    assert.deepEqual(r.map((x) => x.bid_id), ["t", "u"]);
  });
});

describe("validation", () => {
  test("bad configs throw ConfigError", () => {
    const bad = [
      { price: { atCeiling: -1 } },
      { price: { free: 1.5 } },
      { price: { atCeiling: 20, free: 10 } },
      { approach: { tests: -5 } },
      { record: -1 },
      { tier: { points: [] } },
      { tier: { points: [0, 10, 5] } },
      { tier: { points: [0, -1] } },
      { minApproachChars: 2.5 },
    ];
    for (const c of bad) assert.throws(() => rankBids(BUNDLE, [bid("a")], {}, c as never), ConfigError, JSON.stringify(c));
  });
});
