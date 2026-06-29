import { ArrowRight, BookOpen, Grid2X2, Moon, Network, RotateCcw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OBS_COST, useStore } from "../store";

function usd(n: number): string {
  return n === Infinity ? "∞" : `$${Math.round(n).toLocaleString()}`;
}

export function Header() {
  const scenario = useStore((s) => s.scenario);
  const levelIndex = useStore((s) => s.levelIndex);
  const cost = useStore((s) => s.result.metrics.totalCostUsd + OBS_COST[s.observability]);
  const runPhase = useStore((s) => s.runPhase);
  const bestCost = useStore((s) => s.bestCost);
  const setBriefing = useStore((s) => s.setBriefing);
  const resetLevel = useStore((s) => s.resetLevel);
  const nextLevel = useStore((s) => s.nextLevel);
  const goHome = useStore((s) => s.goHome);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  const level = scenario.levels[levelIndex]!;
  const overBudget = cost > level.budgetUsd;
  const passed = bestCost[level.id] !== undefined;
  const canAdvance = passed && runPhase === "build" && levelIndex + 1 < scenario.levels.length;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/40 px-4">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Network className="size-4" />
        </div>
        <div>
          <h1 className="font-mono text-sm font-semibold leading-none tracking-tight">
            rollup<span className="text-primary">.io</span>
          </h1>
          <p className="mt-1 font-mono text-[11px] leading-none text-muted-foreground">
            {scenario.title} · L{levelIndex + 1} {level.name}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-1.5">
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Budget</span>
          <span className={cn("font-mono text-sm font-semibold", overBudget ? "text-red-400" : "text-foreground")}>
            {usd(cost)} <span className="font-normal text-muted-foreground">/ {usd(level.budgetUsd)}</span>
          </span>
        </div>

        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={goHome} disabled={runPhase === "live"}>
          <Grid2X2 className="size-3.5" />
          Scenarios
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetLevel} disabled={runPhase === "live"}>
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
        <Button variant="outline" size="sm" onClick={() => setBriefing(true)}>
          <BookOpen className="size-3.5" />
          Briefing
        </Button>
        {canAdvance && (
          <Button size="sm" onClick={nextLevel}>
            Next level
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </div>
    </header>
  );
}
