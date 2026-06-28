// A Scenario is a self-contained system-design challenge. Scenarios are graded
// easy→hard and played from a library — no story campaign, no ranks. Each level
// opens from an inherited starter board (or blank) and is scored on whether the
// design holds its SLA across a traffic window, within budget.

import type { Config, Metrics, ReqClass } from "../types";

export type Difficulty = "easy" | "medium" | "hard";

export interface Goal {
  id: string;
  label: string;
  ok: (m: Metrics) => boolean;
  actual: (m: Metrics) => string;
  target: string;
}

export interface Sla {
  availability: number; // 0..1
  p99Ms: number;
}

/** A node in a level's pre-built starting architecture. */
export interface StarterNode {
  ref: string; // stable local id, also used by edges (e.g. "app", "sql")
  type: string;
  /** Config overrides merged onto the component's defaults. */
  config?: Config;
  pos: { x: number; y: number };
}

/** The inherited architecture a level opens with. The implicit "client" source
 *  always exists; edges may reference it by the id "client". A level with no
 *  starter opens blank (client only). */
export interface Starter {
  nodes: StarterNode[];
  edges: [string, string][]; // [fromRef, toRef]
}

export interface Level {
  id: string;
  name: string;
  /** Inherited board this level opens with. Omit for a blank, from-scratch start. */
  starter?: Starter;
  /** Vivid one-line scene: what's happening right now. */
  situation: string;
  /** One-line objective shown on the brief. */
  brief: string;
  concepts: string[];
  /** Opt-in nudge, revealed only when the player asks. */
  hint: string;
  /** Peak offered load (the Client's rps at profile = 1) + write mix. */
  clientRps: number;
  clientWriteRatio: number;
  /** Workload as a mix of request classes (fractions). Omit ⇒ derived from
   *  writeRatio as {read, write}. */
  mix?: Partial<Record<ReqClass, number>>;
  /** Monthly budget cap (USD). Infinity = cost-is-the-score. */
  budgetUsd: number;
  parCostUsd?: number;
  sla: Sla;
  /** Label for the simulated time window (flavor). */
  windowLabel: string;
  /** Traffic multiplier over normalized window time t∈[0,1]; peak ≈ 1. */
  profile: (t: number) => number;
}

export interface Scenario {
  id: string;
  title: string;
  difficulty: Difficulty;
  /** Short description for the scenario card. */
  blurb: string;
  /** What real-world systems this teaches (card tags). */
  teaches: string[];
  /** Optional card art (served from /assets/scenarios). */
  art?: string;
  /** Component types available in this scenario's palette. */
  components: string[];
  levels: Level[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ms = (x: number) => `${Math.round(x)} ms`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function profileAt(level: Level, t: number): number {
  return clamp01(level.profile(clamp01(t)));
}

/** SLA → the two displayed goals. */
export function goalsFromSla(level: Level): Goal[] {
  const a = level.sla.availability;
  const p = level.sla.p99Ms;
  return [
    {
      id: "availability",
      label: "Availability",
      target: `≥ ${(a * 100).toFixed(a >= 0.999 ? 1 : 0)}%`,
      ok: (m) => m.availability >= a,
      actual: (m) => pct(m.availability),
    },
    {
      id: "p99",
      label: "p99 latency",
      target: `≤ ${p} ms`,
      ok: (m) => m.p99Ms <= p,
      actual: (m) => ms(m.p99Ms),
    },
  ];
}
