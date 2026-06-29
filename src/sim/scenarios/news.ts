import type { Scenario } from "./types";

// New axis: latency. Object storage is durable but slow (high time-to-first-
// byte); a CDN serves hot content from the edge. If the edge cache is too small
// most reads fall through to slow origin and p99 blows past the SLA — even
// though availability looks fine. The lesson is hit ratio → latency.

export const NEWS: Scenario = {
  id: "breaking-news",
  title: "Breaking News",
  difficulty: "easy",
  blurb:
    "A news site where one story can hit the front page in minutes. Serve articles and images from the edge so readers get low latency and the slow origin store isn't on the hot path.",
  teaches: ["CDN edge cache", "Origin offload", "Hit ratio → latency", "p99"],
  art: "/assets/scenarios/breaking-news.svg",
  components: ["app_server", "sql", "cache", "cdn", "object_store"],
  levels: [
    {
      id: "news-l1-publish",
      name: "Publish",
      // The comments/metadata API is wired, but article bodies and images
      // (media) have nowhere to be served from.
      starter: {
        nodes: [
          { ref: "app", type: "app_server", config: { replicas: 3, vcpus: 2 }, pos: { x: 360, y: 320 } },
          { ref: "cache", type: "cache", config: { memoryGB: 16, workingSetGB: 16 }, pos: { x: 640, y: 260 } },
          { ref: "sql", type: "sql", config: { tier: "small" }, pos: { x: 640, y: 380 } },
        ],
        edges: [["client", "app"], ["app", "cache"], ["cache", "sql"]],
      },
      situation: "Launch day for the newsroom. Articles and images need to reach readers fast, from durable storage.",
      brief: "Serve article bodies and images from the edge, backed by durable origin storage, alongside the comments API.",
      concepts: ["CDN + object storage", "Static content delivery", "Edge vs origin"],
      hint: "Article bodies and images are static — serve them through a CDN backed by object storage (Client → CDN → Object Store). Raise the CDN's edge cache so most requests are hits and pay edge latency, not the origin's slow time-to-first-byte.",
      clientRps: 6000,
      clientWriteRatio: 0.05,
      mix: { media: 0.6, read: 0.35, write: 0.05 },
      budgetUsd: 5000,
      sla: { availability: 0.99, p99Ms: 260 },
      windowLabel: "Publish day",
      profile: (t) => Math.min(1, 0.4 + 1.2 * t),
    },
    {
      id: "news-l2-frontpage",
      name: "Front Page",
      // The full site, but a story just went viral and the edge cache holds
      // almost none of the hot catalog — most reads fall through to slow origin.
      starter: {
        nodes: [
          { ref: "cdn", type: "cdn", config: { edgeTb: 4, catalogTb: 40, maxRps: 900000 }, pos: { x: 360, y: 140 } },
          { ref: "store", type: "object_store", pos: { x: 640, y: 120 } },
          { ref: "app", type: "app_server", config: { replicas: 8, vcpus: 2 }, pos: { x: 360, y: 340 } },
          { ref: "cache", type: "cache", config: { memoryGB: 32, workingSetGB: 32 }, pos: { x: 640, y: 280 } },
          { ref: "sql", type: "sql", config: { tier: "medium" }, pos: { x: 640, y: 400 } },
        ],
        edges: [["client", "cdn"], ["cdn", "store"], ["client", "app"], ["app", "cache"], ["cache", "sql"]],
      },
      situation: "A story just hit the front page. Reads are exploding — and they're nearly all the same few articles.",
      brief: "A story went front-page. Hold p99 through the spike by serving reads from the edge instead of slow origin storage.",
      concepts: ["Edge hit ratio", "Latency under load", "Origin offload"],
      hint: "An edge cache only helps if it actually holds the hot content. Raise the CDN's edge cache toward the size of the hot catalog so nearly every request is a hit — misses pay the origin's slow time-to-first-byte and wreck p99.",
      clientRps: 30000,
      clientWriteRatio: 0.03,
      mix: { media: 0.78, read: 0.2, write: 0.02 },
      budgetUsd: 9000,
      sla: { availability: 0.995, p99Ms: 220 },
      windowLabel: "Front page",
      profile: (t) => Math.min(1, 0.5 + 0.5 * Math.exp(-Math.pow((t - 0.5) / 0.18, 2))),
    },
  ],
};
