import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rankBids, RankError, priceScore, recordScore, tierScore, approachScore, type Bid, type JobBundle } from "../src/index.ts";

const BUNDLE: JobBundle = { job_id: "job-1", ceiling_usdc: 50, interfaces: ["rankBids"] };
const TESTED = "Repo https://github.com/acme/ranker. Exports rankBids. Tests: node:test suite with mutation checks.";
const UNTESTED = "I will write rankBids quickly and carefully, delivered as a single file soon.";

const bid = (id: string, over: Partial<Bid> = {}): Bid => ({ bid_id: id, agent_id: `agent-${id}`, price_usdc: 40, approach_md: TESTED, cerberus_tier: 0, ...over });
const words = (s: string) => s.trim().split(/\s+/).length;

describe("hard rule: tests beat price", () => {
  test("untested cheaper bid never outranks a tested one on price alone", () => {
    const r = rankBids(BUNDLE, [bid("cheap", { price_usdc: 1, approach_md: UNTESTED }), bid("tested", { price_usdc: 50 })]);
    assert.deepEqual(r.map((x) => x.bid_id), ["tested", "cheap"]);
  });
  test("holds even when the untested bid has a higher total score", () => {
    const r = rankBids(
      BUNDLE,
      [bid("u", { price_usdc: 0.01, approach_md: UNTESTED + " https://github.com/a/b", cerberus_tier: 3 }), bid("t", { price_usdc: 50 })],
      { "agent-u": { accepted: 50, rejected: 0 }, "agent-t": { accepted: 0, rejected: 5 } },
    );
    const u = r.find((x) => x.bid_id === "u")!, t = r.find((x) => x.bid_id === "t")!;
    assert.ok(u.score > t.score, "precondition: untested scores higher");
    assert.equal(t.rank, 1);
  });
  test("between two tested bids, the cheaper one wins all else equal", () => {
    const r = rankBids(BUNDLE, [bid("a", { price_usdc: 45 }), bid("b", { price_usdc: 30 })]);
    assert.deepEqual(r.map((x) => x.bid_id), ["b", "a"]);
  });
});

test("negated test claims count as untested", () => {
  for (const a of ["Ships rankBids with no tests, fast delivery and low price.", "Untested but quick implementation of rankBids for you.", "Delivered without tests to save time on rankBids work."])
    assert.equal(rankBids(BUNDLE, [bid("x", { approach_md: a })])[0]!.tested, false, a);
});

describe("eligibility", () => {
  test("over ceiling ranks last with reason, even if tested", () => {
    const r = rankBids(BUNDLE, [bid("over", { price_usdc: 50.01 }), bid("u", { approach_md: UNTESTED })]);
    assert.deepEqual(r.map((x) => [x.bid_id, x.eligible]), [["u", true], ["over", false]]);
    assert.equal(r[1]!.score, 0);
    assert.match(r[1]!.reason, /above the 50 USDC ceiling/);
  });
  test("exactly at ceiling is eligible (float safe)", () => {
    assert.equal(rankBids({ ...BUNDLE, ceiling_usdc: 0.3 }, [bid("x", { price_usdc: 0.1 + 0.2 })])[0]!.eligible, true);
  });
  test("zero, negative and NaN prices are ineligible", () => {
    for (const price_usdc of [0, -5, Number.NaN, Number.POSITIVE_INFINITY])
      assert.equal(rankBids(BUNDLE, [bid("x", { price_usdc })])[0]!.eligible, false, String(price_usdc));
  });
  test("approach shorter than 40 chars is ineligible", () => {
    const r = rankBids(BUNDLE, [bid("x", { approach_md: "tests " + "x".repeat(33) })]);
    assert.equal(r[0]!.eligible, false);
    assert.equal(rankBids(BUNDLE, [bid("y", { approach_md: "tests " + "x".repeat(34) })])[0]!.eligible, true);
  });
});

describe("determinism", () => {
  const bids = [bid("d", { price_usdc: 20 }), bid("a", { approach_md: UNTESTED }), bid("c", { price_usdc: 20 }), bid("b", { price_usdc: 60 }), bid("e", { cerberus_tier: 2 })];
  test("same input twice gives identical output", () => {
    assert.deepEqual(rankBids(BUNDLE, bids), rankBids(BUNDLE, bids));
  });
  test("input order does not matter", () => {
    const ref = rankBids(BUNDLE, bids);
    assert.deepEqual(rankBids(BUNDLE, [...bids].reverse()), ref);
    assert.deepEqual(rankBids(BUNDLE, [bids[2]!, bids[4]!, bids[0]!, bids[3]!, bids[1]!]), ref);
  });
  test("exact score tie breaks on bid_id ascending (byte order)", () => {
    const r = rankBids(BUNDLE, [bid("b"), bid("B"), bid("a")]);
    assert.deepEqual(r.map((x) => x.bid_id), ["B", "a", "b"]);
    assert.deepEqual(r.map((x) => x.rank), [1, 2, 3]);
  });
  test("does not mutate inputs", () => {
    const copy = structuredClone(bids);
    rankBids(BUNDLE, bids);
    assert.deepEqual(bids, copy);
  });
  test("duplicate bid_id is rejected", () => {
    assert.throws(() => rankBids(BUNDLE, [bid("a"), bid("a")]), RankError);
  });
  test("bad ceiling is rejected", () => {
    assert.throws(() => rankBids({ ...BUNDLE, ceiling_usdc: 0 }, [bid("a")]), RankError);
  });
  test("empty bids gives empty ranking", () => {
    assert.deepEqual(rankBids(BUNDLE, []), []);
  });
});

describe("reasons", () => {
  test("every bid gets a reason of at least 10 words naming the bid", () => {
    const r = rankBids(BUNDLE, [bid("a"), bid("b", { price_usdc: 99 }), bid("c", { approach_md: UNTESTED }), bid("d", { price_usdc: 0 }), bid("e", { approach_md: "short" })]);
    assert.equal(r.length, 5);
    for (const x of r) {
      assert.ok(words(x.reason) >= 10, `${x.bid_id}: ${x.reason}`);
      assert.ok(x.reason.includes(x.bid_id));
    }
  });
  test("reason reflects the actual terms", () => {
    const [x] = rankBids(BUNDLE, [bid("a", { price_usdc: 40 })], { "agent-a": { accepted: 3, rejected: 1 } });
    assert.match(x!.reason, /Price 40 USDC against a 50 USDC ceiling earns 14 points/);
    assert.match(x!.reason, /3 accepted and 1 rejected/);
    assert.match(x!.reason, /names tests/);
    assert.match(x!.reason, /scores \d+ of 100/);
  });
  test("untested reason says why it ranks lower", () => {
    const [x] = rankBids(BUNDLE, [bid("a", { approach_md: UNTESTED })]);
    assert.match(x!.reason, /names no tests/);
  });
  test("missing record is described as unproven", () => {
    assert.match(rankBids(BUNDLE, [bid("a")])[0]!.reason, /unproven/);
  });
});

describe("components", () => {
  test("price: 10 at ceiling, 30 when free, monotone in between", () => {
    assert.equal(priceScore(50, 50), 10);
    assert.equal(priceScore(25, 50), 20);
    assert.equal(priceScore(40, 50), 14);
    assert.equal(priceScore(0.01, 50), 29);
    for (let p = 1; p < 50; p++) assert.ok(priceScore(p, 50) >= priceScore(p + 1, 50));
  });
  test("record: unproven 10, all accepted near 20, all rejected near 0, bad data ignored", () => {
    assert.equal(recordScore(undefined), 10);
    assert.equal(recordScore({ accepted: 0, rejected: 0 }), 10);
    assert.equal(recordScore({ accepted: 8, rejected: 0 }), 18);
    assert.equal(recordScore({ accepted: 0, rejected: 8 }), 2);
    assert.equal(recordScore({ accepted: -5, rejected: 1.5 }), 10);
  });
  test("tier: 5 points per tier, clamped to 0..3, non integer is 0", () => {
    assert.deepEqual([undefined, 0, 1, 2, 3, 7, -1, 1.5].map(tierScore), [0, 0, 5, 10, 15, 15, 0, 0]);
  });
  test("approach: tests 15, repo 10, interface coverage 10", () => {
    assert.equal(approachScore(TESTED, ["rankBids"]).points, 35);
    assert.equal(approachScore(UNTESTED, ["rankBids"]).points, 10);
    assert.equal(approachScore("tests only, nothing else here at all", ["rankBids", "score"]).points, 15);
    assert.equal(approachScore("covers rankBids", ["rankBids", "score"]).covered, 1);
    assert.equal(approachScore("covers rankBidsX", ["rankBids"]).covered, 0);
    assert.equal(approachScore("plain text", []).points, 10);
  });
  test("repo link must be a real repo URL, not a bare domain", () => {
    assert.equal(approachScore("see github.com for details", []).points, 10);
    assert.equal(approachScore("see https://github.com/acme for details", []).points, 10);
    assert.equal(approachScore("see https://github.com/acme/x for details", []).points, 20);
  });
  test("record and tier change ranking among tested bids", () => {
    const r = rankBids(BUNDLE, [bid("a"), bid("b", { cerberus_tier: 1 })]);
    assert.equal(r[0]!.bid_id, "b");
    const r2 = rankBids(BUNDLE, [bid("a"), bid("b")], { "agent-b": { accepted: 4, rejected: 0 } });
    assert.equal(r2[0]!.bid_id, "b");
  });
  test("score is the sum of parts and within 0..100", () => {
    for (const x of rankBids(BUNDLE, [bid("a", { cerberus_tier: 3, price_usdc: 0.01 }), bid("b")], { "agent-a": { accepted: 1000, rejected: 0 } })) {
      const s = x.parts.price + x.parts.approach + x.parts.record + x.parts.tier;
      assert.equal(x.score, s);
      assert.ok(x.score >= 0 && x.score <= 100);
    }
  });
});
