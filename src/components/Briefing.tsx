import { ArrowRight, GraduationCap, Lightbulb, Target, Wallet } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { goalsFromSla } from "../sim/scenarios";
import { useStore } from "../store";

const DIFF: Record<string, string> = {
  easy: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  hard: "border-red-500/40 bg-red-500/10 text-red-400",
};

const usd = (n: number) => (n === Infinity ? "∞ (cost is your score)" : `$${Math.round(n).toLocaleString()}/mo`);

export function Briefing() {
  const open = useStore((s) => s.briefingOpen);
  const setBriefing = useStore((s) => s.setBriefing);
  const scenario = useStore((s) => s.scenario);
  const levelIndex = useStore((s) => s.levelIndex);
  const level = scenario.levels[levelIndex]!;
  const [hintOpen, setHintOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setBriefing}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <DialogHeader className="space-y-2.5 border-b border-border px-5 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`font-mono uppercase ${DIFF[scenario.difficulty]}`}>
              {scenario.difficulty}
            </Badge>
            <Badge variant="secondary" className="font-mono">
              {scenario.title}
            </Badge>
            <Badge variant="outline" className="font-mono">
              Level {levelIndex + 1}/{scenario.levels.length}
            </Badge>
          </div>
          <DialogTitle className="text-2xl">{level.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <section className="flex gap-2.5">
            <Target className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">The job</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{level.brief}</p>
            </div>
          </section>

          <section className="flex gap-2.5">
            <GraduationCap className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Teaches</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(level.concepts ?? []).map((concept) => (
                  <Badge key={concept} variant="secondary" className="font-normal">
                    {concept}
                  </Badge>
                ))}
              </div>
            </div>
          </section>

          <section className="flex gap-2.5">
            <Wallet className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Brief</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Peak load <span className="font-mono text-foreground">{level.clientRps.toLocaleString()} rps</span> ·{" "}
                <span className="font-mono text-foreground">{Math.round(level.clientWriteRatio * 100)}%</span> writes ·
                budget <span className="font-mono text-foreground">{usd(level.budgetUsd)}</span>
              </p>
              <div className="mt-2 space-y-1">
                {goalsFromSla(level).map((g) => (
                  <div key={g.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{g.label}</span>
                    <span className="font-mono">{g.target}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Monthly cost</span>
                  <span className="font-mono">
                    {level.budgetUsd === Infinity ? "as low as possible" : `≤ $${level.budgetUsd.toLocaleString()}/mo`}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <div>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-7 text-muted-foreground"
              onClick={() => setHintOpen((v) => !v)}
            >
              <Lightbulb className="size-3.5" />
              {hintOpen ? "Hide hint" : "Stuck? Get a hint"}
            </Button>
            {hintOpen && (
              <p className="mt-1 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                {level.hint}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button onClick={() => setBriefing(false)} className="w-full sm:w-auto">
            Start building
            <ArrowRight className="size-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
