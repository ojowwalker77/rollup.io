import type { Scenario } from "./types";

export const ACME_MUSIC: Scenario = {
  id: "acme-music",
  title: "Music Streaming",
  difficulty: "hard",
  blurb:
    "A media product at scale: edge-deliver audio, separate user-library writes onto a partitioned store, give search its own read model, and buffer a firehose of listening events.",
  teaches: ["CDN / media", "NoSQL", "Search", "Event queues"],
  art: "/assets/scenarios/acme-music.svg",
  components: ["api_gateway", "app_server", "redis", "sql", "nosql", "cdn", "object_store", "search_index", "event_queue"],
  levels: [
    {
      id: "sp-l1-playback",
      name: "Private Beta Playback",
      brief: "Build a playback path: edge delivery for audio, with cached metadata behind the API.",
      concepts: ["CDN hit ratio", "Metadata cache", "Object storage origin"],
      hint: "Put a CDN in front of the object store for media, and keep metadata behind the gateway, app, cache, and SQL. Raise CDN edge cache before scaling the origin.",
      clientRps: 12000,
      clientWriteRatio: 0.06,
      mix: { media: 0.5, read: 0.44, write: 0.06 },
      budgetUsd: 9000,
      sla: { availability: 0.995, p99Ms: 180 },
      windowLabel: "Launch day",
      profile: (t) => Math.min(1, 0.45 + 0.9 * t),
    },
    {
      id: "sp-l2-library",
      name: "Playlist Saves",
      // The playback + metadata product. Missing piece: a write-scaled store for
      // the flood of user-library saves.
      starter: {
        nodes: [
          { ref: "gw", type: "api_gateway", config: { gateways: 2, maxRpsPerGateway: 14000 }, pos: { x: 340, y: 200 } },
          { ref: "app", type: "app_server", config: { replicas: 10, vcpus: 4 }, pos: { x: 600, y: 200 } },
          { ref: "redis", type: "redis", config: { memoryGB: 48, workingSetGB: 64 }, pos: { x: 880, y: 100 } },
          { ref: "sql", type: "sql", config: { tier: "large", readReplicas: 2 }, pos: { x: 880, y: 240 } },
          { ref: "cdn", type: "cdn", config: { edgeTb: 20, catalogTb: 24, maxRps: 600000 }, pos: { x: 600, y: 420 } },
          { ref: "store", type: "object_store", pos: { x: 880, y: 420 } },
        ],
        edges: [
          ["client", "gw"], ["client", "cdn"], ["gw", "app"],
          ["app", "redis"], ["redis", "sql"], ["cdn", "store"],
        ],
      },
      brief: "Add a write-scaled user-library path without slowing the playback path you already built.",
      concepts: ["User-library writes", "Partitioned data", "Read/write separation"],
      hint: "Keep SQL for relational catalog and account data. Add a NoSQL store for high-volume user-library writes, and add nodes when partition throughput gets hot.",
      clientRps: 22000,
      clientWriteRatio: 0.14,
      mix: { media: 0.45, read: 0.32, write: 0.05, kv: 0.18 },
      budgetUsd: 18500,
      sla: { availability: 0.995, p99Ms: 200 },
      windowLabel: "Evening commute",
      profile: (t) => 0.65 + 0.35 * Math.sin(t * Math.PI),
    },
    {
      id: "sp-l3-discovery",
      name: "Discovery Goes Viral",
      // Playback, metadata, and user library are in place. Missing piece: a
      // dedicated search read model so discovery doesn't hammer the catalog DB.
      starter: {
        nodes: [
          { ref: "gw", type: "api_gateway", config: { gateways: 3, maxRpsPerGateway: 16000 }, pos: { x: 320, y: 200 } },
          { ref: "app", type: "app_server", config: { replicas: 16, vcpus: 4 }, pos: { x: 580, y: 200 } },
          { ref: "redis", type: "redis", config: { memoryGB: 64, workingSetGB: 80 }, pos: { x: 860, y: 80 } },
          { ref: "sql", type: "sql", config: { tier: "large", readReplicas: 3 }, pos: { x: 860, y: 220 } },
          { ref: "nosql", type: "nosql", config: { nodes: 8 }, pos: { x: 860, y: 360 } },
          { ref: "cdn", type: "cdn", config: { edgeTb: 24, catalogTb: 28, maxRps: 900000 }, pos: { x: 580, y: 460 } },
          { ref: "store", type: "object_store", pos: { x: 860, y: 480 } },
        ],
        edges: [
          ["client", "gw"], ["client", "cdn"], ["gw", "app"],
          ["app", "redis"], ["redis", "sql"], ["app", "nosql"], ["cdn", "store"],
        ],
      },
      brief: "Add dedicated search capacity so discovery traffic doesn't hammer the catalog database.",
      concepts: ["Search index capacity", "Read models", "Shard sizing"],
      hint: "Add a search index on the app path. Add search nodes or ease shard pressure when query capacity turns hot, while SQL stays the source of truth.",
      clientRps: 36000,
      clientWriteRatio: 0.12,
      mix: { media: 0.4, read: 0.27, write: 0.05, kv: 0.15, search: 0.13 },
      budgetUsd: 30000,
      sla: { availability: 0.998, p99Ms: 210 },
      windowLabel: "Friday night",
      profile: (t) => 0.55 + 0.45 * Math.sin(t * Math.PI),
    },
    {
      id: "sp-l4-festival",
      name: "Festival Drop",
      // The full product: playback, metadata, user library, search. Missing
      // piece: a queue to buffer the listening-event firehose off the hot path.
      starter: {
        nodes: [
          { ref: "gw", type: "api_gateway", config: { gateways: 4, maxRpsPerGateway: 16000 }, pos: { x: 300, y: 200 } },
          { ref: "app", type: "app_server", config: { replicas: 24, vcpus: 4 }, pos: { x: 560, y: 200 } },
          { ref: "redis", type: "redis", config: { memoryGB: 96, workingSetGB: 120 }, pos: { x: 840, y: 60 } },
          { ref: "sql", type: "sql", config: { tier: "xlarge", readReplicas: 3 }, pos: { x: 840, y: 200 } },
          { ref: "nosql", type: "nosql", config: { nodes: 12 }, pos: { x: 840, y: 340 } },
          { ref: "search", type: "search_index", config: { nodes: 8, shardGb: 80 }, pos: { x: 840, y: 480 } },
          { ref: "cdn", type: "cdn", config: { edgeTb: 32, catalogTb: 36, maxRps: 1500000 }, pos: { x: 560, y: 540 } },
          { ref: "store", type: "object_store", pos: { x: 840, y: 600 } },
        ],
        edges: [
          ["client", "gw"], ["client", "cdn"], ["gw", "app"],
          ["app", "redis"], ["redis", "sql"], ["app", "nosql"], ["app", "search"], ["cdn", "store"],
        ],
      },
      brief: "Survive the global spike: edge delivery, horizontal services, scalable data, and buffered event ingestion.",
      concepts: ["Event queues", "Burst absorption", "Independent data paths"],
      hint: "Add an event queue for listening events. Keep playback on the CDN/API paths, keep user state in NoSQL, and scale app + cache around the latency you actually created.",
      clientRps: 52000,
      clientWriteRatio: 0.22,
      mix: { media: 0.35, read: 0.22, write: 0.05, kv: 0.15, search: 0.1, event: 0.13 },
      budgetUsd: 50000,
      sla: { availability: 0.999, p99Ms: 220 },
      windowLabel: "Festival launch",
      profile: (t) => Math.min(1, 0.55 + 0.45 * Math.exp(-Math.pow((t - 0.45) / 0.16, 2))),
    },
  ],
};
