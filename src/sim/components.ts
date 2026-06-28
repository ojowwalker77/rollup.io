// The component catalog.
//
// Each spec encodes the levers that ACTUALLY matter for that component:
//   - App Server scales with stateless replicas + CPU, but a slow dependency
//     can starve its thread/connection pool no matter how many replicas it has.
//   - SQL reads scale with read replicas; WRITES DO NOT (single primary).
//     It can also bottleneck purely on its connection pool.
//   - A Cache's lever is memory vs. working-set (hit ratio), not "replicas".
//     It absorbs reads and shifts the *write mix* of everything downstream.
//   - NoSQL scales BOTH reads and writes by adding nodes — but strong
//     consistency costs throughput and latency.
//   - Object storage is effectively unbounded throughput; its cost is latency.

import type { ComponentSpec, EvalContext, Flow, NodeEval } from "./types";

// ---- shared helpers ----

/** M/M/1 sojourn-time approximation: latency blows up as utilization → 1. */
function queue(baseMs: number, util: number): number {
  const u = Math.min(Math.max(util, 0), 0.995);
  return baseMs / (1 - u);
}

/** Fraction shed when offered load exceeds capacity. */
function shed(util: number): number {
  return util > 1 ? 1 - 1 / util : 0;
}

const SINK: Flow = { rps: 0, writeRatio: 0 };

// SQL instance tiers → sustained queries/sec on the primary (read or write).
// Sustained queries/sec on the primary for a transactional booking workload
// (availability search + reservations are heavier than trivial key lookups).
const SQL_TIERS: Record<string, number> = {
  small: 800,
  medium: 2500,
  large: 7000,
  xlarge: 18000,
};

// Rough monthly cloud costs (USD/mo) — tuned so the economic trade-offs match
// reality (a cache is far cheaper per read than a relational read replica).
const VCPU_USD_MO = 30;
const SQL_TIER_USD: Record<string, number> = { small: 200, medium: 700, large: 2000, xlarge: 5000 };
const CACHE_GB_USD_MO = 12;
const NOSQL_NODE_USD_MO = 180;
const OBJECT_STORE_USD_MO = 10;
const SEARCH_NODE_USD_MO = 220;
const QUEUE_PARTITION_USD_MO = 90;

function cacheEval({ input, config }: EvalContext, label = "cache throughput (ops/sec)"): NodeEval {
  const memoryGB = Number(config.memoryGB);
  const workingSetGB = Number(config.workingSetGB);
  const maxOps = Number(config.maxOps);
  const hitMs = Number(config.hitLatencyMs);

  const hitRatio = Math.min(memoryGB / Math.max(workingSetGB, 0.001), 0.99);

  const reads = input.rps * (1 - input.writeRatio);
  const writes = input.rps * input.writeRatio;
  const misses = reads * (1 - hitRatio);

  const utilization = input.rps / maxOps;
  const forwardRps = misses + writes;

  return {
    capacity: maxOps,
    utilization,
    serviceMs: queue(hitMs, utilization),
    dropRate: shed(utilization),
    forward: {
      rps: forwardRps,
      writeRatio: forwardRps > 0 ? writes / forwardRps : 0,
    },
    bottleneck: utilization >= 0.9 ? label : undefined,
  };
}

function computeEval(
  { input, config, downstreamMs }: EvalContext,
  labels: { units: string; cpu: string; concurrency: string },
): NodeEval {
  const units = Number(config[labels.units]);
  const vcpus = Number(config.vcpus);
  const cpuMs = Number(config.cpuMsPerReq);
  const maxConc = Number(config.maxConcurrency);
  const cpuCapacity = units * vcpus * (1000 / cpuMs);
  const holdMs = cpuMs + downstreamMs;
  const concCapacity = (units * maxConc) / (holdMs / 1000);
  const capacity = Math.min(cpuCapacity, concCapacity);
  const utilization = capacity > 0 ? input.rps / capacity : Infinity;
  return {
    capacity,
    utilization,
    serviceMs: queue(cpuMs, utilization),
    dropRate: shed(utilization),
    forward: { rps: input.rps * (1 - shed(utilization)), writeRatio: input.writeRatio },
    bottleneck:
      utilization >= 0.9
        ? concCapacity < cpuCapacity
          ? labels.concurrency
          : labels.cpu
        : undefined,
  };
}

function passThroughEval(
  { input, config }: EvalContext,
  capacityKey: string,
  latencyKey: string,
  bottleneck: string,
): NodeEval {
  const capacity = Number(config[capacityKey]);
  const latency = Number(config[latencyKey]);
  const utilization = capacity > 0 ? input.rps / capacity : Infinity;
  return {
    capacity,
    utilization,
    serviceMs: queue(latency, utilization),
    dropRate: shed(utilization),
    forward: { rps: input.rps * (1 - shed(utilization)), writeRatio: input.writeRatio },
    bottleneck: utilization >= 0.9 ? bottleneck : undefined,
  };
}

/** Without an index, every query is a full table scan: far slower and far fewer
 *  queries/sec on the same hardware. This is a DATA-layer lever — the fix is the
 *  index, not a bigger instance. */
const SCAN_PENALTY = 10;

function sqlEval({ input, config }: EvalContext, tierScale = 1): NodeEval {
  const scan = String(config.indexed) === "no" ? SCAN_PENALTY : 1;
  const base = ((SQL_TIERS[String(config.tier)] ?? 6000) * tierScale) / scan;
  const readReplicas = Number(config.readReplicas);
  const maxConn = Number(config.maxConnections);
  const queryMs = Number(config.queryMs) * scan;

  const reads = input.rps * (1 - input.writeRatio);
  const writes = input.rps * input.writeRatio;

  const readCapacity = base * (1 + readReplicas);
  const writeCapacity = base;
  const connCapacity = maxConn / (queryMs / 1000);

  const readUtil = reads / readCapacity;
  const writeUtil = writes / writeCapacity;
  const connUtil = input.rps / connCapacity;

  const utilization = Math.max(readUtil, writeUtil, connUtil);
  let bottleneck: string | undefined;
  if (utilization >= 0.9) {
    if (scan > 1) bottleneck = "unindexed full table scan — add an index before scaling the box";
    else if (utilization === writeUtil) bottleneck = "write throughput — single primary, add tier not replicas";
    else if (utilization === readUtil) bottleneck = "read throughput — add replicas or a cache";
    else bottleneck = "connection pool exhausted";
  }

  return {
    capacity: input.rps > 0 ? input.rps / utilization : readCapacity,
    utilization,
    serviceMs: queue(queryMs, utilization),
    dropRate: shed(utilization),
    forward: SINK,
    bottleneck,
  };
}

function partitionedEval(
  { input, config }: EvalContext,
  opts: { unitKey: string; perUnit: number; latencyKey: string; strongKey?: string; bottleneck: string },
): NodeEval {
  const units = Number(config[opts.unitKey]);
  const latency = Number(config[opts.latencyKey]);
  const strong = opts.strongKey ? String(config[opts.strongKey]) === "strong" : false;
  const strongPenalty = strong ? 0.55 : 1;
  const capacity = units * opts.perUnit * strongPenalty;
  const utilization = capacity > 0 ? input.rps / capacity : Infinity;
  return {
    capacity,
    utilization,
    serviceMs: queue(latency * (strong ? 1.5 : 1), utilization),
    dropRate: shed(utilization),
    forward: SINK,
    bottleneck: utilization >= 0.9 ? opts.bottleneck : undefined,
  };
}

function queueEval(
  { input, config }: EvalContext,
  opts: { unitKey: string; consumerKey?: string; perUnit: number; perConsumer?: number; ackKey: string; bottleneck: string },
): NodeEval {
  const units = Number(config[opts.unitKey]);
  const consumers = opts.consumerKey ? Number(config[opts.consumerKey]) : units;
  const ackMs = Number(config[opts.ackKey]);
  const writeRps = input.rps * Math.max(input.writeRatio, 0.05);
  const ingestCapacity = units * opts.perUnit;
  const drainCapacity = consumers * (opts.perConsumer ?? opts.perUnit);
  const capacity = Math.min(ingestCapacity, drainCapacity);
  const utilization = capacity > 0 ? writeRps / capacity : Infinity;
  return {
    capacity,
    utilization,
    serviceMs: queue(ackMs, utilization),
    dropRate: shed(utilization),
    forward: SINK,
    bottleneck: utilization >= 0.9 ? opts.bottleneck : undefined,
  };
}

function sinkEval(
  { input, config }: EvalContext,
  capacityKey: string,
  latencyKey: string,
  bottleneck: string,
): NodeEval {
  const capacity = Number(config[capacityKey]);
  const latency = Number(config[latencyKey]);
  const utilization = capacity > 0 ? input.rps / capacity : Infinity;
  return {
    capacity,
    utilization,
    serviceMs: queue(latency, utilization),
    dropRate: shed(utilization),
    forward: SINK,
    bottleneck: utilization >= 0.9 ? bottleneck : undefined,
  };
}

const SOURCE_FIELDS: ComponentSpec["fields"] = [
  {
    key: "rps",
    label: "Requests / sec",
    type: "number",
    min: 0,
    max: 200000,
    step: 50,
    unit: "rps",
    help: "Base offered load. The Traffic slider multiplies this at run time.",
  },
  {
    key: "writeRatio",
    label: "Write mix",
    type: "slider",
    min: 0,
    max: 1,
    step: 0.05,
    unit: "writes",
    help: "Share of requests that mutate data. Reads can be cached and replicated; writes cannot.",
  },
];

const sourceEval = ({ input }: EvalContext): NodeEval => ({
  capacity: Infinity,
  utilization: 0,
  serviceMs: 0,
  dropRate: 0,
  forward: input,
});

const SQL_FIELDS: ComponentSpec["fields"] = [
  { key: "tier", label: "Instance tier", type: "select", options: [
    { value: "small", label: "small · 800 qps" },
    { value: "medium", label: "medium · 2.5k qps" },
    { value: "large", label: "large · 7k qps" },
    { value: "xlarge", label: "xlarge · 18k qps" },
  ], help: "Vertical scale of the primary. This is the ONLY thing that raises write throughput." },
  { key: "readReplicas", label: "Read replicas", type: "number", min: 0, max: 20, step: 1, help: "Each replica adds read capacity. Does nothing for writes — they must go to the primary." },
  { key: "maxConnections", label: "Connection pool", type: "number", min: 10, max: 5000, step: 10, help: "Concurrent connections. Slow queries hold connections longer and can exhaust the pool before CPU." },
  { key: "queryMs", label: "Base query latency", type: "number", min: 0.5, max: 200, step: 0.5, unit: "ms", help: "Service time of a typical query. Drives both latency and how long a connection is held." },
];

const REDIS_FIELDS: ComponentSpec["fields"] = [
  { key: "memoryGB", label: "Memory", type: "number", min: 1, max: 2048, step: 1, unit: "GB", help: "Hot keys that fit in memory are served without touching the primary datastore." },
  { key: "workingSetGB", label: "Working set", type: "number", min: 1, max: 8192, step: 1, unit: "GB", help: "Hot metadata/session footprint. If it exceeds memory, misses flow downstream." },
  { key: "maxOps", label: "Throughput", type: "number", min: 1000, max: 3000000, step: 1000, unit: "ops/s", help: "Redis is fast, but still bounded by CPU, networking, and clustering." },
  { key: "hitLatencyMs", label: "Hit latency", type: "number", min: 0.1, max: 20, step: 0.1, unit: "ms", help: "Latency for a hit before any downstream miss path is paid." },
];

const CDN_FIELDS: ComponentSpec["fields"] = [
  { key: "edgeTb", label: "Edge cache", type: "number", min: 1, max: 500, step: 1, unit: "TB", help: "Regional content cached close to users. More edge capacity means fewer origin fetches." },
  { key: "catalogTb", label: "Hot catalog", type: "number", min: 1, max: 1000, step: 1, unit: "TB", help: "Active objects users are currently requesting." },
  { key: "maxRps", label: "Edge throughput", type: "number", min: 10000, max: 5000000, step: 10000, unit: "rps", help: "Aggregate regional edge capacity." },
  { key: "hitLatencyMs", label: "Hit latency", type: "number", min: 5, max: 100, step: 1, unit: "ms", help: "Requests should mostly pay edge latency, not origin latency." },
];

function cdnEval({ input, config }: EvalContext): NodeEval {
  const edgeTb = Number(config.edgeTb);
  const catalogTb = Number(config.catalogTb);
  const maxRps = Number(config.maxRps);
  const hitMs = Number(config.hitLatencyMs);
  const hitRatio = Math.min(edgeTb / Math.max(catalogTb, 0.001), 0.995);
  const utilization = input.rps / maxRps;
  const misses = input.rps * (1 - hitRatio);
  return {
    capacity: maxRps,
    utilization,
    serviceMs: queue(hitMs, utilization),
    dropRate: shed(utilization),
    forward: { rps: misses, writeRatio: 0 },
    bottleneck: utilization >= 0.9 ? "edge throughput / regional CDN capacity" : undefined,
  };
}

const OBJECT_STORE_FIELDS: ComponentSpec["fields"] = [
  { key: "firstByteMs", label: "Time to first byte", type: "number", min: 5, max: 500, step: 5, unit: "ms", help: "Object stores are durable and scale endlessly, so throughput is rarely the limit — latency is the cost you pay." },
];

function objectStoreEval({ input, config }: EvalContext): NodeEval {
  const firstByteMs = Number(config.firstByteMs);
  const capacity = 1e9;
  const utilization = input.rps / capacity;
  return {
    capacity,
    utilization,
    serviceMs: firstByteMs,
    dropRate: 0,
    forward: SINK,
  };
}

const SEARCH_FIELDS: ComponentSpec["fields"] = [
  { key: "nodes", label: "Search nodes", type: "number", min: 1, max: 100, step: 1, help: "Search capacity scales by adding data/query nodes and spreading shards." },
  { key: "shardGb", label: "Shard size", type: "number", min: 10, max: 500, step: 10, unit: "GB", help: "Large shards increase query work and heap pressure." },
  { key: "queryMs", label: "Base query latency", type: "number", min: 2, max: 100, step: 1, unit: "ms", help: "Baseline query time before queueing." },
];

function searchEval({ input, config }: EvalContext): NodeEval {
  const nodes = Number(config.nodes);
  const shardGb = Number(config.shardGb);
  const queryMs = Number(config.queryMs);
  const shardPenalty = Math.max(0.35, 1 - Math.max(0, shardGb - 80) / 500);
  const capacity = nodes * 4500 * shardPenalty;
  const utilization = input.rps / capacity;
  return {
    capacity,
    utilization,
    serviceMs: queue(queryMs, utilization),
    dropRate: shed(utilization),
    forward: SINK,
    bottleneck: utilization >= 0.9 ? "search shard/query capacity" : undefined,
  };
}

export const COMPONENTS: Record<string, ComponentSpec> = {
  // ----------------------------------------------------------------- SOURCE
  client: {
    type: "client",
    category: "source",
    label: "Scenario Traffic",
    blurb: "Default traffic mix for the current level. Real-world scenarios can add separate web, mobile, and partner sources.",
    accent: "#9ca3af",
    defaults: { rps: 1200, writeRatio: 0.2 },
    route: { role: "source" },
    cost: () => 0,
    fields: [
      {
        key: "rps",
        label: "Requests / sec",
        type: "number",
        min: 0,
        max: 200000,
        step: 50,
        unit: "rps",
        help: "Base offered load. The Traffic slider multiplies this at run time.",
      },
      {
        key: "writeRatio",
        label: "Write mix",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.05,
        unit: "writes",
        help: "Share of requests that mutate data. Reads can be cached and replicated; writes cannot.",
      },
    ],
    evaluate: ({ input }: EvalContext): NodeEval => ({
      capacity: Infinity,
      utilization: 0,
      serviceMs: 0,
      dropRate: 0,
      forward: input,
    }),
  },

  // ---------------------------------------------------------------- COMPUTE
  app_server: {
    type: "app_server",
    category: "compute",
    label: "Stateless App Service",
    blurb: "Provider-neutral fleet of stateless service instances behind a load balancer: VMs, containers, or pods in real deployments.",
    accent: "#38bdf8",
    defaults: { replicas: 1, vcpus: 2, cpuMsPerReq: 2, maxConcurrency: 256, queriesPerReq: 1, io: "async" },
    route: { role: "compute" },
    cost: (c) => Number(c.replicas) * Number(c.vcpus) * VCPU_USD_MO,
    fields: [
      { key: "replicas", label: "Replicas", type: "number", min: 1, max: 200, step: 1, help: "Stateless instances behind the load balancer. Throughput scales ~linearly." },
      { key: "vcpus", label: "vCPU / replica", type: "number", min: 1, max: 64, step: 1, help: "Cores per instance. CPU-bound throughput = cores ÷ CPU-time-per-request." },
      { key: "cpuMsPerReq", label: "CPU per request", type: "number", min: 0.5, max: 200, step: 0.5, unit: "ms", help: "Compute cost of one request. Heavier handlers serve fewer rps per core." },
      { key: "maxConcurrency", label: "Max concurrency / replica", type: "number", min: 1, max: 4096, step: 1, help: "In-flight requests per instance. A slow downstream holds these open and can exhaust the pool even with spare CPU." },
      { key: "queriesPerReq", label: "DB queries / request", type: "number", min: 1, max: 50, step: 1, help: "CODE lever. 1 = batched. Higher = the N+1 problem: each request fans into many datastore queries, multiplying load downstream. Fix the query, don't scale the DB." },
      { key: "io", label: "I/O model", type: "select", options: [
        { value: "async", label: "async (non-blocking)" },
        { value: "blocking", label: "blocking" },
      ], help: "CODE lever. Blocking holds a thread for the whole downstream round-trip, so a slow dependency exhausts the pool. Async frees the thread while it waits." },
    ],
    evaluate: ({ input, config, downstreamMs }: EvalContext): NodeEval => {
      const replicas = Number(config.replicas);
      const vcpus = Number(config.vcpus);
      const cpuMs = Number(config.cpuMsPerReq);
      const maxConc = Number(config.maxConcurrency);

      // CODE levers: N+1 makes `queriesPerReq` sequential downstream calls per
      // request; blocking I/O holds the thread for the whole wait, async frees it.
      const queriesPerReq = Math.max(1, Number(config.queriesPerReq ?? 1));
      const blocking = String(config.io ?? "async") === "blocking";
      const downstreamPerReq = queriesPerReq * downstreamMs; // N sequential round-trips

      // CPU-bound ceiling.
      const cpuCapacity = replicas * vcpus * (1000 / cpuMs);

      // Concurrency ceiling (Little's law): max throughput = pool / hold_time.
      const holdMs = cpuMs + (blocking ? downstreamPerReq : 0);
      const concCapacity = (replicas * maxConc) / (holdMs / 1000);

      const capacity = Math.min(cpuCapacity, concCapacity);
      const utilization = capacity > 0 ? input.rps / capacity : Infinity;
      const bottleneck =
        utilization >= 0.9
          ? concCapacity < cpuCapacity
            ? queriesPerReq > 1
              ? "thread pool — N+1 queries holding threads on the downstream (batch the query)"
              : blocking
                ? "thread pool — blocking on a slow downstream (go async)"
                : "thread pool — held open by slow downstream"
            : "CPU"
          : undefined;

      return {
        capacity,
        utilization,
        // N+1 adds the latency of the extra sequential round-trips per request.
        serviceMs: queue(cpuMs, utilization) + (queriesPerReq - 1) * downstreamMs,
        dropRate: shed(utilization),
        // Stateless tier forwards the surviving load to its dependencies.
        forward: { rps: input.rps * (1 - shed(utilization)), writeRatio: input.writeRatio },
        bottleneck,
      };
    },
  },

  api_gateway: {
    type: "api_gateway",
    category: "compute",
    label: "API Gateway",
    blurb: "Managed edge entrypoint for routing, auth checks, throttling, and request fanout.",
    accent: "#60a5fa",
    defaults: { gateways: 2, maxRpsPerGateway: 12000, overheadMs: 3 },
    route: { role: "compute" },
    cost: (c) => Number(c.gateways) * 180,
    fields: [
      { key: "gateways", label: "Gateway units", type: "number", min: 1, max: 50, step: 1, help: "Regional gateway capacity. Add units when routing/auth itself becomes the first bottleneck." },
      { key: "maxRpsPerGateway", label: "RPS / unit", type: "number", min: 1000, max: 100000, step: 1000, unit: "rps", help: "Managed gateways scale well, but still have configured throttles and regional limits." },
      { key: "overheadMs", label: "Routing overhead", type: "number", min: 1, max: 50, step: 1, unit: "ms", help: "Latency added before the request reaches application services." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const capacity = Number(config.gateways) * Number(config.maxRpsPerGateway);
      const utilization = capacity > 0 ? input.rps / capacity : Infinity;
      return {
        capacity,
        utilization,
        serviceMs: queue(Number(config.overheadMs), utilization),
        dropRate: shed(utilization),
        forward: { rps: input.rps * (1 - shed(utilization)), writeRatio: input.writeRatio },
        bottleneck: utilization >= 0.9 ? "gateway throttle / regional ingress" : undefined,
      };
    },
  },

  // ---------------------------------------------------------------- STORAGE
  sql: {
    type: "sql",
    category: "storage",
    label: "SQL Database",
    blurb: "Relational primary + read replicas. Reads scale out; writes are stuck on the primary.",
    accent: "#f59e0b",
    defaults: { tier: "medium", readReplicas: 0, maxConnections: 200, queryMs: 6, indexed: "yes" },
    route: { role: "store", serves: ["read", "write"] },
    cost: (c) => (SQL_TIER_USD[String(c.tier)] ?? 700) * (1 + Number(c.readReplicas) * 0.9),
    fields: [
      { key: "tier", label: "Instance tier", type: "select", options: [
        { value: "small", label: "small · 800 qps" },
        { value: "medium", label: "medium · 2.5k qps" },
        { value: "large", label: "large · 7k qps" },
        { value: "xlarge", label: "xlarge · 18k qps" },
      ], help: "Vertical scale of the primary. This is the ONLY thing that raises write throughput." },
      { key: "indexed", label: "Hot query index", type: "select", options: [
        { value: "yes", label: "indexed" },
        { value: "no", label: "no index (full scan)" },
      ], help: "DATA lever. Without an index the hot query is a full table scan — ~10× slower and ~10× fewer qps. The fix is the index, not a bigger instance." },
      { key: "readReplicas", label: "Read replicas", type: "number", min: 0, max: 20, step: 1, help: "Each replica adds read capacity. Does nothing for writes — they must go to the primary." },
      { key: "maxConnections", label: "Connection pool", type: "number", min: 10, max: 5000, step: 10, help: "Concurrent connections. Slow queries hold connections longer and can exhaust the pool before CPU." },
      { key: "queryMs", label: "Base query latency", type: "number", min: 0.5, max: 200, step: 0.5, unit: "ms", help: "Service time of a typical query. Drives both latency and how long a connection is held." },
    ],
    evaluate: (ctx): NodeEval => sqlEval(ctx),
  },

  cache: {
    type: "cache",
    category: "storage",
    label: "Redis Cache",
    blurb: "Redis-style read-through cache. Its lever is memory vs. working set — not replicas.",
    accent: "#34d399",
    defaults: { memoryGB: 8, workingSetGB: 20, maxOps: 100000, hitLatencyMs: 0.5 },
    route: { role: "cache" },
    cost: (c) => Number(c.memoryGB) * CACHE_GB_USD_MO,
    fields: [
      { key: "memoryGB", label: "Memory", type: "number", min: 1, max: 1024, step: 1, unit: "GB", help: "Cacheable RAM. Hit ratio ≈ memory ÷ working set, so more memory = more reads absorbed." },
      { key: "workingSetGB", label: "Working set", type: "number", min: 1, max: 4096, step: 1, unit: "GB", help: "Size of the hot, frequently-read data. If it dwarfs memory, the hit ratio collapses." },
      { key: "maxOps", label: "Throughput", type: "number", min: 1000, max: 2000000, step: 1000, unit: "ops/s", help: "Ceiling of the cache itself (often single-threaded, e.g. Redis). Even a cache can saturate." },
      { key: "hitLatencyMs", label: "Hit latency", type: "number", min: 0.1, max: 20, step: 0.1, unit: "ms", help: "Latency of a cache hit. Misses additionally pay the downstream cost." },
    ],
    evaluate: (ctx): NodeEval => cacheEval(ctx),
  },

  redis: {
    type: "redis",
    category: "storage",
    label: "Redis",
    blurb: "In-memory cache/session store for hot metadata, tokens, and rate-limit counters.",
    accent: "#ef4444",
    defaults: { memoryGB: 24, workingSetGB: 48, maxOps: 180000, hitLatencyMs: 0.7 },
    route: { role: "cache" },
    cost: (c) => Number(c.memoryGB) * CACHE_GB_USD_MO,
    fields: [
      { key: "memoryGB", label: "Memory", type: "number", min: 1, max: 2048, step: 1, unit: "GB", help: "Hot keys that fit in memory are served without touching the primary datastore." },
      { key: "workingSetGB", label: "Working set", type: "number", min: 1, max: 8192, step: 1, unit: "GB", help: "Hot metadata/session footprint. If it exceeds memory, misses flow downstream." },
      { key: "maxOps", label: "Throughput", type: "number", min: 1000, max: 3000000, step: 1000, unit: "ops/s", help: "Redis is fast, but still bounded by CPU, networking, and clustering." },
      { key: "hitLatencyMs", label: "Hit latency", type: "number", min: 0.1, max: 20, step: 0.1, unit: "ms", help: "Latency for a hit before any downstream miss path is paid." },
    ],
    evaluate: (ctx): NodeEval => cacheEval(ctx, "Redis ops/sec"),
  },

  nosql: {
    type: "nosql",
    category: "storage",
    label: "NoSQL DB",
    blurb: "Partitioned store. Scales reads AND writes by adding nodes — at the cost of strong consistency.",
    accent: "#a78bfa",
    defaults: { nodes: 3, replicationFactor: 3, consistency: "eventual", opMs: 4 },
    route: { role: "store", serves: ["kv"] },
    cost: (c) => Number(c.nodes) * NOSQL_NODE_USD_MO,
    fields: [
      { key: "nodes", label: "Nodes", type: "number", min: 1, max: 200, step: 1, help: "Partitions/shards. Capacity scales horizontally for reads and writes alike — the key difference from SQL." },
      { key: "replicationFactor", label: "Replication factor", type: "number", min: 1, max: 7, step: 1, help: "Copies of each partition. Higher = more durable/available, but strong writes need a quorum." },
      { key: "consistency", label: "Consistency", type: "select", options: [
        { value: "eventual", label: "eventual (fast)" },
        { value: "strong", label: "strong (quorum)" },
      ], help: "Strong consistency requires quorum reads/writes — it roughly halves effective throughput and adds latency." },
      { key: "opMs", label: "Base op latency", type: "number", min: 0.5, max: 100, step: 0.5, unit: "ms", help: "Service time of a single key operation." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const nodes = Number(config.nodes);
      const consistency = String(config.consistency);
      const opMs = Number(config.opMs);

      const perNode = 1500;
      const strongPenalty = consistency === "strong" ? 0.5 : 1;
      const capacity = perNode * nodes * strongPenalty; // scales with nodes

      const utilization = capacity > 0 ? input.rps / capacity : Infinity;
      const effOpMs = opMs * (consistency === "strong" ? 1.5 : 1);

      return {
        capacity,
        utilization,
        serviceMs: queue(effOpMs, utilization),
        dropRate: shed(utilization),
        forward: SINK,
        bottleneck:
          utilization >= 0.9 ? "partition throughput — add nodes" : undefined,
      };
    },
  },

  object_store: {
    type: "object_store",
    category: "storage",
    label: "Object Store",
    blurb: "Blob storage (S3-style). Effectively infinite scale and durability — but high latency.",
    accent: "#fb923c",
    defaults: { firstByteMs: 60 },
    route: { role: "store", serves: ["media"] },
    cost: () => OBJECT_STORE_USD_MO,
    fields: [
      { key: "firstByteMs", label: "Time to first byte", type: "number", min: 5, max: 500, step: 5, unit: "ms", help: "Object stores are durable and scale endlessly, so throughput is rarely the limit — latency is the cost you pay." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const firstByteMs = Number(config.firstByteMs);
      const capacity = 1e9; // effectively unbounded
      const utilization = input.rps / capacity;
      return {
        capacity,
        utilization,
        serviceMs: firstByteMs, // flat — no meaningful queueing
        dropRate: 0,
        forward: SINK,
      };
    },
  },

  cdn: {
    type: "cdn",
    category: "delivery",
    label: "CDN",
    blurb: "Edge cache for audio chunks, images, and static assets; misses fall back to origin storage.",
    accent: "#22c55e",
    defaults: { edgeTb: 8, catalogTb: 12, maxRps: 250000, hitLatencyMs: 18 },
    route: { role: "cdn" },
    cost: (c) => 350 + Number(c.edgeTb) * 45,
    fields: [
      { key: "edgeTb", label: "Edge cache", type: "number", min: 1, max: 500, step: 1, unit: "TB", help: "Regional content cached close to listeners. More edge capacity means fewer origin fetches." },
      { key: "catalogTb", label: "Hot catalog", type: "number", min: 1, max: 1000, step: 1, unit: "TB", help: "Active tracks/artwork users are currently requesting." },
      { key: "maxRps", label: "Edge throughput", type: "number", min: 10000, max: 5000000, step: 10000, unit: "rps", help: "Aggregate regional edge capacity." },
      { key: "hitLatencyMs", label: "Hit latency", type: "number", min: 5, max: 100, step: 1, unit: "ms", help: "Playback requests should mostly pay edge latency, not origin latency." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const edgeTb = Number(config.edgeTb);
      const catalogTb = Number(config.catalogTb);
      const maxRps = Number(config.maxRps);
      const hitMs = Number(config.hitLatencyMs);
      const hitRatio = Math.min(edgeTb / Math.max(catalogTb, 0.001), 0.995);
      const utilization = input.rps / maxRps;
      const misses = input.rps * (1 - hitRatio);
      return {
        capacity: maxRps,
        utilization,
        serviceMs: queue(hitMs, utilization),
        dropRate: shed(utilization),
        forward: { rps: misses, writeRatio: 0 },
        bottleneck: utilization >= 0.9 ? "edge throughput / regional CDN capacity" : undefined,
      };
    },
  },

  search_index: {
    type: "search_index",
    category: "data",
    label: "Search Index",
    blurb: "Elasticsearch/OpenSearch-style index for artist, album, playlist, and podcast queries.",
    accent: "#14b8a6",
    defaults: { nodes: 4, shardGb: 80, queryMs: 12 },
    route: { role: "store", serves: ["search"] },
    cost: (c) => Number(c.nodes) * SEARCH_NODE_USD_MO,
    fields: [
      { key: "nodes", label: "Search nodes", type: "number", min: 1, max: 100, step: 1, help: "Search capacity scales by adding data/query nodes and spreading shards." },
      { key: "shardGb", label: "Shard size", type: "number", min: 10, max: 500, step: 10, unit: "GB", help: "Large shards increase query work and heap pressure." },
      { key: "queryMs", label: "Base query latency", type: "number", min: 2, max: 100, step: 1, unit: "ms", help: "Baseline query time before queueing." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const nodes = Number(config.nodes);
      const shardGb = Number(config.shardGb);
      const queryMs = Number(config.queryMs);
      const shardPenalty = Math.max(0.35, 1 - Math.max(0, shardGb - 80) / 500);
      const capacity = nodes * 4500 * shardPenalty;
      const utilization = input.rps / capacity;
      return {
        capacity,
        utilization,
        serviceMs: queue(queryMs, utilization),
        dropRate: shed(utilization),
        forward: SINK,
        bottleneck: utilization >= 0.9 ? "search shard/query capacity" : undefined,
      };
    },
  },

  event_queue: {
    type: "event_queue",
    category: "data",
    label: "Event Queue",
    blurb: "Kafka/Pub/Sub-style buffer for listening events, analytics, and async fanout.",
    accent: "#f97316",
    defaults: { partitions: 12, consumers: 6, ackMs: 4 },
    route: { role: "store", serves: ["event"] },
    cost: (c) => Number(c.partitions) * QUEUE_PARTITION_USD_MO + Number(c.consumers) * 60,
    fields: [
      { key: "partitions", label: "Partitions", type: "number", min: 1, max: 500, step: 1, help: "Write throughput and parallelism scale with partitions." },
      { key: "consumers", label: "Consumers", type: "number", min: 1, max: 500, step: 1, help: "Consumer workers drain events asynchronously after the user request has acknowledged." },
      { key: "ackMs", label: "Ack latency", type: "number", min: 1, max: 100, step: 1, unit: "ms", help: "The synchronous cost to durably enqueue an event." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const partitions = Number(config.partitions);
      const consumers = Number(config.consumers);
      const ackMs = Number(config.ackMs);
      const writeRps = input.rps * Math.max(input.writeRatio, 0.05);
      const ingestCapacity = partitions * 2500;
      const drainCapacity = consumers * 1800;
      const capacity = Math.min(ingestCapacity, drainCapacity);
      const utilization = capacity > 0 ? writeRps / capacity : Infinity;
      return {
        capacity,
        utilization,
        serviceMs: queue(ackMs, utilization),
        dropRate: shed(utilization),
        forward: SINK,
        bottleneck: utilization >= 0.9 ? "queue partitions or consumer drain rate" : undefined,
      };
    },
  },

  realtime_gateway: {
    type: "realtime_gateway",
    category: "networking",
    label: "Realtime Gateway",
    blurb: "WebSocket/SSE tier that holds live connections and pushes messages to subscribers in real time — separate from the request/response API path.",
    accent: "#f472b6",
    defaults: { instances: 4, throughputK: 8, fanoutMs: 8 },
    route: { role: "store", serves: ["realtime"] },
    cost: (c) => Number(c.instances) * 120,
    fields: [
      { key: "instances", label: "Gateway instances", type: "number", min: 1, max: 500, step: 1, help: "Each instance holds a pool of live connections and pushes messages. Scale out as concurrent viewers grow." },
      { key: "throughputK", label: "Deliveries / instance", type: "number", min: 1, max: 200, step: 1, unit: "k/s", help: "Sustained message pushes per second per instance (thousands). Fanning one message to many subscribers multiplies this fast." },
      { key: "fanoutMs", label: "Push latency", type: "number", min: 1, max: 100, step: 1, unit: "ms", help: "Time to fan a published message out to connected subscribers." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const capacity = Number(config.instances) * Number(config.throughputK) * 1000;
      const utilization = capacity > 0 ? input.rps / capacity : Infinity;
      return {
        capacity,
        utilization,
        serviceMs: queue(Number(config.fanoutMs), utilization),
        dropRate: shed(utilization),
        forward: SINK,
        bottleneck: utilization >= 0.9 ? "realtime delivery throughput — add gateway instances" : undefined,
      };
    },
  },

  inference_server: {
    type: "inference_server",
    category: "compute",
    label: "Inference Server",
    blurb: "GPU model-serving tier for recommendations and ranking. Each prediction is expensive — cache hot predictions to cut GPU calls before adding more GPUs.",
    accent: "#a855f7",
    defaults: { replicas: 6, perReplicaRps: 200, modelMs: 55, memoryGB: 8, workingSetGB: 40 },
    route: { role: "store", serves: ["inference"] },
    cost: (c) => Number(c.replicas) * 450 + Number(c.memoryGB) * 4,
    fields: [
      { key: "replicas", label: "GPU replicas", type: "number", min: 1, max: 200, step: 1, help: "GPU model servers. Throughput scales with replicas, but GPUs are expensive — cache before you scale." },
      { key: "perReplicaRps", label: "Predictions / replica", type: "number", min: 10, max: 5000, step: 10, unit: "rps", help: "Sustained predictions per second a single GPU replica can serve." },
      { key: "modelMs", label: "Inference latency", type: "number", min: 5, max: 500, step: 5, unit: "ms", help: "Time to run the model on a cache miss. Bigger models are smarter but slower and need more GPUs." },
      { key: "memoryGB", label: "Prediction cache", type: "number", min: 1, max: 4096, step: 1, unit: "GB", help: "Memoized hot predictions. A cache hit skips the GPU entirely — far cheaper than another replica." },
      { key: "workingSetGB", label: "Distinct predictions", type: "number", min: 1, max: 8192, step: 1, unit: "GB", help: "Spread of predictions actually requested. If it dwarfs the cache, most requests miss and hit the GPU." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const hit = Math.min(Number(config.memoryGB) / Math.max(Number(config.workingSetGB), 0.001), 0.95);
      const modelMs = Number(config.modelMs);
      const misses = input.rps * (1 - hit); // only misses hit the GPU
      const capacity = Number(config.replicas) * Number(config.perReplicaRps);
      const utilization = capacity > 0 ? misses / capacity : Infinity;
      return {
        capacity,
        utilization,
        serviceMs: 3 * hit + (1 - hit) * queue(modelMs, utilization),
        dropRate: (1 - hit) * shed(utilization), // cached predictions never fail
        forward: SINK,
        bottleneck: utilization >= 0.9 ? "GPU inference capacity — cache predictions or add replicas" : undefined,
      };
    },
  },

  observability: {
    type: "observability",
    category: "observability",
    label: "Observability",
    blurb: "Metrics, logs, and traces. Doesn't serve traffic — it's how you SEE the system. Without it, an incident is a guessing game and your post-mortem comes back blind.",
    accent: "#eab308",
    defaults: { coverage: "full" },
    route: { role: "store", serves: [] }, // inert — never in the request path
    cost: (c) => (String(c.coverage) === "basic" ? 120 : 300),
    fields: [
      { key: "coverage", label: "Signals", type: "select", options: [
        { value: "basic", label: "metrics only" },
        { value: "full", label: "metrics + logs + traces" },
      ], help: "Metrics tell you SOMETHING broke; logs + traces tell you WHERE. Full coverage costs more but turns an outage into a fix instead of a guess." },
    ],
    evaluate: (): NodeEval => ({ capacity: Infinity, utilization: 0, serviceMs: 0, dropRate: 0, forward: SINK }),
  },

  // ----------------------------------------------------------- REAL AWS SURFACE
  web_client: {
    type: "web_client",
    category: "source",
    label: "Web Client",
    blurb: "Browser traffic from desktop and mobile web sessions.",
    accent: "#9ca3af",
    defaults: { rps: 6000, writeRatio: 0.08 },
    cost: () => 0,
    fields: SOURCE_FIELDS,
    evaluate: sourceEval,
  },

  mobile_client: {
    type: "mobile_client",
    category: "source",
    label: "Mobile App",
    blurb: "iOS and Android app traffic with long-lived sessions and API calls.",
    accent: "#9ca3af",
    defaults: { rps: 9000, writeRatio: 0.12 },
    cost: () => 0,
    fields: SOURCE_FIELDS,
    evaluate: sourceEval,
  },

  partner_api: {
    type: "partner_api",
    category: "source",
    label: "Partner API",
    blurb: "External integrations and backend clients issuing API traffic.",
    accent: "#9ca3af",
    defaults: { rps: 2500, writeRatio: 0.2 },
    cost: () => 0,
    fields: SOURCE_FIELDS,
    evaluate: sourceEval,
  },

  aws_amplify: {
    type: "aws_amplify",
    category: "frontend",
    label: "AWS Amplify",
    blurb: "Hosted web/mobile frontend layer for static assets and app integration.",
    accent: "#ff9900",
    defaults: { maxRps: 80000, edgeMs: 12 },
    cost: () => 120,
    fields: [
      { key: "maxRps", label: "Frontend RPS", type: "number", min: 1000, max: 1000000, step: 1000, unit: "rps", help: "Static/frontend delivery capacity before API calls move downstream." },
      { key: "edgeMs", label: "Frontend latency", type: "number", min: 2, max: 100, step: 1, unit: "ms", help: "Time added by hosted frontend delivery and auth handoff." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "edgeMs", "frontend hosting throughput"),
  },

  aws_route53: {
    type: "aws_route53",
    category: "networking",
    label: "Amazon Route 53",
    blurb: "DNS and health-based routing before traffic reaches the application edge.",
    accent: "#8c4fff",
    defaults: { maxRps: 1000000, lookupMs: 3 },
    cost: () => 50,
    fields: [
      { key: "maxRps", label: "DNS query capacity", type: "number", min: 10000, max: 5000000, step: 10000, unit: "rps", help: "Effective regional DNS/routing capacity for the simulated workload." },
      { key: "lookupMs", label: "Lookup latency", type: "number", min: 1, max: 50, step: 1, unit: "ms", help: "DNS/routing latency before the chosen endpoint receives traffic." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "lookupMs", "DNS/routing capacity"),
  },

  aws_waf: {
    type: "aws_waf",
    category: "security",
    label: "AWS WAF",
    blurb: "Layer 7 filtering and rate-limit rules in front of CloudFront, API Gateway, or ALB.",
    accent: "#dd344c",
    defaults: { maxRps: 250000, inspectMs: 2 },
    cost: () => 180,
    fields: [
      { key: "maxRps", label: "Inspected RPS", type: "number", min: 1000, max: 3000000, step: 1000, unit: "rps", help: "Traffic inspected by web ACL rules." },
      { key: "inspectMs", label: "Inspection latency", type: "number", min: 0.5, max: 30, step: 0.5, unit: "ms", help: "Rule evaluation overhead in the request path." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "inspectMs", "WAF inspection capacity"),
  },

  aws_cloudfront: {
    type: "aws_cloudfront",
    category: "delivery",
    label: "Amazon CloudFront",
    blurb: "AWS CDN for audio chunks, images, static app assets, and cached API responses.",
    accent: "#8c4fff",
    defaults: { edgeTb: 20, catalogTb: 28, maxRps: 600000, hitLatencyMs: 16 },
    cost: (c) => 400 + Number(c.edgeTb) * 42,
    fields: CDN_FIELDS,
    evaluate: cdnEval,
  },

  aws_alb: {
    type: "aws_alb",
    category: "networking",
    label: "Elastic Load Balancing",
    blurb: "Application Load Balancer distributing HTTP traffic to EC2, ECS, or EKS services.",
    accent: "#8c4fff",
    defaults: { maxRps: 90000, routeMs: 4 },
    cost: () => 260,
    fields: [
      { key: "maxRps", label: "Balancer RPS", type: "number", min: 1000, max: 2000000, step: 1000, unit: "rps", help: "Effective listener/target group throughput for this design." },
      { key: "routeMs", label: "Routing latency", type: "number", min: 1, max: 50, step: 1, unit: "ms", help: "Load-balancer overhead before a target handles the request." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "routeMs", "load-balancer throughput"),
  },

  aws_api_gateway: {
    type: "aws_api_gateway",
    category: "networking",
    label: "Amazon API Gateway",
    blurb: "Managed API entrypoint for routing, auth, throttling, and service fanout.",
    accent: "#8c4fff",
    defaults: { maxRps: 120000, overheadMs: 6 },
    cost: () => 420,
    fields: [
      { key: "maxRps", label: "API RPS", type: "number", min: 1000, max: 1000000, step: 1000, unit: "rps", help: "Configured regional API capacity and throttling headroom." },
      { key: "overheadMs", label: "Gateway latency", type: "number", min: 1, max: 80, step: 1, unit: "ms", help: "Routing, authorizer, and transformation overhead." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "overheadMs", "API Gateway throttle"),
  },

  aws_vpc_lattice: {
    type: "aws_vpc_lattice",
    category: "networking",
    label: "Amazon VPC Lattice",
    blurb: "Service-to-service networking, auth, and routing across VPCs and accounts.",
    accent: "#8c4fff",
    defaults: { maxRps: 160000, routeMs: 5 },
    cost: () => 320,
    fields: [
      { key: "maxRps", label: "Service RPS", type: "number", min: 1000, max: 1000000, step: 1000, unit: "rps", help: "Internal service-network request capacity." },
      { key: "routeMs", label: "Routing latency", type: "number", min: 1, max: 60, step: 1, unit: "ms", help: "Service-network policy and routing overhead." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "routeMs", "service-network throughput"),
  },

  aws_ec2_asg: {
    type: "aws_ec2_asg",
    category: "compute",
    label: "EC2 Auto Scaling",
    blurb: "VM fleet behind a load balancer. You manage instances, AMIs, patching, and scaling policy.",
    accent: "#ff9900",
    defaults: { instances: 3, vcpus: 4, cpuMsPerReq: 2, maxConcurrency: 512 },
    cost: (c) => Number(c.instances) * Number(c.vcpus) * VCPU_USD_MO,
    fields: [
      { key: "instances", label: "Instances", type: "number", min: 1, max: 500, step: 1, help: "EC2 instances in the Auto Scaling group." },
      { key: "vcpus", label: "vCPU / instance", type: "number", min: 1, max: 128, step: 1, help: "Compute per VM. More vCPU raises CPU-bound throughput." },
      { key: "cpuMsPerReq", label: "CPU per request", type: "number", min: 0.5, max: 200, step: 0.5, unit: "ms", help: "Application CPU time per request." },
      { key: "maxConcurrency", label: "Max concurrency / instance", type: "number", min: 1, max: 8192, step: 1, help: "In-flight requests each VM can hold while waiting on downstream services." },
    ],
    evaluate: (ctx): NodeEval => computeEval(ctx, { units: "instances", cpu: "EC2 CPU saturation", concurrency: "EC2 connection/thread pool" }),
  },

  aws_ecs_fargate: {
    type: "aws_ecs_fargate",
    category: "containers",
    label: "ECS/Fargate Service",
    blurb: "Container service on serverless AWS-managed capacity; scale task count and task size.",
    accent: "#ff9900",
    defaults: { tasks: 6, vcpus: 2, cpuMsPerReq: 2, maxConcurrency: 384 },
    cost: (c) => Number(c.tasks) * Number(c.vcpus) * 38,
    fields: [
      { key: "tasks", label: "Tasks", type: "number", min: 1, max: 1000, step: 1, help: "Running Fargate tasks behind the service." },
      { key: "vcpus", label: "vCPU / task", type: "number", min: 0.25, max: 16, step: 0.25, help: "CPU reserved per task." },
      { key: "cpuMsPerReq", label: "CPU per request", type: "number", min: 0.5, max: 200, step: 0.5, unit: "ms", help: "Container CPU time per request." },
      { key: "maxConcurrency", label: "Max concurrency / task", type: "number", min: 1, max: 4096, step: 1, help: "Requests each task can safely hold open." },
    ],
    evaluate: (ctx): NodeEval => computeEval(ctx, { units: "tasks", cpu: "Fargate task CPU", concurrency: "Fargate task concurrency" }),
  },

  aws_eks: {
    type: "aws_eks",
    category: "containers",
    label: "Amazon EKS",
    blurb: "Kubernetes deployment on AWS. Scale pods and per-pod resources.",
    accent: "#ff9900",
    defaults: { pods: 10, vcpus: 2, cpuMsPerReq: 2, maxConcurrency: 256 },
    cost: (c) => 220 + Number(c.pods) * Number(c.vcpus) * VCPU_USD_MO,
    fields: [
      { key: "pods", label: "Pods", type: "number", min: 1, max: 2000, step: 1, help: "Application pods available to serve traffic." },
      { key: "vcpus", label: "vCPU / pod", type: "number", min: 0.25, max: 64, step: 0.25, help: "CPU request/limit per pod." },
      { key: "cpuMsPerReq", label: "CPU per request", type: "number", min: 0.5, max: 200, step: 0.5, unit: "ms", help: "Container CPU time per request." },
      { key: "maxConcurrency", label: "Max concurrency / pod", type: "number", min: 1, max: 4096, step: 1, help: "Requests each pod can hold open." },
    ],
    evaluate: (ctx): NodeEval => computeEval(ctx, { units: "pods", cpu: "pod CPU saturation", concurrency: "pod request concurrency" }),
  },

  aws_lambda: {
    type: "aws_lambda",
    category: "compute",
    label: "AWS Lambda",
    blurb: "Serverless functions. Scale by reserved concurrency and execution duration.",
    accent: "#ff9900",
    defaults: { reservedConcurrency: 2000, durationMs: 35, memoryMB: 1024 },
    cost: (c) => 60 + (Number(c.reservedConcurrency) * Number(c.memoryMB)) / 2048,
    fields: [
      { key: "reservedConcurrency", label: "Reserved concurrency", type: "number", min: 10, max: 100000, step: 10, help: "Maximum concurrent executions reserved for this function path." },
      { key: "durationMs", label: "Duration", type: "number", min: 1, max: 10000, step: 1, unit: "ms", help: "Execution duration. Longer functions consume concurrency for longer." },
      { key: "memoryMB", label: "Memory", type: "number", min: 128, max: 10240, step: 128, unit: "MB", help: "Memory setting, also roughly tied to CPU allocation." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const durationMs = Number(config.durationMs);
      const capacity = Number(config.reservedConcurrency) / (durationMs / 1000);
      const utilization = capacity > 0 ? input.rps / capacity : Infinity;
      return {
        capacity,
        utilization,
        serviceMs: queue(durationMs, utilization),
        dropRate: shed(utilization),
        forward: { rps: input.rps * (1 - shed(utilization)), writeRatio: input.writeRatio },
        bottleneck: utilization >= 0.9 ? "Lambda reserved concurrency" : undefined,
      };
    },
  },

  aws_rds: {
    type: "aws_rds",
    category: "database",
    label: "Amazon RDS",
    blurb: "Managed relational database with one writer and optional read replicas.",
    accent: "#3b48cc",
    defaults: { tier: "medium", readReplicas: 1, maxConnections: 600, queryMs: 6 },
    cost: (c) => (SQL_TIER_USD[String(c.tier)] ?? 700) * (1 + Number(c.readReplicas) * 0.9),
    fields: SQL_FIELDS,
    evaluate: (ctx): NodeEval => sqlEval(ctx),
  },

  aws_aurora: {
    type: "aws_aurora",
    category: "database",
    label: "Amazon Aurora",
    blurb: "Cloud-native relational database with faster primary and read-replica scaleout.",
    accent: "#3b48cc",
    defaults: { tier: "large", readReplicas: 2, maxConnections: 1200, queryMs: 4 },
    cost: (c) => (SQL_TIER_USD[String(c.tier)] ?? 700) * 1.3 * (1 + Number(c.readReplicas) * 0.75),
    fields: SQL_FIELDS,
    evaluate: (ctx): NodeEval => sqlEval(ctx, 1.35),
  },

  aws_dynamodb: {
    type: "aws_dynamodb",
    category: "database",
    label: "Amazon DynamoDB",
    blurb: "Key-value/document store with partitioned read and write throughput.",
    accent: "#3b48cc",
    defaults: { partitions: 12, consistency: "eventual", opMs: 3 },
    cost: (c) => Number(c.partitions) * 140,
    fields: [
      { key: "partitions", label: "Partitions", type: "number", min: 1, max: 1000, step: 1, help: "Logical throughput partitions for hot keys and write distribution." },
      { key: "consistency", label: "Consistency", type: "select", options: [
        { value: "eventual", label: "eventual (fast)" },
        { value: "strong", label: "strong (slower)" },
      ], help: "Strong reads cost more capacity and add latency." },
      { key: "opMs", label: "Base op latency", type: "number", min: 0.5, max: 50, step: 0.5, unit: "ms", help: "Single-key operation latency." },
    ],
    evaluate: (ctx): NodeEval =>
      partitionedEval(ctx, { unitKey: "partitions", perUnit: 1800, latencyKey: "opMs", strongKey: "consistency", bottleneck: "DynamoDB partition throughput / hot key" }),
  },

  aws_elasticache_redis: {
    type: "aws_elasticache_redis",
    category: "database",
    label: "ElastiCache Redis",
    blurb: "Managed Redis for hot metadata, sessions, rate-limit counters, and read-through cache.",
    accent: "#3b48cc",
    defaults: { memoryGB: 32, workingSetGB: 64, maxOps: 240000, hitLatencyMs: 0.7 },
    cost: (c) => Number(c.memoryGB) * CACHE_GB_USD_MO,
    fields: REDIS_FIELDS,
    evaluate: (ctx): NodeEval => cacheEval(ctx, "ElastiCache Redis ops/sec"),
  },

  aws_s3: {
    type: "aws_s3",
    category: "storage",
    label: "Amazon S3",
    blurb: "Object storage for audio chunks, images, backups, data lake objects, and static assets.",
    accent: "#7aa116",
    defaults: { firstByteMs: 55 },
    cost: () => 35,
    fields: OBJECT_STORE_FIELDS,
    evaluate: objectStoreEval,
  },

  aws_efs: {
    type: "aws_efs",
    category: "storage",
    label: "Amazon EFS",
    blurb: "Shared elastic file system for services that need POSIX files, not object blobs.",
    accent: "#7aa116",
    defaults: { maxRps: 50000, fileMs: 12 },
    cost: () => 240,
    fields: [
      { key: "maxRps", label: "File ops/sec", type: "number", min: 1000, max: 1000000, step: 1000, unit: "ops/s", help: "Aggregate file operation capacity." },
      { key: "fileMs", label: "File latency", type: "number", min: 1, max: 100, step: 1, unit: "ms", help: "Per-operation latency added by shared file access." },
    ],
    evaluate: (ctx): NodeEval => sinkEval(ctx, "maxRps", "fileMs", "EFS file operation throughput"),
  },

  aws_opensearch: {
    type: "aws_opensearch",
    category: "analytics",
    label: "OpenSearch Service",
    blurb: "Search/index cluster for artist, playlist, album, podcast, and log queries.",
    accent: "#8c4fff",
    defaults: { nodes: 6, shardGb: 80, queryMs: 12 },
    cost: (c) => Number(c.nodes) * SEARCH_NODE_USD_MO,
    fields: SEARCH_FIELDS,
    evaluate: searchEval,
  },

  aws_sqs: {
    type: "aws_sqs",
    category: "integration",
    label: "Amazon SQS",
    blurb: "Durable queue for decoupling writes, jobs, and retries from the request path.",
    accent: "#e7157b",
    defaults: { queues: 4, consumers: 12, ackMs: 4 },
    cost: (c) => Number(c.queues) * 80 + Number(c.consumers) * 45,
    fields: [
      { key: "queues", label: "Queues / shards", type: "number", min: 1, max: 200, step: 1, help: "Logical queues or sharded FIFO groups used to spread bursty writes." },
      { key: "consumers", label: "Consumers", type: "number", min: 1, max: 1000, step: 1, help: "Workers draining messages asynchronously." },
      { key: "ackMs", label: "Enqueue latency", type: "number", min: 1, max: 100, step: 1, unit: "ms", help: "Synchronous time to accept and durably enqueue a message." },
    ],
    evaluate: (ctx): NodeEval => queueEval(ctx, { unitKey: "queues", consumerKey: "consumers", perUnit: 6000, perConsumer: 1500, ackKey: "ackMs", bottleneck: "SQS enqueue or consumer drain capacity" }),
  },

  aws_sns: {
    type: "aws_sns",
    category: "integration",
    label: "Amazon SNS",
    blurb: "Pub/sub fanout for notifications and event delivery to queues or functions.",
    accent: "#e7157b",
    defaults: { topics: 4, maxRps: 160000, publishMs: 3 },
    cost: (c) => Number(c.topics) * 35,
    fields: [
      { key: "topics", label: "Topics", type: "number", min: 1, max: 200, step: 1, help: "Logical pub/sub topics." },
      { key: "maxRps", label: "Publish RPS", type: "number", min: 1000, max: 2000000, step: 1000, unit: "rps", help: "Publish capacity before fanout subscribers receive events." },
      { key: "publishMs", label: "Publish latency", type: "number", min: 1, max: 80, step: 1, unit: "ms", help: "Synchronous publish overhead." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "publishMs", "SNS publish throughput"),
  },

  aws_eventbridge: {
    type: "aws_eventbridge",
    category: "integration",
    label: "Amazon EventBridge",
    blurb: "Event bus for routing domain events between services and accounts.",
    accent: "#e7157b",
    defaults: { buses: 3, maxRps: 120000, putMs: 6 },
    cost: (c) => Number(c.buses) * 70,
    fields: [
      { key: "buses", label: "Event buses", type: "number", min: 1, max: 100, step: 1, help: "Separate buses for domains/accounts." },
      { key: "maxRps", label: "Event RPS", type: "number", min: 1000, max: 1000000, step: 1000, unit: "rps", help: "PutEvents throughput across the bus." },
      { key: "putMs", label: "Put latency", type: "number", min: 1, max: 100, step: 1, unit: "ms", help: "Time to accept and route the event." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "putMs", "EventBridge PutEvents throughput"),
  },

  aws_kinesis: {
    type: "aws_kinesis",
    category: "analytics",
    label: "Kinesis Data Streams",
    blurb: "Ordered streaming ingestion for listening events and near-real-time analytics.",
    accent: "#8c4fff",
    defaults: { shards: 24, consumers: 12, ackMs: 5 },
    cost: (c) => Number(c.shards) * 45 + Number(c.consumers) * 60,
    fields: [
      { key: "shards", label: "Shards", type: "number", min: 1, max: 1000, step: 1, help: "Write throughput and ordering partitions." },
      { key: "consumers", label: "Consumers", type: "number", min: 1, max: 1000, step: 1, help: "Stream consumers draining records." },
      { key: "ackMs", label: "Put latency", type: "number", min: 1, max: 100, step: 1, unit: "ms", help: "Synchronous PutRecord/PutRecords overhead." },
    ],
    evaluate: (ctx): NodeEval => queueEval(ctx, { unitKey: "shards", consumerKey: "consumers", perUnit: 1000, perConsumer: 2500, ackKey: "ackMs", bottleneck: "Kinesis shard or consumer throughput" }),
  },

  aws_msk: {
    type: "aws_msk",
    category: "analytics",
    label: "Amazon MSK",
    blurb: "Managed Kafka for high-volume ordered events and stream processing.",
    accent: "#8c4fff",
    defaults: { brokers: 6, consumers: 18, ackMs: 6 },
    cost: (c) => Number(c.brokers) * 260 + Number(c.consumers) * 50,
    fields: [
      { key: "brokers", label: "Brokers", type: "number", min: 1, max: 200, step: 1, help: "Kafka broker count and partition hosting capacity." },
      { key: "consumers", label: "Consumers", type: "number", min: 1, max: 2000, step: 1, help: "Consumer workers draining topic partitions." },
      { key: "ackMs", label: "Ack latency", type: "number", min: 1, max: 120, step: 1, unit: "ms", help: "Producer acknowledgement latency." },
    ],
    evaluate: (ctx): NodeEval => queueEval(ctx, { unitKey: "brokers", consumerKey: "consumers", perUnit: 9000, perConsumer: 3000, ackKey: "ackMs", bottleneck: "Kafka broker or consumer throughput" }),
  },

  aws_step_functions: {
    type: "aws_step_functions",
    category: "integration",
    label: "AWS Step Functions",
    blurb: "Workflow orchestration for multi-step jobs, retries, and stateful async processes.",
    accent: "#e7157b",
    defaults: { maxRps: 60000, stepMs: 20 },
    cost: () => 260,
    fields: [
      { key: "maxRps", label: "Workflow starts/sec", type: "number", min: 100, max: 500000, step: 100, unit: "rps", help: "How many workflow executions this path can start." },
      { key: "stepMs", label: "Start latency", type: "number", min: 2, max: 300, step: 1, unit: "ms", help: "Synchronous workflow start overhead." },
    ],
    evaluate: (ctx): NodeEval => sinkEval(ctx, "maxRps", "stepMs", "workflow start throughput"),
  },

  aws_appsync: {
    type: "aws_appsync",
    category: "frontend",
    label: "AWS AppSync",
    blurb: "Managed GraphQL API for web/mobile clients, resolvers, and subscriptions.",
    accent: "#ff9900",
    defaults: { maxRps: 90000, resolverMs: 9 },
    cost: () => 340,
    fields: [
      { key: "maxRps", label: "GraphQL RPS", type: "number", min: 1000, max: 1000000, step: 1000, unit: "rps", help: "Resolver throughput for API operations." },
      { key: "resolverMs", label: "Resolver latency", type: "number", min: 1, max: 100, step: 1, unit: "ms", help: "Resolver overhead before downstream data sources." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "resolverMs", "AppSync resolver throughput"),
  },

  aws_cognito: {
    type: "aws_cognito",
    category: "security",
    label: "Amazon Cognito",
    blurb: "User authentication, token validation, and identity federation.",
    accent: "#dd344c",
    defaults: { maxRps: 100000, authMs: 8 },
    cost: () => 180,
    fields: [
      { key: "maxRps", label: "Auth RPS", type: "number", min: 1000, max: 1000000, step: 1000, unit: "rps", help: "Token/auth checks per second on this path." },
      { key: "authMs", label: "Auth latency", type: "number", min: 1, max: 120, step: 1, unit: "ms", help: "Authentication/authorization overhead." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "authMs", "Cognito auth throughput"),
  },

  aws_secrets_manager: {
    type: "aws_secrets_manager",
    category: "security",
    label: "Secrets Manager",
    blurb: "Managed secrets lookup and rotation for service credentials.",
    accent: "#dd344c",
    defaults: { maxRps: 20000, lookupMs: 18 },
    cost: () => 90,
    fields: [
      { key: "maxRps", label: "Lookup RPS", type: "number", min: 100, max: 200000, step: 100, unit: "rps", help: "Synchronous secret lookups. In real systems these should usually be cached." },
      { key: "lookupMs", label: "Lookup latency", type: "number", min: 1, max: 250, step: 1, unit: "ms", help: "Secrets retrieval latency when a service fetches credentials live." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "lookupMs", "Secrets Manager lookup throughput"),
  },

  aws_cloudwatch: {
    type: "aws_cloudwatch",
    category: "observability",
    label: "Amazon CloudWatch",
    blurb: "Metrics, logs, and alarms for services. Model it as async telemetry ingestion.",
    accent: "#759c3e",
    defaults: { maxRps: 500000, ingestMs: 2 },
    cost: () => 210,
    fields: [
      { key: "maxRps", label: "Telemetry events/sec", type: "number", min: 1000, max: 5000000, step: 1000, unit: "events/s", help: "Metric/log event ingestion capacity." },
      { key: "ingestMs", label: "Ingest overhead", type: "number", min: 0.1, max: 30, step: 0.1, unit: "ms", help: "Small synchronous overhead to emit telemetry." },
    ],
    evaluate: (ctx): NodeEval => sinkEval(ctx, "maxRps", "ingestMs", "CloudWatch telemetry ingestion"),
  },

  aws_redshift: {
    type: "aws_redshift",
    category: "analytics",
    label: "Amazon Redshift",
    blurb: "Warehouse for analytics queries, not the live serving database.",
    accent: "#8c4fff",
    defaults: { nodes: 4, queryMs: 120 },
    cost: (c) => Number(c.nodes) * 480,
    fields: [
      { key: "nodes", label: "Warehouse nodes", type: "number", min: 1, max: 200, step: 1, help: "Compute nodes for analytical queries." },
      { key: "queryMs", label: "Query latency", type: "number", min: 20, max: 2000, step: 10, unit: "ms", help: "Analytical query latency; keep this off user request paths." },
    ],
    evaluate: (ctx): NodeEval => sinkEval(ctx, "nodes", "queryMs", "Redshift analytical query capacity"),
  },

  aws_glue: {
    type: "aws_glue",
    category: "analytics",
    label: "AWS Glue",
    blurb: "ETL/catalog jobs for data pipelines, modeled as async ingestion work.",
    accent: "#8c4fff",
    defaults: { workers: 10, jobMs: 80 },
    cost: (c) => Number(c.workers) * 70,
    fields: [
      { key: "workers", label: "Workers", type: "number", min: 1, max: 500, step: 1, help: "ETL worker capacity." },
      { key: "jobMs", label: "Job overhead", type: "number", min: 10, max: 2000, step: 10, unit: "ms", help: "Async ETL processing overhead." },
    ],
    evaluate: (ctx): NodeEval => sinkEval(ctx, "workers", "jobMs", "Glue worker capacity"),
  },

  aws_athena: {
    type: "aws_athena",
    category: "analytics",
    label: "Amazon Athena",
    blurb: "Serverless SQL over S3 data lake objects for analytical queries.",
    accent: "#8c4fff",
    defaults: { concurrentQueries: 20, queryMs: 200 },
    cost: () => 120,
    fields: [
      { key: "concurrentQueries", label: "Concurrent queries", type: "number", min: 1, max: 500, step: 1, help: "Analytical query concurrency." },
      { key: "queryMs", label: "Query latency", type: "number", min: 50, max: 5000, step: 50, unit: "ms", help: "Data lake query latency; usually not user-facing." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const queryMs = Number(config.queryMs);
      const capacity = Number(config.concurrentQueries) / (queryMs / 1000);
      const utilization = capacity > 0 ? input.rps / capacity : Infinity;
      return {
        capacity,
        utilization,
        serviceMs: queue(queryMs, utilization),
        dropRate: shed(utilization),
        forward: SINK,
        bottleneck: utilization >= 0.9 ? "Athena query concurrency" : undefined,
      };
    },
  },

  gcp_cloud_load_balancing: {
    type: "gcp_cloud_load_balancing",
    category: "networking",
    label: "Cloud Load Balancing",
    blurb: "Google Cloud global/regional load balancer for HTTP services and backends.",
    accent: "#4285f4",
    defaults: { maxRps: 120000, routeMs: 4 },
    cost: () => 260,
    fields: [
      { key: "maxRps", label: "Balancer RPS", type: "number", min: 1000, max: 2000000, step: 1000, unit: "rps", help: "Effective load-balancer throughput for this design." },
      { key: "routeMs", label: "Routing latency", type: "number", min: 1, max: 50, step: 1, unit: "ms", help: "Routing overhead before a backend handles the request." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "routeMs", "load-balancer throughput"),
  },

  gcp_api_gateway: {
    type: "gcp_api_gateway",
    category: "networking",
    label: "API Gateway",
    blurb: "Google Cloud managed API entrypoint for routing, auth, and throttling.",
    accent: "#4285f4",
    defaults: { maxRps: 90000, overheadMs: 7 },
    cost: () => 340,
    fields: [
      { key: "maxRps", label: "API RPS", type: "number", min: 1000, max: 1000000, step: 1000, unit: "rps", help: "Configured gateway throughput and throttle headroom." },
      { key: "overheadMs", label: "Gateway latency", type: "number", min: 1, max: 80, step: 1, unit: "ms", help: "API gateway routing and policy overhead." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "overheadMs", "API Gateway throughput"),
  },

  gcp_cloud_cdn: {
    type: "gcp_cloud_cdn",
    category: "delivery",
    label: "Cloud CDN",
    blurb: "Google Cloud edge cache for static assets, media, and cacheable API responses.",
    accent: "#4285f4",
    defaults: { edgeTb: 20, catalogTb: 28, maxRps: 550000, hitLatencyMs: 17 },
    cost: (c) => 380 + Number(c.edgeTb) * 40,
    fields: CDN_FIELDS,
    evaluate: cdnEval,
  },

  gcp_compute_mig: {
    type: "gcp_compute_mig",
    category: "compute",
    label: "Compute Engine MIG",
    blurb: "Managed instance group of VMs. You manage machine images, patching, and autoscaling policy.",
    accent: "#4285f4",
    defaults: { instances: 3, vcpus: 4, cpuMsPerReq: 2, maxConcurrency: 512 },
    cost: (c) => Number(c.instances) * Number(c.vcpus) * VCPU_USD_MO,
    fields: [
      { key: "instances", label: "VM instances", type: "number", min: 1, max: 500, step: 1, help: "Compute Engine VMs in the managed instance group." },
      { key: "vcpus", label: "vCPU / VM", type: "number", min: 1, max: 128, step: 1, help: "Compute per VM. More vCPU raises CPU-bound throughput." },
      { key: "cpuMsPerReq", label: "CPU per request", type: "number", min: 0.5, max: 200, step: 0.5, unit: "ms", help: "Application CPU time per request." },
      { key: "maxConcurrency", label: "Max concurrency / VM", type: "number", min: 1, max: 8192, step: 1, help: "In-flight requests each VM can hold while waiting on downstream services." },
    ],
    evaluate: (ctx): NodeEval => computeEval(ctx, { units: "instances", cpu: "VM CPU saturation", concurrency: "VM connection/thread pool" }),
  },

  gcp_cloud_run: {
    type: "gcp_cloud_run",
    category: "containers",
    label: "Cloud Run",
    blurb: "Serverless containers. Scale instances and concurrency per instance.",
    accent: "#4285f4",
    defaults: { instances: 20, vcpus: 1, cpuMsPerReq: 2, maxConcurrency: 80 },
    cost: (c) => Number(c.instances) * Number(c.vcpus) * 32,
    fields: [
      { key: "instances", label: "Max instances", type: "number", min: 1, max: 2000, step: 1, help: "Cloud Run instances available under burst." },
      { key: "vcpus", label: "vCPU / instance", type: "number", min: 0.25, max: 8, step: 0.25, help: "CPU allocated to each container instance." },
      { key: "cpuMsPerReq", label: "CPU per request", type: "number", min: 0.5, max: 200, step: 0.5, unit: "ms", help: "Container CPU time per request." },
      { key: "maxConcurrency", label: "Concurrency / instance", type: "number", min: 1, max: 1000, step: 1, help: "Requests one instance can process concurrently." },
    ],
    evaluate: (ctx): NodeEval => computeEval(ctx, { units: "instances", cpu: "Cloud Run CPU", concurrency: "Cloud Run instance concurrency" }),
  },

  gcp_gke: {
    type: "gcp_gke",
    category: "containers",
    label: "Google Kubernetes Engine",
    blurb: "Managed Kubernetes. Scale pods and pod resources.",
    accent: "#4285f4",
    defaults: { pods: 10, vcpus: 2, cpuMsPerReq: 2, maxConcurrency: 256 },
    cost: (c) => 200 + Number(c.pods) * Number(c.vcpus) * VCPU_USD_MO,
    fields: [
      { key: "pods", label: "Pods", type: "number", min: 1, max: 2000, step: 1, help: "Application pods available to serve traffic." },
      { key: "vcpus", label: "vCPU / pod", type: "number", min: 0.25, max: 64, step: 0.25, help: "CPU request/limit per pod." },
      { key: "cpuMsPerReq", label: "CPU per request", type: "number", min: 0.5, max: 200, step: 0.5, unit: "ms", help: "Container CPU time per request." },
      { key: "maxConcurrency", label: "Max concurrency / pod", type: "number", min: 1, max: 4096, step: 1, help: "Requests each pod can hold open." },
    ],
    evaluate: (ctx): NodeEval => computeEval(ctx, { units: "pods", cpu: "pod CPU saturation", concurrency: "pod request concurrency" }),
  },

  gcp_cloud_functions: {
    type: "gcp_cloud_functions",
    category: "compute",
    label: "Cloud Functions",
    blurb: "Serverless functions. Scale by max instances and execution duration.",
    accent: "#4285f4",
    defaults: { maxInstances: 1500, durationMs: 40, memoryMB: 1024 },
    cost: (c) => 60 + (Number(c.maxInstances) * Number(c.memoryMB)) / 2048,
    fields: [
      { key: "maxInstances", label: "Max instances", type: "number", min: 10, max: 100000, step: 10, help: "Maximum concurrent function instances." },
      { key: "durationMs", label: "Duration", type: "number", min: 1, max: 10000, step: 1, unit: "ms", help: "Execution duration. Longer functions consume instances for longer." },
      { key: "memoryMB", label: "Memory", type: "number", min: 128, max: 8192, step: 128, unit: "MB", help: "Memory setting, roughly tied to CPU allocation." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const durationMs = Number(config.durationMs);
      const capacity = Number(config.maxInstances) / (durationMs / 1000);
      const utilization = capacity > 0 ? input.rps / capacity : Infinity;
      return {
        capacity,
        utilization,
        serviceMs: queue(durationMs, utilization),
        dropRate: shed(utilization),
        forward: { rps: input.rps * (1 - shed(utilization)), writeRatio: input.writeRatio },
        bottleneck: utilization >= 0.9 ? "Cloud Functions max instances" : undefined,
      };
    },
  },

  gcp_cloud_sql: {
    type: "gcp_cloud_sql",
    category: "database",
    label: "Cloud SQL",
    blurb: "Managed relational database with one writer and optional read replicas.",
    accent: "#4285f4",
    defaults: { tier: "medium", readReplicas: 1, maxConnections: 600, queryMs: 6 },
    cost: (c) => (SQL_TIER_USD[String(c.tier)] ?? 700) * (1 + Number(c.readReplicas) * 0.9),
    fields: SQL_FIELDS,
    evaluate: (ctx): NodeEval => sqlEval(ctx),
  },

  gcp_spanner: {
    type: "gcp_spanner",
    category: "database",
    label: "Cloud Spanner",
    blurb: "Globally distributed relational database that scales writes with nodes, with higher cost and latency.",
    accent: "#4285f4",
    defaults: { nodes: 4, consistency: "strong", opMs: 8 },
    cost: (c) => Number(c.nodes) * 720,
    fields: [
      { key: "nodes", label: "Nodes", type: "number", min: 1, max: 200, step: 1, help: "Spanner node count for distributed read/write capacity." },
      { key: "consistency", label: "Consistency", type: "select", options: [
        { value: "strong", label: "strong (global)" },
        { value: "eventual", label: "stale reads (faster)" },
      ], help: "Strong global reads/writes cost latency but preserve consistency." },
      { key: "opMs", label: "Base op latency", type: "number", min: 2, max: 100, step: 1, unit: "ms", help: "Distributed transaction operation latency." },
    ],
    evaluate: (ctx): NodeEval =>
      partitionedEval(ctx, { unitKey: "nodes", perUnit: 3500, latencyKey: "opMs", strongKey: "consistency", bottleneck: "Spanner node throughput" }),
  },

  gcp_firestore: {
    type: "gcp_firestore",
    category: "database",
    label: "Firestore",
    blurb: "Document database for user state, metadata, and mobile/web app data.",
    accent: "#4285f4",
    defaults: { partitions: 10, consistency: "strong", opMs: 5 },
    cost: (c) => Number(c.partitions) * 120,
    fields: [
      { key: "partitions", label: "Hot key partitions", type: "number", min: 1, max: 1000, step: 1, help: "Effective partition spread for document hot spots." },
      { key: "consistency", label: "Consistency", type: "select", options: [
        { value: "strong", label: "strong" },
        { value: "eventual", label: "eventual" },
      ], help: "Consistency behavior for this modeled access path." },
      { key: "opMs", label: "Base op latency", type: "number", min: 1, max: 80, step: 1, unit: "ms", help: "Document read/write operation latency." },
    ],
    evaluate: (ctx): NodeEval =>
      partitionedEval(ctx, { unitKey: "partitions", perUnit: 1600, latencyKey: "opMs", strongKey: "consistency", bottleneck: "Firestore hot partition throughput" }),
  },

  gcp_memorystore_redis: {
    type: "gcp_memorystore_redis",
    category: "database",
    label: "Memorystore Redis",
    blurb: "Managed Redis for hot metadata, sessions, rate limits, and cache.",
    accent: "#4285f4",
    defaults: { memoryGB: 32, workingSetGB: 64, maxOps: 220000, hitLatencyMs: 0.8 },
    cost: (c) => Number(c.memoryGB) * CACHE_GB_USD_MO,
    fields: REDIS_FIELDS,
    evaluate: (ctx): NodeEval => cacheEval(ctx, "Memorystore Redis ops/sec"),
  },

  gcp_cloud_storage: {
    type: "gcp_cloud_storage",
    category: "storage",
    label: "Cloud Storage",
    blurb: "Object storage for media files, data lake objects, backups, and static assets.",
    accent: "#4285f4",
    defaults: { firstByteMs: 55 },
    cost: () => 35,
    fields: OBJECT_STORE_FIELDS,
    evaluate: objectStoreEval,
  },

  gcp_pubsub: {
    type: "gcp_pubsub",
    category: "integration",
    label: "Pub/Sub",
    blurb: "Managed pub/sub messaging for event fanout and async processing.",
    accent: "#4285f4",
    defaults: { topics: 8, subscribers: 16, ackMs: 5 },
    cost: (c) => Number(c.topics) * 65 + Number(c.subscribers) * 45,
    fields: [
      { key: "topics", label: "Topics", type: "number", min: 1, max: 500, step: 1, help: "Logical topics used for event fanout." },
      { key: "subscribers", label: "Subscribers", type: "number", min: 1, max: 2000, step: 1, help: "Subscribers draining messages asynchronously." },
      { key: "ackMs", label: "Publish latency", type: "number", min: 1, max: 120, step: 1, unit: "ms", help: "Synchronous publish overhead." },
    ],
    evaluate: (ctx): NodeEval => queueEval(ctx, { unitKey: "topics", consumerKey: "subscribers", perUnit: 5000, perConsumer: 1800, ackKey: "ackMs", bottleneck: "Pub/Sub publish or subscriber throughput" }),
  },

  gcp_bigquery: {
    type: "gcp_bigquery",
    category: "analytics",
    label: "BigQuery",
    blurb: "Serverless warehouse for analytics, reporting, and offline product insights.",
    accent: "#4285f4",
    defaults: { slots: 400, queryMs: 160 },
    cost: (c) => Number(c.slots) * 3,
    fields: [
      { key: "slots", label: "Slots", type: "number", min: 10, max: 10000, step: 10, help: "Analytical compute slots." },
      { key: "queryMs", label: "Query latency", type: "number", min: 50, max: 5000, step: 50, unit: "ms", help: "Warehouse query latency; usually not user-facing." },
    ],
    evaluate: ({ input, config }: EvalContext): NodeEval => {
      const queryMs = Number(config.queryMs);
      const capacity = Number(config.slots) / Math.max(queryMs / 1000, 0.001);
      const utilization = input.rps / capacity;
      return {
        capacity,
        utilization,
        serviceMs: queue(queryMs, utilization),
        dropRate: shed(utilization),
        forward: SINK,
        bottleneck: utilization >= 0.9 ? "BigQuery slot capacity" : undefined,
      };
    },
  },

  gcp_dataflow: {
    type: "gcp_dataflow",
    category: "analytics",
    label: "Dataflow",
    blurb: "Streaming/batch processing workers for event pipelines.",
    accent: "#4285f4",
    defaults: { workers: 12, jobMs: 70 },
    cost: (c) => Number(c.workers) * 75,
    fields: [
      { key: "workers", label: "Workers", type: "number", min: 1, max: 1000, step: 1, help: "Pipeline workers draining events." },
      { key: "jobMs", label: "Processing latency", type: "number", min: 10, max: 2000, step: 10, unit: "ms", help: "Modeled async processing overhead." },
    ],
    evaluate: (ctx): NodeEval => sinkEval(ctx, "workers", "jobMs", "Dataflow worker capacity"),
  },

  gcp_cloud_monitoring: {
    type: "gcp_cloud_monitoring",
    category: "observability",
    label: "Cloud Monitoring",
    blurb: "Metrics, logs, traces, and alerting for Google Cloud services.",
    accent: "#4285f4",
    defaults: { maxRps: 450000, ingestMs: 2 },
    cost: () => 200,
    fields: [
      { key: "maxRps", label: "Telemetry events/sec", type: "number", min: 1000, max: 5000000, step: 1000, unit: "events/s", help: "Metric/log event ingestion capacity." },
      { key: "ingestMs", label: "Ingest overhead", type: "number", min: 0.1, max: 30, step: 0.1, unit: "ms", help: "Small synchronous overhead to emit telemetry." },
    ],
    evaluate: (ctx): NodeEval => sinkEval(ctx, "maxRps", "ingestMs", "Cloud Monitoring ingestion"),
  },

  gcp_secret_manager: {
    type: "gcp_secret_manager",
    category: "security",
    label: "Secret Manager",
    blurb: "Managed secrets lookup and rotation for service credentials.",
    accent: "#4285f4",
    defaults: { maxRps: 20000, lookupMs: 18 },
    cost: () => 90,
    fields: [
      { key: "maxRps", label: "Lookup RPS", type: "number", min: 100, max: 200000, step: 100, unit: "rps", help: "Synchronous secret lookups. In real systems these should usually be cached." },
      { key: "lookupMs", label: "Lookup latency", type: "number", min: 1, max: 250, step: 1, unit: "ms", help: "Secrets retrieval latency when a service fetches credentials live." },
    ],
    evaluate: (ctx): NodeEval => passThroughEval(ctx, "maxRps", "lookupMs", "Secret Manager lookup throughput"),
  },
};

export const COMPONENT_LIST = Object.values(COMPONENTS);

export function specOf(type: string): ComponentSpec {
  const spec = COMPONENTS[type];
  if (!spec) throw new Error(`Unknown component type: ${type}`);
  return spec;
}
