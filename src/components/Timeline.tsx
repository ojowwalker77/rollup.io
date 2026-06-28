import { useStore, type TimePoint } from "../store";

export function Timeline() {
  const history = useStore((s) => s.history);
  const runPhase = useStore((s) => s.runPhase);
  const reputation = useStore((s) => s.reputation);
  const clock = useStore((s) => s.clock);
  const scenario = useStore((s) => s.scenario);
  const levelIndex = useStore((s) => s.levelIndex);
  const level = scenario.levels[levelIndex]!;

  if (runPhase === "build" || history.length === 0) return null;

  const W = 440;
  const H = 92;
  const pad = 4;
  const peak = level.clientRps * 1.05;
  const xs = (t: number) => pad + t * (W - 2 * pad);
  const ys = (v: number) => H - pad - (Math.min(v, peak) / peak) * (H - 2 * pad);
  const path = (acc: (p: TimePoint) => number) =>
    history.map((p) => `${xs(p.t).toFixed(1)},${ys(acc(p)).toFixed(1)}`).join(" ");

  const repColor = reputation > 60 ? "#10b981" : reputation > 30 ? "#f59e0b" : "#ef4444";

  return (
    <div className="absolute bottom-4 left-1/2 z-10 w-[460px] -translate-x-1/2 rounded-xl border border-border bg-card/90 p-3 shadow-2xl backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          {level.windowLabel} · requests/sec
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{Math.round(clock * 100)}%</span>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block" preserveAspectRatio="none">
        <polyline fill="none" stroke="#64748b" strokeOpacity="0.5" strokeWidth="1.5" points={path((p) => p.offered)} />
        <polyline fill="none" stroke="var(--signal)" strokeWidth="2" points={path((p) => p.served)} />
        {runPhase === "live" && (
          <line x1={xs(clock)} y1={pad} x2={xs(clock)} y2={H - pad} stroke="#94a3b8" strokeOpacity="0.35" />
        )}
      </svg>

      <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3" style={{ background: "var(--signal)" }} /> served
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3" style={{ background: "#64748b" }} /> offered
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Customers</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full transition-all" style={{ width: `${reputation}%`, background: repColor }} />
        </div>
        <span className="w-9 text-right font-mono text-[11px]" style={{ color: repColor }}>
          {Math.round(reputation)}%
        </span>
      </div>
    </div>
  );
}
