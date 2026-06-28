# rollup.io — game feel roadmap

North star: a *systems-design* game, not "drag AWS icons until green." Real primitives,
real tradeoffs, real tension. Clean & classy, never slopified.

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

### Provider modes (dormant — re-enable later)
- [ ] AWS / GCP / Multicloud catalogs are built but paused; revisit once Generic is great
