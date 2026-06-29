import type { Scenario } from "./types";

// The most common real performance bug: the page got slow and the instinct is
// "add a bigger server." But the cause is in the CODE/DATA layer — a missing
// index (full table scan) or N+1 queries — and scaling the box barely helps.

export const PROFILE: Scenario = {
  id: "profile-page",
  title: "The Profile Page",
  difficulty: "easy",
  blurb:
    "The page got slow as the data grew — same servers, same traffic, but it crawls. The fix isn't a bigger box; it's the query. Learn to read the symptom and fix it at the code/data layer.",
  teaches: ["Database indexes", "N+1 queries", "Fix the query not the box", "Observability"],
  art: "/assets/scenarios/profile-page.svg",
  components: ["app_server", "sql", "cache"],
  levels: [
    {
      id: "pp-l1-index",
      name: "Page Won't Load",
      // The query has no index → full table scan. The instinct (scale the DB) is
      // expensive and barely helps; the index is free.
      starter: {
        nodes: [
          { ref: "app", type: "app_server", config: { replicas: 4, vcpus: 2 }, pos: { x: 380, y: 240 } },
          { ref: "sql", type: "sql", config: { tier: "medium", indexed: "no" }, pos: { x: 680, y: 240 } },
        ],
        edges: [["client", "app"], ["app", "sql"]],
      },
      situation: "The profile page got slow as the users table grew. Same servers, same traffic — it just crawls now.",
      brief: "Make the page fast again. The hardware is fine; the query is doing a full table scan.",
      concepts: ["Database indexes", "Full table scan", "Fix the query, not the box"],
      hint: "A query with no index is a full table scan — roughly 10× slower and 10× fewer queries/sec. Add the index on the SQL node (it's free); a bigger instance costs a fortune and barely helps.",
      clientRps: 2000,
      clientWriteRatio: 0.1,
      budgetUsd: 1500,
      sla: { availability: 0.99, p99Ms: 180 },
      windowLabel: "Tuesday afternoon",
      profile: (t) => Math.min(1, 0.5 + t),
    },
    {
      id: "pp-l2-nplus1",
      name: "The Activity Feed",
      // The feed loads a user, then queries the DB once per item in a loop.
      // The DB is fine; the request makes 20 sequential queries. Batch it.
      starter: {
        nodes: [
          { ref: "app", type: "app_server", config: { replicas: 8, vcpus: 2, queriesPerReq: 20 }, pos: { x: 380, y: 240 } },
          { ref: "sql", type: "sql", config: { tier: "large" }, pos: { x: 680, y: 240 } },
        ],
        edges: [["client", "app"], ["app", "sql"]],
      },
      situation: "The new activity feed loads a user, then queries the database once per item in a loop. The DB looks fine, but the page drags.",
      brief: "Speed up the feed without scaling the database — the problem is how many queries each request makes.",
      concepts: ["N+1 queries", "Batching", "Blocking vs async I/O"],
      hint: "Each request fans into many sequential queries — the N+1 problem. Drop 'DB queries / request' to 1 (batch them). Scaling the DB won't help: the latency is N sequential round-trips, not throughput.",
      clientRps: 3000,
      clientWriteRatio: 0.1,
      budgetUsd: 2500,
      sla: { availability: 0.99, p99Ms: 150 },
      windowLabel: "Evening scroll",
      profile: (t) => 0.7 + 0.3 * Math.sin(t * Math.PI),
    },
  ],
};
