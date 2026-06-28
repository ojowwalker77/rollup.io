import { ArrowRight, Moon, Network, Newspaper, Play, Radio, Sparkles, Star, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SCENARIOS, type Scenario } from "../sim/scenarios";
import { useStore } from "../store";

const ICONS: Record<string, typeof Network> = {
  "hotel-booking": Network,
  "breaking-news": Newspaper,
  "live-chat": Radio,
  "foryou-feed": Sparkles,
  "acme-music": Play,
};

const DIFF: Record<string, string> = {
  easy: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  hard: "border-red-500/40 bg-red-500/10 text-red-400",
};

function clearedCount(scenario: Scenario, bestCost: Record<string, number>): number {
  return scenario.levels.filter((level) => bestCost[level.id] !== undefined).length;
}

export function ScenarioSelect() {
  const selectScenario = useStore((s) => s.selectScenario);
  const bestCost = useStore((s) => s.bestCost);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  const grid = theme === "dark" ? "oklch(0.72 0.13 243 / 0.04)" : "oklch(0.5 0.12 243 / 0.07)";

  return (
    <div
      className="min-h-screen bg-background text-foreground antialiased"
      style={{
        backgroundImage: `linear-gradient(${grid} 1px, transparent 1px), linear-gradient(90deg, ${grid} 1px, transparent 1px)`,
        backgroundSize: "26px 26px",
      }}
    >
      <header className="flex h-16 items-center justify-between border-b border-border bg-card/55 px-5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <Network className="size-4" />
          </div>
          <div>
            <h1 className="font-mono text-sm font-semibold leading-none tracking-tight">
              rollup<span className="text-primary">.io</span>
            </h1>
            <p className="mt-1 font-mono text-[11px] leading-none text-muted-foreground">systems design, under load</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 lg:py-14">
        <section className="max-w-3xl">
          <p className="mb-3 font-mono text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
            Scenario library
          </p>
          <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Pick a system. Make it hold.
          </h2>
          <p className="mt-4 max-w-2xl text-pretty text-[15px] leading-7 text-muted-foreground">
            Each scenario is a real architecture under real load, on a budget. Design it, run the traffic,
            and watch where it breaks. Sorted easy to hard — start wherever you like.
          </p>
        </section>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.map((scenario) => {
            const Icon = ICONS[scenario.id] ?? Network;
            const cleared = clearedCount(scenario, bestCost);
            const started = cleared > 0;

            return (
              <article
                key={scenario.id}
                className="group flex flex-col overflow-hidden rounded-lg bg-card shadow-[0_16px_50px_oklch(0_0_0/0.25)] outline outline-1 outline-border transition-colors hover:outline-primary/40"
              >
                <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                  {scenario.art && (
                    <img
                      src={scenario.art}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      draggable={false}
                    />
                  )}
                  <Badge
                    variant="outline"
                    className={`absolute top-3 left-3 font-mono uppercase backdrop-blur ${DIFF[scenario.difficulty]}`}
                  >
                    {scenario.difficulty}
                  </Badge>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <h3 className="text-lg font-semibold leading-tight">{scenario.title}</h3>
                  </div>

                  <p className="mt-3 text-pretty text-sm leading-6 text-muted-foreground">{scenario.blurb}</p>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {scenario.teaches.map((t) => (
                      <Badge key={t} variant="secondary" className="font-normal">
                        {t}
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                    <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      {cleared === scenario.levels.length && cleared > 0 && (
                        <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      )}
                      <span className="text-foreground">{cleared}/{scenario.levels.length}</span> cleared
                    </div>
                    <Button
                      onClick={() => selectScenario(scenario.id)}
                      className="min-h-10 gap-2 transition-transform active:scale-[0.96]"
                    >
                      {started ? "Continue" : "Play"}
                      {started ? <ArrowRight className="size-4" /> : <Play className="size-4 fill-current" />}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
