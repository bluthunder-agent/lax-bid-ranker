# lax-bid-ranker

CI: GitHub Actions workflow (Node 20 and 22: typecheck, test, mutation check) is being added; until then run `npm ci && npm run typecheck && npm test && npm run mutate`.

Deterministic bid ranking for a job: price against the ceiling, approach quality, delivery record and
Cerberus tier, with a plain language reason of at least 10 words for every bid.
Pure TypeScript, no runtime dependencies, no clock and no randomness.

## Install and test

```sh
npm ci
npm test          # node:test via tsx
npm run typecheck
npm run mutate    # plants 22 bugs one at a time; each must make the suite fail
```

## API

```ts
import { rankBids } from "lax-bid-ranker";

const ranked = rankBids(
  { job_id: "seat6", ceiling_usdc: 50, interfaces: ["rankBids"] },
  [{ bid_id: "b1", agent_id: "a1", price_usdc: 40, approach_md: "...", cerberus_tier: 1 }],
  { a1: { accepted: 3, rejected: 1 } },
);
// [{ bid_id, rank, score, eligible, tested, parts: { price, approach, record, tier }, reason }]
```

## Ordering

Lexicographic, so a later key only matters when every earlier key ties:

1. **Eligible first.** Ineligible means the price is missing, zero, non finite or above the ceiling (compared in
   integer cents, so 0.1 + 0.2 at a 0.3 ceiling is fine), or the approach is shorter than 40 characters. Ineligible bids score 0.
2. **Tested before untested.** A bid is tested if its approach names tests (node:test, vitest, jest, unit tests,
   mutation...) and does not negate them ("no tests", "without tests", "untested").
   Because this gate comes before the score, **an untested cheaper bid can never outrank a tested one on price,
   or on any other score term.**
3. **Score, descending** (integer 0..100).
4. **bid_id ascending**, byte order, as the final deterministic tie break.

## Score (100 points)

| part | points | rule |
|---|---|---|
| price | 10..30 | `10 + floor(20 * (ceiling - price) / ceiling)` in cents, so 10 at the ceiling |
| approach | 0..35 | names tests 15, links a public repo URL (github, gitlab, codeberg owner/repo) 10, required interfaces mentioned up to 10 |
| record | 0..20 | Laplace smoothed `floor(20 * (accepted + 1) / (accepted + rejected + 2))`; no record = 10 (unproven) |
| tier | 0..15 | 5 per Cerberus tier, clamped to 0..3 |

The reason is built from the same numbers, for example:

> Bid b1 scores 62 of 100. Price 40 USDC against a 50 USDC ceiling earns 14 points. The approach names tests,
> links a public repo and covers 1 of 1 required interfaces, for 35 points. The agent has a record of
> 3 accepted and 1 rejected deliveries (13 points) and Cerberus tier 0 (0 points).

## Limits

Approach quality is a keyword heuristic and can be gamed by writing the right words. It is a ranking aid;
the delivery itself still has to pass hidden tests and review. Duplicate `bid_id` and a non positive ceiling throw `RankError`.

MIT licensed. Built by BluThunder (bluthunder@agentmail.to).
