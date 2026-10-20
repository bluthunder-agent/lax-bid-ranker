import type { Bid, JobBundle, RankedBid, Records } from "./types.ts";
import { isEligible, isTested, hasRepo, scoreBid } from "./score.ts";

export * from "./types.ts";
export * from "./score.ts";

export class RankError extends Error {}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Rank bids for one job. Pure and deterministic (no clock, no randomness, input order ignored).
 * Sort key, lexicographic: eligible first, then tested before untested, then score desc, then bid_id asc.
 * The tested gate comes before the score, so an untested bid can never outrank a tested one
 * through a lower price (or any other score term).
 */
export function rankBids(bundle: JobBundle, bids: readonly Bid[], records: Records = {}): RankedBid[] {
  if (!Number.isFinite(bundle.ceiling_usdc) || bundle.ceiling_usdc <= 0) throw new RankError("ceiling_usdc must be a positive number");
  const ids = new Set<string>();
  for (const b of bids) {
    if (typeof b.bid_id !== "string" || b.bid_id === "") throw new RankError("every bid needs a bid_id");
    if (ids.has(b.bid_id)) throw new RankError(`duplicate bid_id ${b.bid_id}`);
    ids.add(b.bid_id);
  }

  const rows = bids.map((bid) => {
    const elig = isEligible(bid, bundle);
    const tested = isTested(bid.approach_md);
    const { parts, covered } = scoreBid(bid, bundle, records[bid.agent_id]);
    const score = elig.ok ? parts.price + parts.approach + parts.record + parts.tier : 0;
    return { bid, elig, tested, parts, covered, score };
  });

  rows.sort(
    (x, y) =>
      Number(y.elig.ok) - Number(x.elig.ok) ||
      Number(y.tested) - Number(x.tested) ||
      y.score - x.score ||
      cmp(x.bid.bid_id, y.bid.bid_id),
  );

  return rows.map((r, i) => ({
    bid_id: r.bid.bid_id,
    rank: i + 1,
    score: r.score,
    eligible: r.elig.ok,
    tested: r.tested,
    parts: r.parts,
    reason: explain(r, bundle, records),
  }));
}

function explain(
  r: { bid: Bid; elig: { ok: boolean; why?: string }; tested: boolean; parts: { price: number; approach: number; record: number; tier: number }; covered: number; score: number },
  bundle: JobBundle,
  records: Records,
): string {
  if (!r.elig.ok) return `Bid ${r.bid.bid_id} is ineligible and ranked last because ${r.elig.why}.`;
  const rec = records[r.bid.agent_id];
  const recText = rec ? `a record of ${rec.accepted} accepted and ${rec.rejected} rejected deliveries` : "no delivery record, so it is scored as unproven";
  const n = bundle.interfaces?.length ?? 0;
  return [
    `Bid ${r.bid.bid_id} scores ${r.score} of 100.`,
    `Price ${r.bid.price_usdc} USDC against a ${bundle.ceiling_usdc} USDC ceiling earns ${r.parts.price} points.`,
    `The approach ${r.tested ? "names tests" : "names no tests, so it ranks below every tested bid"}, ${hasRepo(r.bid.approach_md) ? "links a public repo" : "links no public repo"}` +
      (n ? ` and covers ${r.covered} of ${n} required interfaces` : "") + `, for ${r.parts.approach} points.`,
    `The agent has ${recText} (${r.parts.record} points) and Cerberus tier ${r.parts.tier / 5} (${r.parts.tier} points).`,
  ].join(" ");
}
