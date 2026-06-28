// Turn a failed run into a specific, teachable explanation — what broke and
// what to do about it. How MUCH you can see depends on the observability you
// wired: full (metrics+logs+traces) → root cause; basic (metrics) → which
// component is hot; none → you're flying blind. That's MTTR, made tangible.

import { specOf } from "./components";
import type { Level } from "./scenarios";
import type { ReqClass, SimResult } from "./types";

export type ObsLevel = "none" | "basic" | "full";

const CLASS_INFO: Record<ReqClass, { what: string; fix: string }> = {
  read: { what: "reads", fix: "add a cache (in series) or read replicas and scale the read path" },
  write: { what: "writes", fix: "scale the database primary tier — replicas don't help writes" },
  kv: { what: "high-volume key-value writes", fix: "add a NoSQL store and add nodes as it gets hot" },
  media: { what: "media (images / audio / files)", fix: "serve it through a CDN backed by object storage" },
  search: { what: "search queries", fix: "add a dedicated search index on the app path" },
  event: { what: "events", fix: "add an event queue to absorb them off the hot path" },
  realtime: { what: "live messages", fix: "add a realtime gateway and scale its instances" },
  inference: { what: "model predictions", fix: "add an inference server and cache hot predictions" },
};

export interface Diagnosis {
  headline: string;
  points: string[];
}

const pctNeed = (a: number) => `${(a * 100).toFixed(a >= 0.999 ? 1 : 0)}%`;

export function diagnoseLoss(
  level: Level,
  result: SimResult,
  lostCustomers: boolean,
  obs: ObsLevel = "full",
): Diagnosis {
  const m = result.metrics;

  // Cost is always visible (it's the bill, not telemetry).
  if (!lostCustomers) {
    const over = Math.max(0, m.totalCostUsd - level.budgetUsd);
    const costly = Object.values(result.nodes)
      .filter((n) => specOf(n.type).category !== "source" && n.costUsd > 0)
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 3)
      .map((n) => `${specOf(n.type).label} — $${Math.round(n.costUsd).toLocaleString()}/mo`);
    return {
      headline: `Over budget by $${Math.round(over).toLocaleString()}/mo`,
      points: ["It held the SLA — this one's just the bill. Your heaviest tiers:", ...costly],
    };
  }

  // The outcome (headline) is observable from users / the run, regardless of o11y.
  let headline: string;
  if (m.p99Ms > level.sla.p99Ms && m.availability >= level.sla.availability) {
    headline = `Too slow — p99 hit ${Math.round(m.p99Ms)}ms (target ${level.sla.p99Ms}ms)`;
  } else if (m.availability < level.sla.availability) {
    headline = `Requests were failing — ${pctNeed(m.availability)} served, need ${pctNeed(level.sla.availability)}`;
  } else {
    headline = "The design buckled under load";
  }

  // Flying blind: you see it broke, not why.
  if (obs === "none") {
    return {
      headline,
      points: [
        "No observability wired — you can see it broke, but not why.",
        "Add metrics/logs/traces and run it back: that gap is your MTTR.",
      ],
    };
  }

  // Metrics-only: you can see which boxes are hot, not the root cause.
  if (obs === "basic") {
    const hot = Object.values(result.nodes)
      .filter((n) => n.health === "fail" || n.health === "hot")
      .sort((a, b) => b.utilization - a.utilization)
      .map((n) => specOf(n.type).label);
    const points = hot.length
      ? [`Metrics show these running hot: ${[...new Set(hot)].join(", ")}.`, "Add logs + traces (full observability) to see the root cause."]
      : ["Metrics look healthy but requests are still failing — add logs + traces to see where they're going."];
    return { headline, points };
  }

  // Full observability: root cause + fix.
  const points: string[] = [];
  const starved = (Object.keys(result.classes) as ReqClass[])
    .map((c) => ({ c, ...result.classes[c] }))
    .filter((x) => x.offered > 1 && x.served / x.offered < 0.98)
    .sort((a, b) => b.offered - b.served - (a.offered - a.served));
  for (const s of starved) {
    const lost = Math.round((1 - s.served / s.offered) * 100);
    points.push(`${lost}% of ${CLASS_INFO[s.c].what} never got served — ${CLASS_INFO[s.c].fix}.`);
  }
  const hot = Object.values(result.nodes)
    .filter((n) => n.bottleneck && (n.health === "fail" || n.health === "hot"))
    .sort((a, b) => b.utilization - a.utilization)
    .slice(0, 3);
  for (const n of hot) points.push(`${specOf(n.type).label} saturated — ${n.bottleneck}.`);
  if (m.p99Ms > level.sla.p99Ms && starved.length === 0 && hot.length === 0) {
    const slow = Object.values(result.nodes)
      .filter((n) => n.input.rps > 1 && specOf(n.type).category !== "source")
      .sort((a, b) => b.serviceMs - a.serviceMs)[0];
    if (slow) {
      points.push(
        `Most requests waited on ${specOf(slow.type).label} (~${Math.round(slow.serviceMs)}ms). Serve more from cache/edge so fewer requests pay that cost.`,
      );
    }
  }
  if (points.length === 0) points.push("The SLA slipped under peak load — give the busiest tier more headroom.");
  return { headline, points };
}
