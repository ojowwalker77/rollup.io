import type { Scenario } from "./types";

// New area: ML serving. A recommendation feed runs a model per request on
// expensive GPUs. Brute-forcing it with more GPUs blows the budget; the lever
// is caching hot predictions so most requests skip the GPU entirely.

export const FEED: Scenario = {
  id: "foryou-feed",
  title: "ForYou Feed",
  difficulty: "medium",
  blurb:
    "A personalized recommendation feed backed by an ML model. Every open runs inference on costly GPUs — serve the feed fast without a runaway GPU bill by caching hot predictions.",
  teaches: ["ML inference", "GPU cost", "Caching predictions", "Compute vs cache"],
  art: "/assets/scenarios/foryou-feed.svg",
  components: ["api_gateway", "app_server", "cache", "redis", "sql", "inference_server", "observability"],
  levels: [
    {
      id: "feed-l1-personalize",
      name: "Personalize",
      // The content/profile API is built, but the feed itself has no model
      // server — the inference class has nowhere to go.
      starter: {
        nodes: [
          { ref: "gw", type: "api_gateway", config: { gateways: 2, maxRpsPerGateway: 12000 }, pos: { x: 340, y: 280 } },
          { ref: "app", type: "app_server", config: { replicas: 12, vcpus: 2 }, pos: { x: 600, y: 280 } },
          { ref: "cache", type: "cache", config: { memoryGB: 24, workingSetGB: 24 }, pos: { x: 860, y: 220 } },
          { ref: "sql", type: "sql", config: { tier: "medium" }, pos: { x: 860, y: 340 } },
        ],
        edges: [["client", "gw"], ["gw", "app"], ["app", "cache"], ["cache", "sql"]],
      },
      situation: "The recommendation feed is launching. Every open should feel hand-picked — without a runaway GPU bill.",
      brief: "Add a model-serving tier so the feed returns personalized recommendations, without a runaway GPU bill.",
      concepts: ["Inference tier", "GPU throughput", "Caching predictions"],
      hint: "Recommendations are their own class — add an Inference Server on the app path (app → inference). GPUs are expensive: raise its prediction cache so popular feeds skip the GPU, and only add replicas for the misses.",
      clientRps: 8000,
      clientWriteRatio: 0.1,
      mix: { inference: 0.4, read: 0.5, write: 0.1 },
      budgetUsd: 8000,
      sla: { availability: 0.99, p99Ms: 280 },
      windowLabel: "Rollout",
      profile: (t) => Math.min(1, 0.45 + 0.9 * t),
    },
    {
      id: "feed-l2-hooked",
      name: "Everyone's Hooked",
      // The feed works, but the model server barely caches anything, so almost
      // every request hits a GPU. Brute-forcing replicas blows the budget.
      starter: {
        nodes: [
          { ref: "gw", type: "api_gateway", config: { gateways: 3, maxRpsPerGateway: 16000 }, pos: { x: 320, y: 300 } },
          { ref: "app", type: "app_server", config: { replicas: 16, vcpus: 4 }, pos: { x: 580, y: 300 } },
          { ref: "cache", type: "cache", config: { memoryGB: 48, workingSetGB: 48 }, pos: { x: 840, y: 240 } },
          { ref: "sql", type: "sql", config: { tier: "large" }, pos: { x: 840, y: 360 } },
          { ref: "infer", type: "inference_server", config: { replicas: 6, perReplicaRps: 200, memoryGB: 8, workingSetGB: 80 }, pos: { x: 580, y: 120 } },
        ],
        edges: [["client", "gw"], ["gw", "app"], ["app", "cache"], ["cache", "sql"], ["app", "infer"]],
      },
      situation: "Engagement is through the roof. Inference load just exploded — and the GPU bill is about to.",
      brief: "The feed is a hit and inference load has exploded. Hold the SLA within budget — adding GPUs alone won't fit.",
      concepts: ["GPU cost ceiling", "Prediction cache hit ratio", "Right-sizing compute"],
      hint: "Adding GPU replicas for every request is too expensive to fit the budget. Raise the inference server's prediction cache (memory toward the distinct-predictions size) so most requests are cache hits and skip the GPU — then add replicas only for the remaining misses.",
      clientRps: 24000,
      clientWriteRatio: 0.12,
      mix: { inference: 0.45, read: 0.4, write: 0.15 },
      budgetUsd: 16000,
      sla: { availability: 0.995, p99Ms: 280 },
      windowLabel: "Peak engagement",
      profile: (t) => 0.6 + 0.4 * Math.sin(t * Math.PI),
    },
  ],
};
