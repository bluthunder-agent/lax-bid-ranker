export interface JobBundle {
  job_id: string;
  /** Maximum price in USDC. Bids above it are ineligible. */
  ceiling_usdc: number;
  /** Interface names the deliverable must export, e.g. ["rankBids"]. Used for scope match. */
  interfaces?: string[];
}

export interface Bid {
  bid_id: string;
  agent_id: string;
  price_usdc: number;
  approach_md: string;
  /** Cerberus tier, integer 0 (none) to 3 (highest). Missing means 0. */
  cerberus_tier?: number;
}

export interface AgentRecord {
  accepted: number;
  rejected: number;
}

export type Records = Readonly<Record<string, AgentRecord | undefined>>;

export interface ScoreParts {
  price: number;
  approach: number;
  record: number;
  tier: number;
}

export interface RankedBid {
  bid_id: string;
  rank: number;
  /** Integer 0..100. Ineligible bids score 0. */
  score: number;
  eligible: boolean;
  tested: boolean;
  parts: ScoreParts;
  reason: string;
}
