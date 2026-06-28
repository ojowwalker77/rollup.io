// The simulation engine.
//
// A steady-state flow model over the architecture graph. Traffic is TYPED: the
// source emits a mix of request classes (read / write / kv / media / search /
// event), and each class only travels toward a component that can serve it.
//
//   - Reachability: a class flows down an edge only if that edge leads to a
//     handler for it. A class with no handler on any path simply fails — which
//     is what makes "add the NoSQL store / search / queue" a real requirement,
//     not a cosmetic box.
//   - Series caches: a cache/CDN serves hits and forwards misses downstream, so
//     it genuinely offloads the store behind it (read-through). A cache with no
//     store behind it leaks its misses — they go unserved.
//   - Each component keeps its existing scalar evaluate(): the engine just feeds
//     it the rps of the classes it actually handles.

import { specOf } from "./components";
import type {
  ClassFlow,
  Config,
  Flow,
  Health,
  Metrics,
  NodeEval,
  NodeResult,
  ReqClass,
  RouteSpec,
  SimResult,
} from "./types";
import { REQ_CLASSES } from "./types";

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

function zeroClass(): ClassFlow {
  return { read: 0, write: 0, kv: 0, media: 0, search: 0, event: 0 };
}
function totalOf(f: ClassFlow): number {
  let s = 0;
  for (const c of REQ_CLASSES) s += f[c];
  return s;
}

/** Routing role for a component — explicit on the spec, else inferred by category. */
function routeOf(type: string): RouteSpec {
  const spec = specOf(type);
  if (spec.route) return spec.route;
  switch (spec.category) {
    case "source":
      return { role: "source" };
    case "delivery":
      return { role: "cdn" };
    case "storage":
    case "database":
      return { role: "store", serves: ["read", "write"] };
    case "data":
    case "integration":
      return { role: "store", serves: ["event"] };
    case "analytics":
      return { role: "store", serves: ["search"] };
    default:
      return { role: "compute" };
  }
}

/** Classes a node terminates itself (before considering downstream). */
function ownServes(route: RouteSpec): ReqClass[] {
  if (route.role === "cache") return ["read"];
  if (route.role === "cdn") return ["media"];
  if (route.role === "store") return route.serves ?? [];
  return [];
}

function cacheHit(c: Config): number {
  return Math.min(Number(c.memoryGB) / Math.max(Number(c.workingSetGB), 0.001), 0.99);
}
function cdnHit(c: Config): number {
  return Math.min(Number(c.edgeTb) / Math.max(Number(c.catalogTb), 0.001), 0.995);
}

/** The scalar (rps, writeRatio) a component's evaluate() should see, derived
 *  from the typed flow arriving at it. */
function scalarFor(r: RouteSpec, inc: ClassFlow): Flow {
  if (r.role === "compute" || r.role === "source") {
    const rps = totalOf(inc);
    return { rps, writeRatio: rps > EPS ? inc.write / rps : 0 };
  }
  if (r.role === "cache") {
    const rps = inc.read + inc.write;
    return { rps, writeRatio: rps > EPS ? inc.write / rps : 0 };
  }
  if (r.role === "cdn") {
    return { rps: inc.media, writeRatio: 0 };
  }
  // store: only the classes it serves
  const serves = r.serves ?? [];
  let rps = 0;
  let writeLike = 0;
  for (const c of serves) {
    rps += inc[c];
    if (c === "write" || c === "event") writeLike += inc[c]; // writes + event ingestion
  }
  return { rps, writeRatio: rps > EPS ? writeLike / rps : 0 };
}

function healthOf(inputRps: number, util: number): Health {
  if (inputRps <= EPS) return "idle";
  if (util < 0.75) return "healthy";
  if (util < 0.9) return "warn";
  if (util < 1) return "hot";
  return "fail";
}

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

interface PassResult {
  input: Map<string, ClassFlow>;
  evals: Map<string, NodeEval>;
  scalarIn: Map<string, Flow>;
  childFlow: Map<string, Map<string, number>>;
  served: number;
  offered: number;
}

export function runSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  traffic: number,
  mix?: Partial<ClassFlow>,
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

  // Reachable serveable classes (own ∪ downstream), reverse topological.
  const reach = new Map<string, Set<ReqClass>>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const node = byId.get(id)!;
    const s = new Set<ReqClass>(ownServes(routeOf(node.type)));
    for (const t of out.get(id) ?? []) reach.get(t)?.forEach((c) => s.add(c));
    reach.set(id, s);
  }

  const mixSum = mix ? REQ_CLASSES.reduce((a, c) => a + (mix[c] ?? 0), 0) : 0;

  // One typed forward pass. downstreamMs feeds compute nodes their concurrency
  // ceiling once the path latency below them is known.
  const forwardPass = (dsMap: Map<string, number>): PassResult => {
    const input = new Map<string, ClassFlow>();
    nodes.forEach((n) => input.set(n.id, zeroClass()));
    const evals = new Map<string, NodeEval>();
    const scalarIn = new Map<string, Flow>();
    const childFlow = new Map<string, Map<string, number>>();
    let served = 0;
    let offered = 0;

    // Seed sources from their configured load × the Traffic multiplier.
    for (const n of nodes) {
      if (routeOf(n.type).role !== "source") continue;
      const rps = Number(n.config.rps ?? 0) * traffic;
      const wr = Number(n.config.writeRatio ?? 0);
      const cf = zeroClass();
      if (mix && mixSum > EPS) {
        for (const c of REQ_CLASSES) cf[c] = rps * ((mix[c] ?? 0) / mixSum);
      } else {
        cf.read = rps * (1 - wr);
        cf.write = rps * wr;
      }
      input.set(n.id, cf);
      offered += rps;
    }

    for (const id of order) {
      const node = byId.get(id)!;
      const r = routeOf(node.type);
      const inc = input.get(id)!;
      const si = scalarFor(r, inc);
      scalarIn.set(id, si);

      let ev: NodeEval;
      if (r.role === "source") {
        ev = { capacity: Infinity, utilization: 0, serviceMs: 0, dropRate: 0, forward: { rps: si.rps, writeRatio: 0 } };
      } else {
        const ds = r.role === "compute" ? dsMap.get(id) ?? 0 : 0;
        ev = specOf(node.type).evaluate({ input: si, config: node.config, downstreamMs: ds });
      }
      evals.set(id, ev);

      const survive = 1 - ev.dropRate;
      const outFlow = zeroClass();
      let servedHere = 0;

      if (r.role === "source" || r.role === "compute") {
        for (const c of REQ_CLASSES) outFlow[c] = inc[c] * survive;
      } else if (r.role === "cache") {
        const hit = cacheHit(node.config);
        servedHere += inc.read * hit * survive; // hits absorbed
        outFlow.read = inc.read * (1 - hit) * survive; // misses fall through
        outFlow.write = inc.write * survive;
        outFlow.kv = inc.kv * survive;
        outFlow.media = inc.media * survive;
        outFlow.search = inc.search * survive;
        outFlow.event = inc.event * survive;
      } else if (r.role === "cdn") {
        const hit = cdnHit(node.config);
        servedHere += inc.media * hit * survive;
        outFlow.media = inc.media * (1 - hit) * survive;
        outFlow.read = inc.read * survive;
        outFlow.write = inc.write * survive;
        outFlow.kv = inc.kv * survive;
        outFlow.search = inc.search * survive;
        outFlow.event = inc.event * survive;
      } else {
        // store: consume the classes it serves; pass anything else through.
        const serves = new Set(r.serves ?? []);
        for (const c of REQ_CLASSES) {
          if (serves.has(c)) servedHere += inc[c] * survive;
          else outFlow[c] = inc[c];
        }
      }

      served += servedHere;

      // Route each outgoing class only toward children that can serve it.
      const children = out.get(id)!;
      const cf = new Map<string, number>();
      for (const c of REQ_CLASSES) {
        const amt = outFlow[c];
        if (amt <= EPS) continue;
        const capable = children.filter((t) => reach.get(t)?.has(c));
        if (capable.length === 0) continue; // unserved — dies here
        const share = amt / capable.length;
        for (const t of capable) {
          input.get(t)![c] += share;
          cf.set(t, (cf.get(t) ?? 0) + share);
        }
      }
      childFlow.set(id, cf);
    }

    return { input, evals, scalarIn, childFlow, served, offered };
  };

  // Pass A (downstream unknown) → derive path latency → Pass B (final).
  const passA = forwardPass(new Map());
  const dsMap = new Map<string, number>();
  const e2e = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const cf = passA.childFlow.get(id);
    let denom = 0;
    let ds = 0;
    if (cf) for (const [, v] of cf) denom += v;
    if (cf && denom > EPS) for (const [child, v] of cf) ds += (v / denom) * (e2e.get(child) ?? 0);
    dsMap.set(id, ds);
    e2e.set(id, passA.evals.get(id)!.serviceMs + ds);
  }
  const pass = forwardPass(dsMap);

  // ---- per-node results ----
  const results: Record<string, NodeResult> = {};
  let totalCostUsd = 0;
  for (const node of nodes) {
    const ev = pass.evals.get(node.id)!;
    const si = pass.scalarIn.get(node.id)!;
    const c = specOf(node.type).cost(node.config);
    totalCostUsd += c;
    results[node.id] = {
      id: node.id,
      type: node.type,
      input: si,
      capacity: ev.capacity,
      utilization: ev.utilization,
      serviceMs: ev.serviceMs,
      endToEndMs: e2e.get(node.id) ?? ev.serviceMs,
      dropRate: ev.dropRate,
      successProb: 1 - ev.dropRate,
      health: healthOf(si.rps, ev.utilization),
      costUsd: c,
      bottleneck: ev.bottleneck,
    };
  }

  // ---- availability: served fraction of offered ----
  const offeredRps = pass.offered;
  const servedRps = Math.min(pass.served, offeredRps);
  const availability = offeredRps > EPS ? servedRps / offeredRps : 1;
  const errorRate = 1 - availability;

  // ---- latency distribution via class-aware deterministic Monte Carlo ----
  const rand = mulberry32(0x9e3779b9);
  const walk = (id: string, c: ReqClass, depth: number): { t: number; ok: boolean } => {
    if (depth > 32) return { t: 0, ok: false };
    const node = byId.get(id)!;
    const r = routeOf(node.type);
    const t = expSample(pass.evals.get(id)!.serviceMs, rand());
    if (r.role === "store" && (r.serves ?? []).includes(c)) return { t, ok: true };
    if (r.role === "cache" && c === "read" && rand() < cacheHit(node.config)) return { t, ok: true };
    if (r.role === "cdn" && c === "media" && rand() < cdnHit(node.config)) return { t, ok: true };
    const capable = (out.get(id) ?? []).filter((tt) => reach.get(tt)?.has(c));
    if (capable.length === 0) return { t, ok: false };
    const sub = walk(capable[Math.floor(rand() * capable.length)]!, c, depth + 1);
    return { t: t + sub.t, ok: sub.ok };
  };

  const samples: number[] = [];
  const SAMPLES = 2000;
  if (offeredRps > EPS) {
    for (const n of nodes) {
      if (routeOf(n.type).role !== "source") continue;
      const cf = pass.input.get(n.id)!;
      for (const c of REQ_CLASSES) {
        const rps = cf[c];
        if (rps <= EPS) continue;
        const count = Math.max(1, Math.round(SAMPLES * (rps / offeredRps)));
        for (let i = 0; i < count; i++) {
          const w = walk(n.id, c, 0);
          if (w.ok) samples.push(w.t);
        }
      }
    }
  }
  samples.sort((a, b) => a - b);
  const quantile = (p: number) =>
    samples.length ? samples[Math.min(samples.length - 1, Math.floor(p * samples.length))]! : 0;
  const avgMs = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;

  let activeNodes = 0;
  let failingNodes = 0;
  for (const node of nodes) {
    if (routeOf(node.type).role === "source") continue;
    const r = results[node.id]!;
    if (r.input.rps <= EPS) continue;
    if (r.health === "fail") failingNodes++;
    else activeNodes++;
  }

  const metrics: Metrics = {
    offeredRps,
    servedRps,
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
