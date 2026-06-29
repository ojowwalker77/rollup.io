# rollup.io — game feel roadmap

North star: a *systems-design* game, not "drag AWS icons until green." Real primitives,
real tradeoffs, real tension. Clean & classy, never slopified.

## ▶ v2 — Holistic SWE (APPROVED — full plan in `docs/scenario-spec.md`)

Pivot: train cross-layer judgment (Code · Data · Architecture · Security · Delivery · Operations),
not just topology. Same symptom, many possible layers — diagnosing the right one is the game.
Re-ground scenarios in real events (GCP Architect case studies + public post-mortems); Hotel stays
the synthetic tutorial. Locked: code levers curated/high-signal (not a code editor); stack choice
(Go/Rust/Node) later; incident-replay style decided after Phase 1.

**Phase 1 — depth everywhere:**
- [x] Code+data lever model: **DB index** (full-scan penalty), **N+1** queries/request, **async vs blocking** I/O — in component evaluate(); node faces show flags. Verified.
- [x] **Observability** now a provisioned toggle (Off / Metrics / Full) that gates ALL runtime
      telemetry, not just the post-mortem — fixes the bug where you could read the cause anyway.
      none → nodes neutral + "flying blind"; basic → metrics + node health; full → + bottleneck/traces.
- [x] **UI/UX rework → Layout A.** Replaced the 4 floating panels with one bottom **Dock**:
      build = Targets + Monitoring control + Go Live; run = LIVE/progress + gated Telemetry +
      always-on Customers meter. Canvas is the hero; SystemNode/ConfigPanel telemetry now gated.
- [x] New **Profile Page** scenario (easy) showcasing it: a missing index / N+1 that scaling can't fix (verified: xlarge + 40 replicas still fail and bust budget; the index/batch is the fix).
- [ ] Deepen the OTHER existing scenarios with a code/data root cause where it fits
- [ ] Re-ground Arena = Mountkirk Games, Race Day = Helicopter Racing League (needs mechanic fit, not just copy)
- Phase 2 Security · Phase 3 Delivery/Ops · Phase 4 Incidents (see spec)

## Design language (decided — keep continuity)

**Direction: "Blueprint at night / drafting table."** The architect's own artifact is the
identity. Most of the UI is quiet graphite + ink; color appears only where it *means*
something. We avoid the AI-default "pure-black + one acid accent" look on purpose.

- **Ground (chrome):** deep blue-graphite ink — NOT pure black (`#000` is harsh + default).
- **Sheet (canvas):** subtly distinct dark with a low-opacity blueprint grid in azure.
- **Azure ink** = brand / interactive / live "served" trace / selection / focus.
- **Telemetry semantics:** healthy green → warn amber → hot orange → **redline red** (fail).
  Red = the architect's redline: the sim marks up your blueprint where it breaks.
- **Component accents:** keep the existing per-type hues — they're the colored-pencil legend.
- **Type:** IBM Plex Sans (body/UI) + IBM Plex Mono (wordmark, ranks, data, node summaries).
  Engineering pedigree; deliberately not the system-default Inter/Geist.
- **Signature element:** the load test as a *living blueprint stress test* — flow animates
  along drafted edges, components fill with capacity, saturated nodes get **redlined** with
  backpressure rippling upstream. Art direction + loop + teaching in one moment.

**Anti-slop guardrails:** one bold idea (the signature), everything else quiet. No rainbow
gradients, no glassmorphism everywhere, no neon glow spam, no confetti. Restraint > decoration.
Respect reduced-motion. Keyboard focus visible.

---

## ▶ NOW: Vertical slice — SHIPPED ✅ (needs your eyes on localhost:3000)

- [x] **Art direction foundation**
  - [x] Retoken `index.css`: blue-graphite ground, azure ink, refined neutrals (killed pure `#000`)
  - [x] Load IBM Plex Sans + Mono; mono for wordmark / ranks / data / node summaries
  - [x] Blueprint grid on the canvas (fine + coarse layers) + on the home hero
  - [~] HUD consistency pass (mono labels, unified azure signal). Full re-dock into one
        composed panel → still TODO (left as 4 floating instruments for now)
- [x] **Voiced briefing + reactive copy**
  - [x] Recurring `cast` + message `thread` + `winLine`/`lossLine` model (`challenges.ts`)
  - [x] `Briefing` = message thread (voice) + scannable objective card + opt-in hint
  - [x] Reactive win/loss lines from the character (`LevelComplete` / `GameOver`)
  - [x] Rewrote all 8 levels: Dana (eng lead, Ch.1) + Priya (co-founder, Ch.2)
- [x] **Live canvas drama**
  - [x] Animated azure request flow on edges during live
  - [x] Nodes stress → **redline** (shake + red hatch) at fail; pulse when hot/warn
  - [x] Backpressure: edges into a saturating node turn red
  - [ ] Refine: flow density/width ~ actual per-edge rps (currently uniform)
- [x] **Build-time capacity read (no live spoilers)**
  - [x] Static "cap ≈ X / peak Y" + azure headroom bar per node in build (design estimate)
  - [x] No health colors / bottleneck warnings pre-live; azure bar = plan, colored bar = live
  - [x] Removed the now-dead Preview slider (build = plan vs peak, Go Live = real profile)
- [x] Verified: `bunx tsc --noEmit` ✓, `bun run build` ✓, root + story assets 200 ✓,
      tokens/keyframes/utilities confirmed in the built CSS. (No browser tool here for a
      visual pass — needs a human look.)

---

## Backlog (after the slice)

### Run drama (deeper)
- [ ] One injected surprise per run (spike / capacity loss) the briefing hints at vaguely
- [ ] Make the run dramatic: latency ripple, "served vs offered" gap visualized on canvas
- [ ] Subtle, mutable sound: tick on place, rising hum live, thud on failure

### Run agency → **Live ops actions** (chosen direction)
- [ ] 2–3 reactive controls during live with cooldowns: emergency scale, shed load, failover
- [ ] Ops actions cost money/headroom — tradeoffs, not free saves
- [ ] Tie into incidents: the surprise is the prompt, the ops action is the response

### Loop depth / replay
- [ ] Real grade per run (S/A/B) from cost + latency *headroom*, not just pass/fail
- [ ] Par/3-star on every level (not only the finale); surface "your best" prominently
- [ ] Level modifiers tied to the vision: EU data residency (forces regional path), region down,
      banned component, frozen budget

### Voice / story (deeper)
- [ ] Cast continuity across a chapter; small arc beats on promotion
- [ ] Empty/idle/error states get the same voice (no dead dashboard text)

### Boards & modes
- [x] Dropped story mode → difficulty-sorted **scenario library** (easy → hard). No ranks,
      cast, threads, or career campaign. Each scenario is a standalone challenge.
- [x] Refactored the monolithic `challenges.ts` into `src/sim/scenarios/` — one file per
      scenario (`hotel`, `realtime`, `acme`) + `types.ts` + `index.ts` registry.
- [x] New scenario **Live Stream Chat** (medium): opens the real-time area — a `realtime`
      request class + WebSocket `realtime_gateway` (persistent connections / message fanout),
      separate from the request/response API tier. L1 add the gateway, L2 persist the firehose.
- [x] Added two more scenarios, each a new concept:
  - **Breaking News** (easy): CDN edge caching — fails on **p99 / latency** (a new axis;
    everything else fails on availability). Misses pay slow origin TTFB → raise edge hit ratio.
  - **ForYou Feed** (medium): **ML inference** — new `inference` class + GPU `inference_server`
    with a prediction-cache hit ratio. Brute-forcing GPUs blows the budget (verified: 50 GPUs
    still fails + costs 1.7× budget); caching predictions is the only way to fit.
- [ ] FOLLOW-UP: split the 1500-line `components.ts` too (core / dormant cloud / shared evals).
- [ ] FOLLOW-UP: working-set is a player-editable field on cache/redis/inference, so hit ratio
      is gameable (set working-set = 1). Make it a fixed workload property to close the exploit.
- [x] Story-mode starters retained as inherited boards, each missing the piece its level teaches.
- [x] Make the missing piece *mechanically* necessary. Engine now uses TYPED traffic
      (read/write/kv/media/search/event) with reachability routing: a class only flows
      toward a component that can serve it, and a class with no handler simply fails.
      Verified: ACME L2/L3/L4 starters fail at exactly 1−(missing class fraction) — adding
      the NoSQL/search/queue store is the fix. Caches/CDN must be wired in series to offload.
- [ ] Free-play mode (later): every scenario playable on demand, from scratch, outside story mode

### Provider modes (dormant — re-enable later)
- [ ] AWS / GCP / Multicloud catalogs are built but paused; revisit once Generic is great
