import type { Scenario } from "./types";

// New area: real-time delivery. Everything else in the library is request/
// response; here a separate WebSocket tier holds live connections and pushes
// messages to subscribers. One message fans out to every viewer, so delivery
// load dwarfs the request load that produced it.

export const LIVE_CHAT: Scenario = {
  id: "live-chat",
  title: "Live Stream Chat",
  difficulty: "medium",
  blurb:
    "A real-time chat for live streams. Live messages must be pushed to every viewer over persistent connections — a different tier from the request/response API, and the firehose has to be persisted without slowing delivery.",
  teaches: ["WebSockets", "Message fanout", "Realtime vs API tier", "Write-scaled history"],
  art: "/assets/scenarios/live-chat.svg",
  components: ["api_gateway", "app_server", "cache", "redis", "sql", "nosql", "realtime_gateway"],
  levels: [
    {
      id: "lc-l1-golive",
      name: "Going Live",
      // The request/response API path is built (history + stream metadata), but
      // there's no tier for live messages — the realtime class has no home.
      starter: {
        nodes: [
          { ref: "gw", type: "api_gateway", config: { gateways: 2, maxRpsPerGateway: 12000 }, pos: { x: 340, y: 260 } },
          { ref: "app", type: "app_server", config: { replicas: 8, vcpus: 2 }, pos: { x: 600, y: 260 } },
          { ref: "cache", type: "cache", config: { memoryGB: 20, workingSetGB: 20 }, pos: { x: 860, y: 180 } },
          { ref: "sql", type: "sql", config: { tier: "medium" }, pos: { x: 860, y: 320 } },
        ],
        edges: [["client", "gw"], ["gw", "app"], ["app", "cache"], ["cache", "sql"]],
      },
      situation: "A streamer just went live. Thousands of viewers want the chat to feel instant.",
      brief: "Add a realtime tier so live chat messages reach every viewer, without disturbing the history/metadata API.",
      concepts: ["WebSocket gateway", "Realtime vs request/response", "Persistent connections"],
      hint: "Live messages are their own class — the request/response API can't deliver them. Wire the Client straight to a Realtime Gateway for live traffic, and keep history and metadata on the API path. Scale gateway instances until delivery throughput keeps up.",
      clientRps: 15000,
      clientWriteRatio: 0.1,
      mix: { realtime: 0.55, read: 0.35, write: 0.1 },
      budgetUsd: 7000,
      sla: { availability: 0.99, p99Ms: 220 },
      windowLabel: "Stream goes live",
      profile: (t) => Math.min(1, 0.4 + 1.2 * t),
    },
    {
      id: "lc-l2-viral",
      name: "Going Viral",
      // Realtime delivery + API are wired and scaled, but every chat message is
      // now persisted as history — a write firehose the relational primary can't
      // take. The missing piece is a write-scaled store for message history.
      starter: {
        nodes: [
          { ref: "rt", type: "realtime_gateway", config: { instances: 4, throughputK: 8 }, pos: { x: 360, y: 120 } },
          { ref: "gw", type: "api_gateway", config: { gateways: 3, maxRpsPerGateway: 16000 }, pos: { x: 340, y: 320 } },
          { ref: "app", type: "app_server", config: { replicas: 14, vcpus: 4 }, pos: { x: 600, y: 320 } },
          { ref: "cache", type: "cache", config: { memoryGB: 32, workingSetGB: 32 }, pos: { x: 860, y: 240 } },
          { ref: "sql", type: "sql", config: { tier: "large" }, pos: { x: 860, y: 400 } },
        ],
        edges: [["client", "rt"], ["client", "gw"], ["gw", "app"], ["app", "cache"], ["cache", "sql"]],
      },
      situation: "The stream blew up. Chat is a firehose now — and every message still has to be saved.",
      brief: "Persist the chat-message firehose without slowing delivery, and scale the realtime tier through the spike.",
      concepts: ["Message-history firehose", "Write-scaled store", "Fanout amplification"],
      hint: "Chat history is a high-volume write stream — the single SQL primary can't absorb it. Add a NoSQL store for message history (wire app → NoSQL) and add nodes as it gets hot. Scale the realtime gateway's instances so push throughput keeps up with the viewer surge.",
      clientRps: 45000,
      clientWriteRatio: 0.28,
      mix: { realtime: 0.5, read: 0.22, write: 0.05, kv: 0.23 },
      budgetUsd: 22000,
      sla: { availability: 0.995, p99Ms: 230 },
      windowLabel: "Viral moment",
      profile: (t) => Math.min(1, 0.5 + 0.5 * Math.exp(-Math.pow((t - 0.5) / 0.18, 2))),
    },
  ],
};
