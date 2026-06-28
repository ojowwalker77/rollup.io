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
import { useStore } from "../store";

const usd = (n: number) => (n === Infinity ? "∞" : `$${Math.round(n).toLocaleString()}`);

export function GameOver() {
  const runPhase = useStore((s) => s.runPhase);
  const backToBuild = useStore((s) => s.backToBuild);
  const reputation = useStore((s) => s.reputation);
  const cost = useStore((s) => s.result.metrics.totalCostUsd);
  const scenario = useStore((s) => s.scenario);
  const levelIndex = useStore((s) => s.levelIndex);
  const level = scenario.levels[levelIndex]!;

  const lostCustomers = reputation <= 0;

  return (
    <Dialog open={runPhase === "lost"} onOpenChange={(o) => !o && backToBuild()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-red-400">
            <TriangleAlert className="size-5" />
            <DialogTitle className="text-xl">{lostCustomers ? "Customers walked out" : "Over budget"}</DialogTitle>
          </div>
          <DialogDescription>
            {lostCustomers
              ? "Errors and slow pages drained your customers to zero before the window ended."
              : "You held the SLA, but the design blew past the monthly budget."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 rounded-lg border border-border bg-background/50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Customers left</span>
            <span className="font-mono">{Math.round(reputation)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Monthly cost</span>
            <span className="font-mono">
              {usd(cost)}
              {level.budgetUsd !== Infinity && <span className={cost > level.budgetUsd ? "text-red-400" : "text-muted-foreground"}> / {usd(level.budgetUsd)}</span>}
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
