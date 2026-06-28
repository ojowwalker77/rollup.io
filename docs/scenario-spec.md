# rollup.io — Scenario Spec v2: Holistic SWE

**Status: proposal, for approval. Not yet built.**

## Why

In the era of code agents, the typing is cheap and the *judgment* is the moat: knowing
what to build, why, the tradeoffs, and how it fails. rollup.io should train the thing that
stays scarce — **cross-layer systems reasoning under real constraints** — not "drag boxes
until green."

Today the engine models **one layer** (architecture/capacity): every cause is "a box is too
small," every fix is "scale the box." Real engineering is the opposite — the same symptom
has causes at different layers, and finding the right one is the skill:

> A latency spike could be an **N+1 query** (code) · a **missing index** (data) · an
> **undersized cache** (architecture) · a **retry storm** (ops) · or a **bot flood** (security).

So every scenario gets depth across the layers, and most are **re-grounded in real events**:
cert case studies for easy/medium, public post-mortems for hard. The tutorial stays synthetic.

## The six layers (skill tree)

Maps onto the AWS/Google Well-Architected pillars (the "authoritative courses") + the two
pillars cloud frameworks under-teach: Code and Delivery.

| Layer | Teaches |
|---|---|
| **Code / Stack** | algorithmic cost, N+1 vs batch, sync vs async, stack choice (Go/Rust/Node), payloads, deps |
| **Data** | schema, **indexes**, consistency, migrations, backups & tested restores, residency/PII |
| **Architecture** | topology, scaling, caching, queues, redundancy, blast radius |
| **Security** | authn/z, secrets, input validation, least-privilege IAM, supply chain, DDoS |
| **Delivery** | CI/tests, canary/blue-green, feature flags, rollback, staged config rollout |
| **Operations** | observability (metrics/logs/traces), SLOs/error budgets, incident response |

Every scenario is tagged with the layers it trains so the campaign provably covers all six.

## New mechanics

1. **Look inside the box (Code + Data).** Components expose *implementation* levers, not just
   capacity: query pattern (N+1 vs batched), sync/blocking vs async, **stack choice**, payload
   size; DBs expose **indexes** (missing index = full scan = the #1 real DB incident). "Fix the
   query" beats "add a server." → deepens every existing scenario.
2. **Observability gates the diagnosis.** The failure-diagnosis engine (already built) is hidden
   unless you wire metrics/logs/traces. No telemetry → "something's slow"; instrumented → "the
   primary is write-saturated on this query." Makes MTTR and observability tangible.
3. **Security = an adversary pass.** A red-team runs against the design (DDoS, injection, SSRF,
   leaked secrets, vulnerable dep). Each maps to a defense; a gap triggers a **breach event**.
4. **Delivery = ship safely.** A deploy phase: a release carries a regression. No
   canary/flags/rollback/staged-config → it hits 100% instantly; progressive delivery catches it.
5. **Incident replay.** Hard scenarios run scripted real events mid-run — capacity yanked, a
   dependency times out, a retry storm, a cache stampede — that you survive by design or live ops.

---

## Scenario library

Legend — **keep** (unchanged tutorial) · **deepen** (add code/data + a layer) · **new**.

### Easy — fundamentals + cert patterns

| # | Scenario | Real-world source | Layers | Status |
|---|---|---|---|---|
| 1 | **Hotel Booking** | synthetic tutorial | Architecture → +Data (index) | keep + deepen |
| 2 | **Breaking News** | viral-spike pattern / AWS WA *Performance* | Architecture, Performance, Data | deepen |
| 3 | **Lock It Down** | AWS Well-Architected *Security* pillar (secure a 3-tier app) | **Security** (authz, secrets, least privilege, input validation) | new |

### Medium — Google Cloud Architect case studies (authoritative, holistic)

| # | Scenario | Real-world source | Layers | Status |
|---|---|---|---|---|
| 4 | **Arena** | GCP PCA *Mountkirk Games* — session-based multiplayer FPS, hundreds of players/arena, global leaderboard | Architecture (global LB, regional), Performance, Reliability, realtime | re-theme Live Chat |
| 5 | **Race Day** | GCP PCA *Helicopter Racing League* — worldwide live streaming + live ML race predictions, CDN to emerging regions | Architecture (CDN/media), Code (ML inference), Performance | re-theme ForYou Feed |
| 6 | **Fleet** | GCP PCA *TerramEarth* — 2M IoT vehicles, 200–500 MB/day each, real-time critical subset + daily batch | **Data** (stream vs batch ingestion), Architecture (queue), Cost | new |
| 7 | **Ship It** | progressive delivery + *Cloudflare 2019* as cautionary tale (no staged WAF rollout) | **Delivery** (canary/flags/rollback/staged config) + **Observability** | new |

### Hard — real post-mortems (it's the day of the incident)

| # | Scenario | Real-world source | The lesson | Layers |
|---|---|---|---|---|
| 8 | **45 Minutes** | *Knight Capital 2012* — $440M in 45 min; repurposed a flag for long-dead "Power Peg" code, deploy script silently skipped 1 of 8 servers, no kill switch | feature flags, kill switch, dead-code hygiene, staged deploy + verification | **Delivery** |
| 9 | **Five Backups** | *GitLab 2017* — engineer `rm`'d the primary (~300 GB), all 5 backup methods were broken; saved by a 6h-old manual snapshot | tested restores, RTO/RPO, replication, alert reliability | **Data / Ops** |
| 10 | **One Packet Away** | *Capital One 2019* — SSRF on a misconfigured WAF → cloud metadata service → over-permissioned IAM role → 106M records from S3 | least-privilege IAM, SSRF/input validation, secrets, encryption, IDS | **Security** |
| 11 | **Cascade** | *AWS S3 us-east-1 2017* (a typo'd command removed too much INDEX/PLACEMENT capacity; cascading) + *Roblox 2021* (Consul/BoltDB contention, cache stampede, 73h) | blast-radius guardrails, backpressure, circuit breakers, cache stampede, runbook safety | **Ops / Architecture** |
| 12 | **Patch Tuesday** | *CrowdStrike 2024* — Channel File 291 (21 vs 20 fields) + a content-validator gap + kernel out-of-bounds read, pushed to the whole fleet with no staged rollout → 8.5M BSOD | staged/ring rollout, content validation, blast radius of agents/config | **Delivery** |

---

## Proposed build order (phased)

- **Phase 1 — depth everywhere.** Mechanic 1 (code+data levers) + mechanic 2 (observability
  gates diagnosis) across the 5 current scenarios. Re-ground #4/#5 on Mountkirk/HRL. *Proves the
  cross-layer loop; fixes "we lack depth everywhere."*
- **Phase 2 — Security.** Mechanic 3 + scenarios #3 (Lock It Down) and #10 (Capital One).
- **Phase 3 — Delivery + Ops.** Mechanic 4 + #7 (Ship It), #8 (Knight Capital), #12 (CrowdStrike).
- **Phase 4 — Reliability/incidents.** Mechanic 5 + #6 (Fleet/TerramEarth), #9 (GitLab), #11 (Cascade).

## Locked decisions

- **Code levers = curated & high-signal.** A handful of judgment decisions per component
  (query pattern N+1/batch, sync vs async, index yes/no, payload size). It stays a *decision*
  game, not a code editor.
- **Stack choice (Go/Rust/Node/Python) = later.** Ship the query/index/async depth first; add
  language/runtime tradeoffs in a follow-up pass.
- **Incident replay = decide after Phase 1.** Lock "build-to-survive" vs interactive "live ops"
  once the code/data depth + observability are in and the loop can be felt.

## Sources

- Knight Capital: https://www.henricodolfing.ch/en/case-study-4-the-440-million-software-error-at-knight-capital/ · https://en.wikipedia.org/wiki/Knight_Capital_Group
- GitLab 2017: https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/
- Cloudflare 2019: https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/
- Capital One 2019: https://krebsonsecurity.com/2019/08/what-we-can-learn-from-the-capital-one-hack/ · https://dl.acm.org/doi/full/10.1145/3546068
- AWS S3 2017: https://aws.amazon.com/message/41926/
- CrowdStrike 2024: https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages
- Roblox 2021: https://blog.roblox.com/2022/01/roblox-return-to-service-10-28-10-31-2021/
- GCP case studies (Mountkirk / TerramEarth / Helicopter Racing League): official GCP Professional Cloud Architect exam case studies
