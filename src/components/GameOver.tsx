import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { specOf } from "../sim/components";
import { diagnoseLoss, type ObsLevel } from "../sim/diagnose";
import { useStore } from "../store";

const usd = (n: number) => (n === Infinity ? "∞" : `$${Math.round(n).toLocaleString()}`);

export function GameOver() {
  const runPhase = useStore((s) => s.runPhase);
  const backToBuild = useStore((s) => s.backToBuild);
  const reputation = useStore((s) => s.reputation);
  const result = useStore((s) => s.result);
  const scenario = useStore((s) => s.scenario);
  const levelIndex = useStore((s) => s.levelIndex);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const level = scenario.levels[levelIndex]!;

  // How much you can SEE depends on the observability you wired (and connected).
  // The tutorial always shows the full cause — it's teaching the basics, not MTTR.
  const monitor = nodes.find((n) => specOf(n.data.type).category === "observability");
  const connected = monitor && edges.some((e) => e.source === monitor.id || e.target === monitor.id);
  const obs: ObsLevel =
    scenario.id === "hotel-booking"
      ? "full"
      : monitor && connected
        ? String(monitor.data.config.coverage) === "basic"
          ? "basic"
          : "full"
        : "none";

  const lostCustomers = reputation <= 0;
  const cost = result.metrics.totalCostUsd;
  const diag = diagnoseLoss(level, result, lostCustomers, obs);

  return (
    <Dialog open={runPhase === "lost"} onOpenChange={(o) => !o && backToBuild()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-red-400">
            <TriangleAlert className="size-5" />
            <DialogTitle className="text-xl">{diag.headline}</DialogTitle>
          </div>
          <DialogDescription>
            {lostCustomers
              ? "Customers drained to zero before the window ended. Here's what gave out:"
              : "You survived the window, but the bill didn't."}
          </DialogDescription>
        </DialogHeader>

        {/* What actually broke — read from the simulation, not a canned line. */}
        <ul className="space-y-1.5">
          {diag.points.map((p, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-400/70" />
              <span className="text-foreground/90">{p}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5 rounded-lg border border-border bg-background/50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Availability</span>
            <span className={`font-mono ${result.metrics.availability < level.sla.availability ? "text-red-400" : ""}`}>
              {(result.metrics.availability * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">p99 latency</span>
            <span className={`font-mono ${result.metrics.p99Ms > level.sla.p99Ms ? "text-red-400" : ""}`}>
              {Math.round(result.metrics.p99Ms)} ms
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Monthly cost</span>
            <span className="font-mono">
              {usd(cost)}
              {level.budgetUsd !== Infinity && (
                <span className={cost > level.budgetUsd ? "text-red-400" : "text-muted-foreground"}> / {usd(level.budgetUsd)}</span>
              )}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={backToBuild}>
            <RotateCcw className="size-3.5" />
            Back to the drawing board
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
