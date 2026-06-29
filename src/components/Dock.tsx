import { Activity, EyeOff, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { goalsFromSla } from "../sim/scenarios";
import { OBS_COST, useStore, type TimePoint } from "../store";

const usd = (n: number) => (n === Infinity ? "∞" : `$${Math.round(n).toLocaleString()}`);

const OBS_OPTIONS = [
  { id: "none", label: "Off", note: "blind" },
  { id: "basic", label: "Metrics", note: `+${usd(OBS_COST.basic)}/mo` },
  { id: "full", label: "Full", note: `+${usd(OBS_COST.full)}/mo` },
] as const;

/** Tiny served-vs-offered sparkline (full telemetry only). */
function Spark({ history, peak }: { history: TimePoint[]; peak: number }) {
  if (history.length < 2) return <div className="h-9 w-28" />;
  const W = 112;
  const H = 36;
  const xs = (t: number) => t * W;
  const ys = (v: number) => H - (Math.min(v, peak) / peak) * H;
  const line = (acc: (p: TimePoint) => number) => history.map((p) => `${xs(p.t).toFixed(1)},${ys(acc(p)).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} className="block" preserveAspectRatio="none">
      <polyline fill="none" stroke="#64748b" strokeOpacity="0.5" strokeWidth="1.5" points={line((p) => p.offered)} />
      <polyline fill="none" stroke="var(--signal)" strokeWidth="2" points={line((p) => p.served)} />
    </svg>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-foreground";
  return (
    <div className="leading-tight">
      <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("font-mono text-sm font-semibold", color)}>{value}</div>
    </div>
  );
}

export function Dock() {
  const scenario = useStore((s) => s.scenario);
  const levelIndex = useStore((s) => s.levelIndex);
  const runPhase = useStore((s) => s.runPhase);
  const clock = useStore((s) => s.clock);
  const reputation = useStore((s) => s.reputation);
  const history = useStore((s) => s.history);
  const d = useStore((s) => s.display);
  const designCost = useStore((s) => s.result.metrics.totalCostUsd);
  const obs = useStore((s) => s.observability);
  const goLive = useStore((s) => s.goLive);
  const setObservability = useStore((s) => s.setObservability);

  const level = scenario.levels[levelIndex]!;
  const goals = goalsFromSla(level);
  const cost = designCost + OBS_COST[obs];
  const overBudget = cost > level.budgetUsd;

  // ---------------------------------------------------------------- BUILD
  if (runPhase === "build") {
    return (
      <div className="flex shrink-0 items-center gap-6 border-t border-border bg-card/40 px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">Targets</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
            {goals.map((g) => (
              <span key={g.id} className="text-muted-foreground">
                {g.label} <span className="text-foreground">{g.target}</span>
              </span>
            ))}
            <span className="text-muted-foreground">
              Budget{" "}
              <span className={overBudget ? "text-red-400" : "text-foreground"}>
                {usd(cost)}
                <span className="text-muted-foreground"> / {usd(level.budgetUsd)}</span>
              </span>
            </span>
          </div>
        </div>

        {/* Provision monitoring before the run — it's what you'll see when it breaks. */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            <Activity className="size-3" /> Monitoring
          </div>
          <div className="mt-1 flex overflow-hidden rounded-md border border-border">
            {OBS_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => setObservability(o.id)}
                className={cn(
                  "px-2.5 py-1 text-left transition-colors",
                  obs === o.id ? "bg-primary text-primary-foreground" : "bg-background/40 hover:bg-accent",
                )}
              >
                <span className="block text-xs font-medium leading-none">{o.label}</span>
                <span className={cn("block font-mono text-[9px] leading-none mt-0.5", obs === o.id ? "text-primary-foreground/80" : "text-muted-foreground")}>{o.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">test under live traffic</span>
          <Button onClick={goLive} className="w-32">
            <Play className="size-3.5 fill-current" />
            Go Live
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- RUN
  const repColor = reputation > 60 ? "#10b981" : reputation > 30 ? "#f59e0b" : "#ef4444";
  const instrumented = obs !== "none";

  return (
    <div className="flex shrink-0 items-center gap-6 border-t border-border bg-card/40 px-4 py-3">
      {/* LIVE + window progress (always visible) */}
      <div className="w-44 shrink-0">
        <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-red-500">
          <span className="size-2 animate-pulse rounded-full bg-red-500" /> LIVE
          <span className="ml-auto text-muted-foreground">{Math.round(clock * 100)}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${clock * 100}%` }} />
        </div>
      </div>

      {/* Telemetry — gated by the monitoring you provisioned */}
      <div className="min-w-0 flex-1">
        {!instrumented ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <EyeOff className="size-4 shrink-0" />
            <span>No telemetry — you're flying blind. Provision monitoring next time to see inside.</span>
          </div>
        ) : (
          <div className="flex items-center gap-5">
            <Metric label="RPS" value={Math.round(d.offeredRps).toLocaleString()} />
            <Metric label="p99" value={`${Math.round(d.p99Ms)}ms`} tone={d.p99Ms > level.sla.p99Ms ? "warn" : "ok"} />
            <Metric label="errors" value={`${(d.errorRate * 100).toFixed(1)}%`} tone={d.errorRate > 0.05 ? "bad" : d.errorRate > 0.01 ? "warn" : "ok"} />
            <Metric label="avail" value={`${(d.availability * 100).toFixed(1)}%`} tone={d.availability < level.sla.availability ? "bad" : "ok"} />
            {obs === "full" && <Spark history={history} peak={level.clientRps * 1.05} />}
            {obs === "basic" && <span className="font-mono text-[10px] text-muted-foreground">metrics only — Full adds traces</span>}
          </div>
        )}
      </div>

      {/* Customers / reputation — the business outcome, always visible */}
      <div className="w-44 shrink-0">
        <div className="flex items-center justify-between font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          <span>Customers</span>
          <span style={{ color: repColor }}>{Math.round(reputation)}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full transition-all" style={{ width: `${reputation}%`, background: repColor }} />
        </div>
      </div>
    </div>
  );
}
