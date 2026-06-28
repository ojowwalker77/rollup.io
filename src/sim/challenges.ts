// Challenges are data. A Challenge is a real-world scenario (a hotel booking
// platform); its Levels evolve that scenario so each one teaches a distinct,
// real lesson. The player builds ONE system and evolves it level to level
// (cumulative). Each level runs over a time window with a traffic profile that
// varies like real life — the design must hold its SLA through the whole window
// or it bleeds customers (reputation) and loses.

import type { Config, Metrics } from "./types";

export interface Goal {
  id: string;
  label: string;
  ok: (m: Metrics) => boolean;
  actual: (m: Metrics) => string;
  target: string;
}

export interface Sla {
  availability: number; // 0..1
  p99Ms: number;
}

/** A node in a level's pre-built starting architecture. */
export interface StarterNode {
  ref: string; // stable local id, also used by edges (e.g. "app", "sql")
  type: string;
  /** Config overrides merged onto the component's defaults. */
  config?: Config;
  pos: { x: number; y: number };
}

/** The inherited architecture a level opens with. The implicit "client" source
 *  always exists; edges may reference it by the id "client". A level with no
 *  starter opens blank (client only) — reserved for the from-scratch beats. */
export interface Starter {
  nodes: StarterNode[];
  edges: [string, string][]; // [fromRef, toRef]
}

export interface Level {
  id: string;
  name: string;
  rank: string;
  /** Inherited board this level opens with. Omit for a blank, from-scratch start. */
  starter?: Starter;
  /** The chapter lead's briefing, as a short message thread (the voice). */
  thread: string[];
  /** One-line objective for the facts card (what to do, plainly). */
  brief: string;
  concepts: string[];
  hint: string;
  /** Career beat shown on a win (the stakes paying off). */
  reward: string;
  /** The lead's quick in-character reaction to a clear / a loss. */
  winLine: string;
  lossLine: string;
  /** Peak offered load (the Client's rps at profile = 1) + write mix. */
  clientRps: number;
  clientWriteRatio: number;
  /** Monthly budget cap (USD). Infinity = the efficiency endgame. */
  budgetUsd: number;
  parCostUsd?: number;
  sla: Sla;
  /** Label for the simulated time window (flavor). */
  windowLabel: string;
  /** Traffic multiplier over normalized window time t∈[0,1]; peak ≈ 1. */
  profile: (t: number) => number;
}

export interface Challenge {
  id: string;
  title: string;
  chapter: string;
  role: string;
  /** The recurring character who briefs you through this chapter. */
  cast: { name: string; role: string };
  asset: string;
  difficulty: "easy" | "medium" | "hard";
  intro: string;
  componentCatalogs: Record<HostingMode, string[]>;
  levels: Level[];
}

export type HostingMode = "generic" | "aws" | "gcp" | "multicloud";

export const HOSTING_MODES: { id: HostingMode; label: string; blurb: string; enabled: boolean }[] = [
  {
    id: "generic",
    label: "Generic",
    blurb: "Default story mode with clean system-design primitives.",
    enabled: true,
  },
  {
    id: "aws",
    label: "Host on AWS",
    blurb: "Paused while Generic story mode is being tuned.",
    enabled: false,
  },
  {
    id: "gcp",
    label: "Host on GCP",
    blurb: "Paused while Generic story mode is being tuned.",
    enabled: false,
  },
  {
    id: "multicloud",
    label: "Multicloud",
    blurb: "Paused while Generic story mode is being tuned.",
    enabled: false,
  },
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ms = (x: number) => `${Math.round(x)} ms`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function profileAt(level: Level, t: number): number {
  return clamp01(level.profile(clamp01(t)));
}

/** SLA → the two displayed goals. */
export function goalsFromSla(level: Level): Goal[] {
  const a = level.sla.availability;
  const p = level.sla.p99Ms;
  return [
    {
      id: "availability",
      label: "Availability",
      target: `≥ ${(a * 100).toFixed(a >= 0.999 ? 1 : 0)}%`,
      ok: (m) => m.availability >= a,
      actual: (m) => pct(m.availability),
    },
    {
      id: "p99",
      label: "p99 latency",
      target: `≤ ${p} ms`,
      ok: (m) => m.p99Ms <= p,
      actual: (m) => ms(m.p99Ms),
    },
  ];
}

const unique = (items: string[]) => Array.from(new Set(items));

const HOTEL_GENERIC = ["app_server", "sql", "cache", "object_store"];

const ACME_MUSIC_GENERIC = [
  "api_gateway",
  "app_server",
  "redis",
  "sql",
  "nosql",
  "cdn",
  "object_store",
  "search_index",
  "event_queue",
];

const AWS_CORE = [
  "aws_route53",
  "aws_waf",
  "aws_cloudfront",
  "aws_alb",
  "aws_api_gateway",
  "aws_ec2_asg",
  "aws_ecs_fargate",
  "aws_eks",
  "aws_lambda",
  "aws_rds",
  "aws_aurora",
  "aws_dynamodb",
  "aws_elasticache_redis",
  "aws_s3",
  "aws_sqs",
  "aws_sns",
  "aws_eventbridge",
  "aws_cloudwatch",
];

const AWS_ACME_MUSIC = unique([
  "aws_amplify",
  "aws_appsync",
  "aws_vpc_lattice",
  "aws_efs",
  "aws_opensearch",
  "aws_kinesis",
  "aws_msk",
  "aws_step_functions",
  "aws_cognito",
  "aws_secrets_manager",
  "aws_redshift",
  "aws_glue",
  "aws_athena",
  ...AWS_CORE,
]);

const GCP_CORE = [
  "gcp_cloud_load_balancing",
  "gcp_api_gateway",
  "gcp_cloud_cdn",
  "gcp_compute_mig",
  "gcp_cloud_run",
  "gcp_gke",
  "gcp_cloud_functions",
  "gcp_cloud_sql",
  "gcp_spanner",
  "gcp_firestore",
  "gcp_memorystore_redis",
  "gcp_cloud_storage",
  "gcp_pubsub",
  "gcp_cloud_monitoring",
  "gcp_secret_manager",
];

const GCP_ACME_MUSIC = unique([
  "gcp_bigquery",
  "gcp_dataflow",
  ...GCP_CORE,
]);

const catalogs = (generic: string[], _aws: string[], _gcp: string[]): Record<HostingMode, string[]> => ({
  generic,
  // Provider-specific catalogs are paused while the Generic story mode is
  // tuned. This guards stale state or old UI paths from surfacing cloud nodes.
  aws: generic,
  gcp: generic,
  multicloud: generic,
});

export const HOTEL_BOOKING: Challenge = {
  id: "hotel-booking",
  title: "Hotel Booking Platform",
  chapter: "Chapter 1",
  role: "Intern Architect",
  cast: { name: "Dana", role: "Eng Lead" },
  asset: "/assets/story/hotel.svg",
  difficulty: "easy",
  intro:
    "Day one as the new architecture intern. The hotel's booking site is yours to build — start small, learn the levers, and earn your way up to real traffic.",
  componentCatalogs: catalogs(HOTEL_GENERIC, AWS_CORE, GCP_CORE),
  levels: [
    {
      id: "l1-launch",
      name: "Lobby Launch",
      rank: "Intern Architect",
      thread: [
        "ok, you're up. first ticket: get the booking page online and keep it up.",
        "don't overthink it — wire the traffic to something that runs the code and something that stores the bookings. that's the whole job today.",
        "most people are just browsing rooms, so it's mostly reads. hold the SLA and I'll hand you something harder.",
      ],
      brief: "Wire the traffic through compute and storage, and hold the SLA through launch week.",
      concepts: ["Wiring a request path", "Read scaling", "Cache vs. read replica"],
      hint: "Scale the app tier until it isn't the bottleneck, then look at storage. A single database drowns under reads — and a cache is far cheaper than a read replica.",
      reward: "Reads, writes, and latency are three different problems now — and you can say why. Dana lets you touch production in daylight hours.",
      winLine: "clean. it held and it wasn't expensive. welcome to the team.",
      lossLine: "it fell over. look at which box went red first — that's your wall. give it room and run it back.",
      clientRps: 800,
      clientWriteRatio: 0.1,
      budgetUsd: 1100,
      sla: { availability: 0.99, p99Ms: 150 },
      windowLabel: "Launch week",
      profile: (t) => Math.min(1, 0.3 + 1.5 * t), // ramp to peak, then hold
    },
    {
      id: "l2-growth",
      name: "Travel Blog Spike",
      rank: "Intern Architect",
      // Inherited from launch: app + database, no cache yet. Reads pile onto SQL.
      starter: {
        nodes: [
          { ref: "app", type: "app_server", config: { replicas: 3, vcpus: 2 }, pos: { x: 360, y: 200 } },
          { ref: "sql", type: "sql", config: { tier: "small", readReplicas: 0 }, pos: { x: 660, y: 200 } },
        ],
        edges: [["client", "app"], ["app", "sql"]],
      },
      thread: [
        "a travel blogger linked us. traffic more than doubled overnight 😅",
        "the cheap-looking move is a bigger database. the smart move is taking reads off it so you don't need one.",
        "and the CFO's watching the bill now. keep it fast, keep it lean.",
      ],
      brief: "Ride the daily peaks in reads while keeping the monthly bill in check.",
      concepts: ["Horizontal app scaling", "Cache memory → hit ratio", "Cost efficiency"],
      hint: "More cache memory raises the hit ratio, which strips reads off the database — usually far cheaper than scaling the database vertically.",
      reward: "You scaled reads without turning every problem into an expensive database upgrade. Promotion track: unlocked.",
      winLine: "more traffic, basically the same bill. that's the whole job, honestly. nice.",
      lossLine: "we drowned in reads. a bigger DB would've worked and cost a fortune — there's a cheaper lever. find it.",
      clientRps: 2400,
      clientWriteRatio: 0.1,
      budgetUsd: 1500,
      sla: { availability: 0.99, p99Ms: 150 },
      windowLabel: "A day in traffic",
      profile: (t) => 0.7 + 0.3 * Math.sin(t * Math.PI * 2 - Math.PI / 2), // daily wave 0.4→1.0
    },
    {
      id: "l3-worldcup",
      name: "Conference Weekend",
      rank: "Junior Architect",
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
      thread: [
        "big travel conference hits town this weekend. everyone books at once — and bookings are writes.",
        "heads up: you can't replica your way out of writes. replicas are for reads. every write lands on the one primary.",
        "do not rip out SQL at 9am because writes got hard. scale what you've got. that's the junior-level move.",
      ],
      brief: "Survive the booking spike by scaling the relational path — don't replace the source of truth.",
      concepts: ["Write scaling", "Single-primary limit", "Vertical database scaling"],
      hint: "A relational primary is a single writer: replicas help reads, not bookings. Move the SQL tier up, keep cache for reads, and right-size the app tier around the slower database.",
      reward: "You took a write spike head-on and kept SQL as the source of truth. That's the Junior Architect title, earned.",
      winLine: "you took the write spike on the chin and kept the source of truth intact. that's the promotion right there.",
      lossLine: "writes piled up on the primary. more replicas won't save you — that's a bigger-primary problem. take it again.",
      clientRps: 4800,
      clientWriteRatio: 0.35,
      budgetUsd: 6500,
      sla: { availability: 0.99, p99Ms: 180 },
      windowLabel: "Match day",
      profile: (t) => Math.min(1, 0.4 + 0.6 * Math.exp(-Math.pow((t - 0.5) / 0.08, 2))), // baseline + kickoff spike
    },
    {
      id: "l4-championship",
      name: "Promotion Review",
      rank: "Junior Architect",
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
      thread: [
        "promotion review. they want to copy your design to every property in the group.",
        "so it has to be rock solid AND cheap. no budget cap this time — the budget is your score. tighter SLA, too.",
        "leave headroom where it matters, cut every dollar that isn't buying you anything. show me the cheapest thing that still holds.",
      ],
      brief: "Hold a strict SLA through sustained bursts at scale, for the lowest monthly cost you can manage.",
      concepts: ["Cost optimization", "Right-sizing", "SLO headroom"],
      hint: "Anything survives with enough money. The game here is the cheapest design that still holds the SLA through every burst — trim every over-provisioned component.",
      reward: "Stable, fast, lean. The committee signs off — and an investor just asked for your number about a music startup.",
      winLine: "tight, fast, lean. the committee's sold — and someone wants your number. go take the call.",
      lossLine: "it buckled under the bursts. you've got the budget — spend it where the SLA actually breaks, not everywhere.",
      clientRps: 9000,
      clientWriteRatio: 0.3,
      budgetUsd: Infinity,
      parCostUsd: 5800,
      sla: { availability: 0.999, p99Ms: 150 },
      windowLabel: "Peak season",
      profile: (t) => Math.min(1, 0.82 + 0.18 * Math.sin(t * Math.PI * 6)), // sustained, bursty
    },
  ],
};

export const ACME_MUSIC: Challenge = {
  id: "acme-music",
  title: "ACME Music",
  chapter: "Chapter 2",
  role: "Founder Architect",
  cast: { name: "Priya", role: "Co-founder / CEO" },
  asset: "/assets/story/acme-music.svg",
  difficulty: "medium",
  intro:
    "You took the call. Now you're the founding architect of ACME Music — one product with playback, metadata, playlists, search, and a firehose of listening events. Priya handles the rest.",
  componentCatalogs: catalogs(ACME_MUSIC_GENERIC, AWS_ACME_MUSIC, GCP_ACME_MUSIC),
  levels: [
    {
      id: "sp-l1-playback",
      name: "Private Beta Playback",
      rank: "Founder Architect",
      thread: [
        "we're really doing this!! ACME Music, private beta, one region 🎧",
        "people stream tracks and load artwork. audio is huge — serve it from the edge. the object store is the vault, not the hot path.",
        "metadata (titles, albums) can go the normal way: gateway → app → cache → db. just keep playback snappy.",
      ],
      brief: "Build a playback path: edge delivery for audio, with cached metadata behind the API.",
      concepts: ["CDN hit ratio", "Metadata cache", "Object storage origin"],
      hint: "Put a CDN in front of the object store for media, and keep metadata behind the gateway, app, cache, and SQL. Raise CDN edge cache before scaling the origin.",
      reward: "ACME streams without melting its origin store. Media delivery and the metadata API are cleanly separated.",
      winLine: "it streams and the origin isn't melting. we have a product 🎧",
      lossLine: "playback stuttered. if audio's hammering the origin store, push it to the edge and try again.",
      clientRps: 12000,
      clientWriteRatio: 0.06,
      budgetUsd: 9000,
      sla: { availability: 0.995, p99Ms: 180 },
      windowLabel: "Launch day",
      profile: (t) => Math.min(1, 0.45 + 0.9 * t),
    },
    {
      id: "sp-l2-search",
      name: "Playlist Saves",
      rank: "Founder Architect",
      // The playback + metadata product you founded. Missing piece: a write-
      // scaled store for the flood of user-library saves.
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
          ["app", "redis"], ["app", "sql"], ["cdn", "store"],
        ],
      },
      thread: [
        "people are saving tracks and following playlists like crazy. that's a lot of new writes.",
        "don't jam all that onto the catalog DB — accounts and catalog like SQL, but high-volume user activity wants a store that scales writes by adding nodes.",
        "whatever you do, don't break playback. that path stays fast.",
      ],
      brief: "Add a write-scaled user-library path without slowing the playback path you already built.",
      concepts: ["User-library writes", "Partitioned data", "Read/write separation"],
      hint: "Keep SQL for relational catalog and account data. Add a NoSQL store for high-volume user-library writes, and add nodes when partition throughput gets hot.",
      reward: "Playlists save instantly, and playback never went through the same bottleneck. Separate paths for separate problems.",
      winLine: "saves work and playback never flinched. separate paths for separate problems — love it.",
      lossLine: "the user-library writes backed up. SQL's one primary can't take that volume — give writes a store that scales out.",
      clientRps: 22000,
      clientWriteRatio: 0.14,
      budgetUsd: 18500,
      sla: { availability: 0.995, p99Ms: 200 },
      windowLabel: "Evening commute",
      profile: (t) => 0.65 + 0.35 * Math.sin(t * Math.PI),
    },
    {
      id: "sp-l3-discovery",
      name: "Discovery Goes Viral",
      rank: "Lead Architect",
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
          ["app", "redis"], ["app", "sql"], ["app", "nosql"], ["cdn", "store"],
        ],
      },
      thread: [
        "the discovery feed blew up overnight. everyone's searching artists, albums, playlists nonstop.",
        "do NOT make the main database be the search engine — that query fanout will flatten it.",
        "give search its own home with its own knobs. SQL stays the source of truth.",
      ],
      brief: "Add dedicated search capacity so discovery traffic doesn't hammer the catalog database.",
      concepts: ["Search index capacity", "Read models", "Shard sizing"],
      hint: "Add a search index on the app path. Add search nodes or ease shard pressure when query capacity turns hot, while SQL stays the source of truth.",
      reward: "Search holds and the catalog DB stays calm. You've got real read models now — that's lead-architect thinking.",
      winLine: "search holds and the catalog DB is calm. real read models. that's lead-architect thinking — title's yours.",
      lossLine: "search hammered the database flat. it needs its own index, sized for the query load — not the primary.",
      clientRps: 36000,
      clientWriteRatio: 0.12,
      budgetUsd: 30000,
      sla: { availability: 0.998, p99Ms: 210 },
      windowLabel: "Friday night",
      profile: (t) => 0.55 + 0.45 * Math.sin(t * Math.PI),
    },
    {
      id: "sp-l4-festival",
      name: "Festival Drop",
      rank: "Lead Architect",
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
          ["app", "redis"], ["app", "sql"], ["app", "nosql"], ["app", "search"], ["cdn", "store"],
        ],
      },
      thread: [
        "global festival drop tonight. playback spikes, playlist writes spike, AND a flood of listening events 🚀",
        "the events can't block playback. buffer them — take the write fast, drain it later.",
        "keep the user-facing paths fast, shove the heavy async stuff into a queue. this is the big one.",
      ],
      brief: "Survive the global spike: edge delivery, horizontal services, scalable data, and buffered event ingestion.",
      concepts: ["Event queues", "Burst absorption", "Independent data paths"],
      hint: "Add an event queue for listening events. Keep playback on the CDN/API paths, keep user state in NoSQL, and scale app + cache around the latency you actually created.",
      reward: "ACME survives its first global moment. Media, metadata, user state, search, async events — you have the whole playbook.",
      winLine: "you survived a global moment. edge, data, search, async events — that's the whole playbook. we're a real company now.",
      lossLine: "the spike took us down. if analytics is blocking playback, put a queue between them and let it absorb the burst.",
      clientRps: 52000,
      clientWriteRatio: 0.22,
      budgetUsd: 50000,
      sla: { availability: 0.999, p99Ms: 220 },
      windowLabel: "Festival launch",
      profile: (t) => Math.min(1, 0.55 + 0.45 * Math.exp(-Math.pow((t - 0.45) / 0.16, 2))),
    },
  ],
};

export const CHALLENGES: Challenge[] = [HOTEL_BOOKING, ACME_MUSIC];
