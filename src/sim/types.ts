// Core types for the system-design simulation.
//
// The whole point of this model: a component is NOT a generic box with a
// "replicas" knob. Each component type exposes the config surface that actually
// governs its real-world behavior, and its `evaluate()` encodes how those knobs
// translate into capacity, latency and failure under load.

export type Category =
  | "source"
  | "frontend"
  | "networking"
  | "compute"
  | "containers"
  | "delivery"
  | "storage"
  | "database"
  | "integration"
  | "analytics"
  | "security"
  | "observability"
  | "data";

export type FieldType = "number" | "slider" | "select";

export interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Short explanation of why this knob matters. */
  help?: string;
}

export type Config = Record<string, number | string>;

/** The kinds of request a workload is made of. Each class is served by a
 *  specific capability, so wiring the right component for each class is the
 *  whole game: a class with no handler on its path simply fails. */
export type ReqClass = "read" | "write" | "kv" | "media" | "search" | "event";
export const REQ_CLASSES: readonly ReqClass[] = ["read", "write", "kv", "media", "search", "event"];

/** Requests/sec broken down by class. */
export type ClassFlow = Record<ReqClass, number>;

/** How a component participates in class routing.
 *  - source:  emits the level's class mix.
 *  - compute: serves nothing itself; passes every class through (bears total load).
 *  - cache:   serves `read` hits, forwards misses + other classes downstream.
 *  - cdn:     serves `media` hits, forwards misses + other classes downstream.
 *  - store:   terminal handler for the classes in `serves`. */
export interface RouteSpec {
  role: "source" | "compute" | "cache" | "cdn" | "store";
  serves?: ReqClass[];
}

/** A stream of traffic flowing along an edge or into a node. */
export interface Flow {
  rps: number; // requests per second
  writeRatio: number; // 0..1 — share of requests that mutate state
}

/** Everything a component needs to know to react to its incoming load. */
export interface EvalContext {
  input: Flow;
  config: Config;
  /** End-to-end latency contributed by everything this node depends on (ms). */
  downstreamMs: number;
}

/** The outcome of running one component under a given input flow. */
export interface NodeEval {
  /** Effective requests/sec this node can serve given its config. */
  capacity: number;
  /** input.rps / capacity. May exceed 1 (overloaded). */
  utilization: number;
  /** Latency this node itself adds, including its own queueing (ms). */
  serviceMs: number;
  /** 0..1 — fraction of requests this node sheds (load it cannot absorb). */
  dropRate: number;
  /** Flow forwarded to each downstream dependency (post-cache, post-drop). */
  forward: Flow;
  /** Which resource saturated first — drives the teaching feedback. */
  bottleneck?: string;
}

export interface ComponentSpec {
  type: string;
  category: Category;
  label: string;
  blurb: string;
  accent: string; // hex, used for the node + palette accent
  defaults: Config;
  fields: ConfigField[];
  evaluate: (ctx: EvalContext) => NodeEval;
  /** How this component routes typed traffic. Falls back to category if unset. */
  route?: RouteSpec;
  /** Monthly cost (USD) implied by this config. */
  cost: (config: Config) => number;
}

// ---- per-node + aggregate results produced by the engine ----

export type Health = "idle" | "healthy" | "warn" | "hot" | "fail";

export interface NodeResult {
  id: string;
  type: string;
  input: Flow;
  capacity: number;
  utilization: number;
  serviceMs: number; // own latency
  endToEndMs: number; // own + downstream
  dropRate: number;
  successProb: number; // prob a request entering here fully succeeds
  health: Health;
  costUsd: number;
  bottleneck?: string;
}

export interface Metrics {
  offeredRps: number;
  servedRps: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number; // 0..1
  availability: number; // 0..1
  activeNodes: number;
  failingNodes: number;
  totalCostUsd: number;
}

export interface SimResult {
  nodes: Record<string, NodeResult>;
  metrics: Metrics;
}
