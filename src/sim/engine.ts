// The simulation engine.
//
// A steady-state flow model over the architecture graph. It is deterministic
// and cheap, so it can run every tick. Three passes:
//
//   1. Forward (topological): push offered load from the Client through the
//      graph. Each node consumes/transforms its input and forwards a flow to
//      its dependencies. Edges are "fan-out": every dependency is called per
//      request (a Cache is the exception — it only forwards misses + writes).
//   2. Backward (reverse-topological): roll latency and success probability
//      back up from the leaves. A dependency only counts toward a node's
//      latency/failure in proportion to how often it is actually called
//      (so cache hits don't pay the database cost). This is also where an
//      App Server learns its downstream latency and re-checks whether a slow
//      dependency has starved its concurrency pool.
//   3. Aggregate: roll the per-node results up into headline metrics.

import { specOf } from "./components";
import type {
  Config,
  Flow,
  Health,
  Metrics,
  NodeEval,
  NodeResult,
  SimResult,
} from "./types";

export interface SimNode {
  id: string;
  type: string;
  config: Config;
}
export interface SimEdge {
  source: string;
  target: string;
}

const EPS = 1e-9;

/** Deterministic PRNG so latency percentiles (and thus scores) are reproducible. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw from an exponential with the given mean (captures queueing variance). */
function expSample(mean: number, u: number): number {
  return mean <= 0 ? 0 : -Math.log(1 - u) * mean;
}

function healthOf(inputRps: number, util: number): Health {
  if (inputRps <= EPS) return "idle";
  if (util < 0.75) return "healthy";
  if (util < 0.9) return "warn";
  if (util < 1) return "hot";
  return "fail";
}

/** Kahn topological sort; appends any nodes left in a cycle in stable order. */
function topoSort(nodes: SimNode[], out: Map<string, string[]>): string[] {
  const indeg = new Map<string, number>();
  nodes.forEach((n) => indeg.set(n.id, 0));
  for (const [, targets] of out) {
    for (const t of targets) indeg.set(t, (indeg.get(t) ?? 0) + 1);
  }
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const t of out.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 0) - 1);
      if ((indeg.get(t) ?? 0) <= 0 && !seen.has(t)) queue.push(t);
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n.id); // cycle fallback
  return order;
}

export function runSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  traffic: number,
): SimResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Adjacency (deduped, no self-loops).
  const out = new Map<string, string[]>();
  nodes.forEach((n) => out.set(n.id, []));
  const seenEdge = new Set<string>();
  for (const e of edges) {
    if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) continue;
    const key = `${e.source}->${e.target}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    out.get(e.source)!.push(e.target);
  }

  const order = topoSort(nodes, out);

  // ---- Pass 1: forward flow ----
  const input = new Map<string, Flow>();
  nodes.forEach((n) => input.set(n.id, { rps: 0, writeRatio: 0 }));

  const evals = new Map<string, NodeEval>();
  // weight = fraction of a node's input that it forwards to each dependency.
  const fwdWeight = new Map<string, number>();

  for (const id of order) {
    const node = byId.get(id)!;
    const spec = specOf(node.type);

    // Seed sources from their own configured load × the Traffic multiplier.
    if (spec.category === "source") {
      input.set(id, {
        rps: Number(node.config.rps ?? 0) * traffic,
        writeRatio: Number(node.config.writeRatio ?? 0),
      });
    }

    const inFlow = input.get(id)!;
    // Pass 1 evaluates with downstreamMs = 0; the backward pass refines any
    // node (App Server) whose capacity depends on downstream latency.
    const ev = spec.evaluate({ input: inFlow, config: node.config, downstreamMs: 0 });
    evals.set(id, ev);
    fwdWeight.set(id, inFlow.rps > EPS ? ev.forward.rps / inFlow.rps : 0);

    // Fan-out: every dependency receives this node's forwarded flow.
    for (const t of out.get(id)!) {
      const cur = input.get(t)!;
      const totalRps = cur.rps + ev.forward.rps;
      const writes = cur.rps * cur.writeRatio + ev.forward.rps * ev.forward.writeRatio;
      input.set(t, { rps: totalRps, writeRatio: totalRps > EPS ? writes / totalRps : 0 });
    }
  }

  // ---- Pass 2: backward latency + success ----
  const endToEnd = new Map<string, number>();
  const success = new Map<string, number>();

  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const node = byId.get(id)!;
    const spec = specOf(node.type);
    const children = out.get(id)!;
    const inFlow = input.get(id)!;

    let downstreamMs = 0;
    let depSuccess = 1;
    const w = fwdWeight.get(id)!; // how often this node calls its deps
    for (const c of children) {
      downstreamMs += w * (endToEnd.get(c) ?? 0);
      // With prob w the request needs the child; otherwise it skips it.
      depSuccess *= 1 - w + w * (success.get(c) ?? 1);
    }

    let ev = evals.get(id)!;
    // An App Server's real ceiling depends on how long downstream holds its
    // pool — recompute now that downstream latency is known.
    if (node.type === "app_server") {
      ev = spec.evaluate({ input: inFlow, config: node.config, downstreamMs });
      evals.set(id, ev);
    }

    endToEnd.set(id, ev.serviceMs + downstreamMs);
    success.set(id, (1 - ev.dropRate) * depSuccess);
  }

  // ---- Pass 3: aggregate ----
  const results: Record<string, NodeResult> = {};
  for (const node of nodes) {
    const ev = evals.get(node.id)!;
    const inFlow = input.get(node.id)!;
    results[node.id] = {
      id: node.id,
      type: node.type,
      input: inFlow,
      capacity: ev.capacity,
      utilization: ev.utilization,
      serviceMs: ev.serviceMs,
      endToEndMs: endToEnd.get(node.id) ?? ev.serviceMs,
      dropRate: ev.dropRate,
      successProb: success.get(node.id) ?? 1,
      health: healthOf(inFlow.rps, ev.utilization),
      costUsd: 0,
      bottleneck: ev.bottleneck,
    };
  }

  // Per-node cost + the design's monthly total.
  let totalCostUsd = 0;
  for (const node of nodes) {
    const c = specOf(node.type).cost(node.config);
    results[node.id]!.costUsd = c;
    totalCostUsd += c;
  }

  // Availability across all traffic sources (a source wired to nothing fails).
  const sources = nodes.filter((n) => specOf(n.type).category === "source");
  let offeredRps = 0;
  let weightedSuccess = 0;
  for (const s of sources) {
    const rps = input.get(s.id)!.rps;
    const hasOutlet = (out.get(s.id) ?? []).length > 0;
    offeredRps += rps;
    weightedSuccess += rps * (hasOutlet ? success.get(s.id) ?? 1 : 0);
  }
  const availability = offeredRps > EPS ? weightedSuccess / offeredRps : 1;
  const errorRate = 1 - availability;

  // Latency distribution via deterministic Monte Carlo.
  const rand = mulberry32(0x9e3779b9);
  const walk = (id: string, depth: number): number => {
    if (depth > 32) return 0;
    let t = expSample(evals.get(id)!.serviceMs, rand());
    const w = fwdWeight.get(id) ?? 0;
    for (const c of out.get(id) ?? []) {
      if (rand() < w) t += walk(c, depth + 1);
    }
    return t;
  };
  const samples: number[] = [];
  const SAMPLES = 2000;
  if (offeredRps > EPS) {
    for (const s of sources) {
      const rps = input.get(s.id)!.rps;
      if (rps <= EPS || (out.get(s.id) ?? []).length === 0) continue;
      const n = Math.max(1, Math.round(SAMPLES * (rps / offeredRps)));
      for (let i = 0; i < n; i++) samples.push(walk(s.id, 0));
    }
  }
  samples.sort((a, b) => a - b);
  const quantile = (p: number) =>
    samples.length ? samples[Math.min(samples.length - 1, Math.floor(p * samples.length))]! : 0;
  const avgMs = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;

  let activeNodes = 0;
  let failingNodes = 0;
  for (const node of nodes) {
    if (specOf(node.type).category === "source") continue;
    const r = results[node.id]!;
    if (r.input.rps <= EPS) continue;
    if (r.health === "fail") failingNodes++;
    else activeNodes++;
  }

  const metrics: Metrics = {
    offeredRps,
    servedRps: offeredRps * availability,
    avgMs,
    p95Ms: quantile(0.95),
    p99Ms: quantile(0.99),
    errorRate,
    availability,
    activeNodes,
    failingNodes,
    totalCostUsd,
  };

  return { nodes: results, metrics };
}
