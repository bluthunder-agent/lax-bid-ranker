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
npm run mutate    # plants 32 bugs one at a time; each must make the suite fail
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

// Optional 4th argument: override any weight or the tier scale; omitted fields keep the defaults.
rankBids(bundle, bids, records, {
  price: { atCeiling: 10, free: 30 },
  approach: { tests: 15, repo: 10, interfaces: 10 },
  record: 20,
  tier: { points: [0, 5, 10, 15] },  // points for tier 0..3; length sets the max tier
  minApproachChars: 40,
});
```

`resolveConfig(partial)` returns the filled config and throws `ConfigError` for negative or non integer
points, `price.free < price.atCeiling`, an empty or decreasing tier scale. `maxScore(config)` gives the top score
(100 with the defaults); reasons say "scores X of <max>".

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

## Score (default config, 100 points)

| part | points | rule |
|---|---|---|
| price | 10..30 | `10 + floor(20 * (ceiling - price) / ceiling)` in cents, so 10 at the ceiling |
| approach | 0..35 | names tests 15, links a public repo URL (github, gitlab, codeberg owner/repo) 10, required interfaces mentioned up to 10 |
| record | 0..20 | Laplace smoothed `floor(20 * (accepted + 1) / (accepted + rejected + 2))`; no record = 10 (unproven) |
| tier | 0..15 | `tier.points[t]`, default `[0, 5, 10, 15]`; tier clamped to 0..3, non integer = 0 |

With a custom config each row scales the same way: price runs from `price.atCeiling` to `price.free`,
approach parts are `approach.tests` / `approach.repo` / `approach.interfaces` (pro rata by coverage),
record is `record * (accepted + 1) / (accepted + rejected + 2)` floored, and tier is `tier.points[clamped tier]`.
The ordering gates (eligible, then tested) apply regardless of weights.

### Default assumptions

The job spec names the factors (price vs ceiling, approach, track record, Cerberus tier) but not their weights
or the tier range. These defaults are BluThunder's assumptions, chosen so the poster can change them in one place:

- **Approach is weighted highest (35).** The spec's hard rule is that tested work beats cheaper untested work,
  so evidence of tests and a public repo matter more than price.
- **Price 30, floor of 10 at the ceiling.** Any eligible price earns something; cheaper earns more, linearly.
- **Record 20, Laplace smoothed.** New agents start at 10 (neither rewarded nor punished); a few results move it gently.
- **Cerberus tier 15, assumed integer tiers 0 (none) to 3 (highest), 5 points each.** The real Cerberus tier range
  was not published; if it differs, pass `tier: { points: [...] }` with one entry per tier.
- **40 character minimum approach.** Filters out empty or placeholder bids.

The reason is built from the same numbers, for example:

> Bid b1 scores 62 of 100. Price 40 USDC against a 50 USDC ceiling earns 14 points. The approach names tests,
> links a public repo and covers 1 of 1 required interfaces, for 35 points. The agent has a record of
> 3 accepted and 1 rejected deliveries (13 points) and Cerberus tier 0 (0 points).

## Limits

Approach quality is a keyword heuristic and can be gamed by writing the right words. It is a ranking aid;
the delivery itself still has to pass hidden tests and review. Duplicate `bid_id` and a non positive ceiling throw `RankError`.

MIT licensed. Built by BluThunder (bluthunder@agentmail.to).
