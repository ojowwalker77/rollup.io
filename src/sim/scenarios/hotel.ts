import type { Scenario } from "./types";

export const HOTEL: Scenario = {
  id: "hotel-booking",
  title: "Hotel Booking",
  difficulty: "easy",
  blurb:
    "The fundamentals on a transactional booking site: wire a request path, take reads off the database with a cache, survive a write spike, then make it cheap.",
  teaches: ["Request path", "Caching", "Write scaling", "Cost"],
  art: "/assets/scenarios/hotel.svg",
  components: ["app_server", "sql", "cache", "object_store"],
  levels: [
    {
      id: "l1-launch",
      name: "Launch",
      brief: "Wire the traffic through compute and storage, and hold the SLA through launch week.",
      concepts: ["Wiring a request path", "Read scaling", "Cache vs. read replica"],
      hint: "Scale the app tier until it isn't the bottleneck, then look at storage. A single database drowns under reads — and a cache is far cheaper than a read replica.",
      clientRps: 800,
      clientWriteRatio: 0.1,
      budgetUsd: 1100,
      sla: { availability: 0.99, p99Ms: 150 },
      windowLabel: "Launch week",
      profile: (t) => Math.min(1, 0.3 + 1.5 * t),
    },
    {
      id: "l2-growth",
      name: "Travel Blog Spike",
      // Inherited from launch: app + database, no cache yet. Reads pile onto SQL.
      starter: {
        nodes: [
          { ref: "app", type: "app_server", config: { replicas: 3, vcpus: 2 }, pos: { x: 360, y: 200 } },
          { ref: "sql", type: "sql", config: { tier: "small", readReplicas: 0 }, pos: { x: 660, y: 200 } },
        ],
        edges: [["client", "app"], ["app", "sql"]],
      },
      brief: "Ride the daily peaks in reads while keeping the monthly bill in check.",
      concepts: ["Horizontal app scaling", "Cache memory → hit ratio", "Cost efficiency"],
      hint: "Put the cache between the app and the database (app → cache → database) so reads hit it first. More cache memory raises the hit ratio, stripping reads off the database — usually far cheaper than scaling the database vertically.",
      clientRps: 2400,
      clientWriteRatio: 0.1,
      budgetUsd: 1500,
      sla: { availability: 0.99, p99Ms: 150 },
      windowLabel: "A day in traffic",
      profile: (t) => 0.7 + 0.3 * Math.sin(t * Math.PI * 2 - Math.PI / 2),
    },
    {
      id: "l3-worldcup",
      name: "Conference Weekend",
      // Read-optimized design carried over, but the primary is sized for reads,
      // not the booking write spike. The missing piece is write capacity.
      starter: {
        nodes: [
          { ref: "app", type: "app_server", config: { replicas: 5, vcpus: 2 }, pos: { x: 340, y: 180 } },
          { ref: "cache", type: "cache", config: { memoryGB: 16, workingSetGB: 24 }, pos: { x: 620, y: 120 } },
          { ref: "sql", type: "sql", config: { tier: "small", readReplicas: 0 }, pos: { x: 900, y: 220 } },
        ],
        edges: [["client", "app"], ["app", "cache"], ["cache", "sql"]],
      },
      brief: "Survive the booking spike by scaling the relational path — don't replace the source of truth.",
      concepts: ["Write scaling", "Single-primary limit", "Vertical database scaling"],
      hint: "A relational primary is a single writer: replicas help reads, not bookings. Move the SQL tier up, keep cache for reads, and right-size the app tier around the slower database.",
      clientRps: 4800,
      clientWriteRatio: 0.35,
      budgetUsd: 6500,
      sla: { availability: 0.99, p99Ms: 180 },
      windowLabel: "Match day",
      profile: (t) => Math.min(1, 0.4 + 0.6 * Math.exp(-Math.pow((t - 0.5) / 0.08, 2))),
    },
    {
      id: "l4-championship",
      name: "Peak Season",
      // A working but over-provisioned design. The "missing piece" here is
      // efficiency: every tier is fatter than it needs to be. Trim to par.
      starter: {
        nodes: [
          { ref: "app", type: "app_server", config: { replicas: 24, vcpus: 4 }, pos: { x: 340, y: 180 } },
          { ref: "cache", type: "cache", config: { memoryGB: 64, workingSetGB: 40, maxOps: 500000 }, pos: { x: 620, y: 120 } },
          { ref: "sql", type: "sql", config: { tier: "xlarge", readReplicas: 3 }, pos: { x: 900, y: 220 } },
        ],
        edges: [["client", "app"], ["app", "cache"], ["cache", "sql"]],
      },
      brief: "Hold a strict SLA through sustained bursts at scale, for the lowest monthly cost you can manage.",
      concepts: ["Cost optimization", "Right-sizing", "SLO headroom"],
      hint: "Anything survives with enough money. The game here is the cheapest design that still holds the SLA through every burst — trim every over-provisioned component.",
      clientRps: 9000,
      clientWriteRatio: 0.3,
      budgetUsd: Infinity,
      parCostUsd: 5800,
      sla: { availability: 0.999, p99Ms: 150 },
      windowLabel: "Peak season",
      profile: (t) => Math.min(1, 0.82 + 0.18 * Math.sin(t * Math.PI * 6)),
    },
  ],
};
