import { BookOpen, Check, CircleDashed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { goalsFromSla } from "../sim/scenarios";
import { useStore } from "../store";

const usd = (n: number) => (n === Infinity ? "∞" : `$${Math.round(n).toLocaleString()}`);

function GoalRow({ ok, evaluated, label, target, actual }: {
  ok: boolean;
  evaluated: boolean;
  label: string;
  target: string;
  actual?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full",
            !evaluated ? "bg-muted text-muted-foreground" : ok ? "bg-emerald-500 text-white" : "bg-red-500 text-white",
          )}
        >
          {!evaluated ? <CircleDashed className="size-2.5" /> : ok ? <Check className="size-2.5" /> : <X className="size-2.5" />}
        </span>
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-right font-mono text-xs">
        <span className="text-muted-foreground">{target}</span>
        {evaluated && actual && <span className={cn("ml-2", ok ? "text-emerald-400" : "text-red-400")}>{actual}</span>}
      </div>
    </div>
  );
}

export function ChallengePanel() {
  const scenario = useStore((s) => s.scenario);
  const levelIndex = useStore((s) => s.levelIndex);
  const m = useStore((s) => s.result.metrics);
  const runPhase = useStore((s) => s.runPhase);
  const setBriefing = useStore((s) => s.setBriefing);
  const level = scenario.levels[levelIndex]!;
  const goals = goalsFromSla(level);

  const live = runPhase === "live" && m.offeredRps > 1;
  const withinBudget = m.totalCostUsd <= level.budgetUsd;

  return (
    <div className="absolute top-4 left-4 z-10 w-72 rounded-xl border border-border bg-card/90 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">Objectives</span>
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setBriefing(true)}>
          <BookOpen className="size-3" />
          Briefing
        </Button>
      </div>

      <div className="space-y-2 p-3">
        {goals.map((g) => (
          <GoalRow key={g.id} evaluated={live} ok={live && g.ok(m)} label={g.label} target={g.target} actual={g.actual(m)} />
        ))}
        {/* Budget is design-based, so it's always evaluable. */}
        <GoalRow
          evaluated
          ok={withinBudget}
          label="Monthly cost"
          target={level.budgetUsd === Infinity ? "minimize" : `≤ ${usd(level.budgetUsd)}`}
          actual={usd(m.totalCostUsd)}
        />

        {runPhase === "build" && (
          <p className="pt-1 text-center text-[11px] text-muted-foreground">Go Live to run the {level.windowLabel.toLowerCase()}.</p>
        )}
      </div>
    </div>
  );
}
