import { ArrowRight, RotateCcw, Star, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Level } from "../sim/challenges";
import { useStore } from "../store";

const usd = (n: number) => (n === Infinity ? "∞" : `$${Math.round(n).toLocaleString()}`);

function starCount(level: Level, cost: number): number {
  if (level.budgetUsd === Infinity) {
    const par = level.parCostUsd ?? cost;
    const r = cost / par;
    return r <= 1 ? 3 : r <= 1.3 ? 2 : 1;
  }
  const r = cost / level.budgetUsd;
  return r <= 0.6 ? 3 : r <= 0.8 ? 2 : 1;
}

export function LevelComplete() {
  const runPhase = useStore((s) => s.runPhase);
  const backToBuild = useStore((s) => s.backToBuild);
  const nextLevel = useStore((s) => s.nextLevel);
  const challenge = useStore((s) => s.challenge);
  const levelIndex = useStore((s) => s.levelIndex);
  const cost = useStore((s) => s.result.metrics.totalCostUsd);
  const best = useStore((s) => s.bestCost);
  const level = challenge.levels[levelIndex]!;

  const stars = starCount(level, cost);
  const isLast = levelIndex + 1 >= challenge.levels.length;
  const bestCost = best[level.id];

  return (
    <Dialog open={runPhase === "won"} onOpenChange={(o) => !o && backToBuild()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-emerald-400">
            <Trophy className="size-5" />
            <DialogTitle className="text-xl">Level cleared</DialogTitle>
          </div>
          <div className="pt-1">
            <Badge variant="outline" className="font-mono">{level.rank}</Badge>
          </div>
          <DialogDescription>
            {level.name} held through {level.windowLabel.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center gap-2 py-1">
          {[0, 1, 2].map((i) => (
            <Star key={i} className={cn("size-9", i < stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/25")} />
          ))}
        </div>

        {/* The lead reacts in their own voice. */}
        <div className="flex items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-semibold text-primary-foreground">
            {challenge.cast.name.charAt(0)}
          </span>
          <p className="w-fit max-w-[88%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-sm leading-relaxed text-foreground/90">
            {level.winLine}
          </p>
        </div>

        <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm leading-relaxed text-emerald-700 dark:text-emerald-100">
          {level.reward}
        </p>

        <div className="space-y-1.5 rounded-lg border border-border bg-background/50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Monthly cost</span>
            <span className="font-mono">
              {usd(cost)}
              {level.budgetUsd !== Infinity && <span className="text-muted-foreground"> / {usd(level.budgetUsd)}</span>}
            </span>
          </div>
          {bestCost !== undefined && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Your best</span>
              <span className="font-mono text-emerald-400">{usd(bestCost)}</span>
            </div>
          )}
          {isLast && level.budgetUsd === Infinity && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Par (3★)</span>
              <span className="font-mono">{usd(level.parCostUsd ?? 0)}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={backToBuild}>
            <RotateCcw className="size-3.5" />
            Keep tuning
          </Button>
          {!isLast ? (
            <Button onClick={nextLevel}>
              Next level
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button onClick={backToBuild}>Finish</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
