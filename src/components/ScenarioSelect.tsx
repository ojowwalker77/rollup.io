import { ArrowRight, Moon, Network, Play, Star, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CHALLENGES, type Challenge } from "../sim/challenges";
import { useStore } from "../store";

const ICONS: Record<string, typeof Network> = {
  "hotel-booking": Network,
  "acme-music": Network,
};

function completedLevels(challenge: Challenge, bestCost: Record<string, number>): number {
  return challenge.levels.filter((level) => bestCost[level.id] !== undefined).length;
}

export function ScenarioSelect() {
  const selectChallenge = useStore((s) => s.selectChallenge);
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
            Career campaign
          </p>
          <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Draw the system.
            <br />
            Then watch it survive real traffic.
          </h2>
          <p className="mt-4 max-w-2xl text-pretty text-[15px] leading-7 text-muted-foreground">
            Start as an intern architect and work your way up. Each level hands you a real load, a real budget,
            and the same lesson every senior engineer learns the hard way — under pressure.
          </p>
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          {CHALLENGES.map((challenge) => {
            const Icon = ICONS[challenge.id] ?? Network;
            const completed = completedLevels(challenge, bestCost);
            const firstRank = challenge.levels[0]?.rank ?? challenge.role;
            const finalRank = challenge.levels.at(-1)?.rank ?? challenge.role;
            const isTutorial = challenge.id === "hotel-booking";

            return (
              <article
                key={challenge.id}
                className="group flex min-h-[520px] flex-col overflow-hidden rounded-lg bg-card shadow-[0_16px_50px_oklch(0_0_0/0.25)] outline outline-1 outline-border transition-colors hover:outline-primary/40"
              >
                <div className="relative aspect-[16/8] overflow-hidden bg-muted">
                  <img
                    src={challenge.asset}
                    alt=""
                    className="h-full w-full object-cover outline outline-1 outline-white/10 transition-transform duration-300 group-hover:scale-[1.02]"
                    draggable={false}
                  />
                  <div className="absolute top-3 left-3 flex items-center gap-2">
                    <Badge className="bg-background/90 font-mono text-foreground shadow-sm backdrop-blur">
                      {challenge.chapter}
                    </Badge>
                    {isTutorial && (
                      <Badge variant="secondary" className="gap-1 bg-background/90 font-mono shadow-sm backdrop-blur">
                        <Star className="size-3" />
                        Tutorial
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icon className="size-4" />
                        </span>
                        <div>
                          <h3 className="text-xl font-semibold leading-tight">{challenge.title}</h3>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">{firstRank} → {finalRank}</p>
                        </div>
                      </div>
                      <p className="mt-4 text-pretty text-sm leading-6 text-muted-foreground">{challenge.intro}</p>
                    </div>
                    <Badge variant="outline" className="font-mono capitalize">
                      {challenge.difficulty}
                    </Badge>
                  </div>

                  <div className="mt-5 space-y-2">
                    {challenge.levels.map((level, levelIndex) => {
                      const cleared = bestCost[level.id] !== undefined;
                      return (
                        <div key={level.id} className="flex items-center gap-3 rounded-md bg-background/55 px-3 py-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-semibold text-muted-foreground">
                            {levelIndex + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{level.name}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{level.rank}</p>
                          </div>
                          {cleared && <Star className="size-4 fill-amber-400 text-amber-400" />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                    <div className="font-mono text-xs text-muted-foreground">
                      <span className="text-foreground">{completed}/{challenge.levels.length}</span> cleared
                      <span className="mx-1.5 text-muted-foreground/40">·</span>
                      briefed by {challenge.cast.name}
                    </div>
                    <Button
                      onClick={() => selectChallenge(challenge.id)}
                      className="min-h-10 gap-2 transition-transform active:scale-[0.96]"
                    >
                      {completed > 0 ? "Continue" : "Start"}
                      {completed > 0 ? <ArrowRight className="size-4" /> : <Play className="size-4 fill-current" />}
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
