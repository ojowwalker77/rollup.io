import { Activity } from "lucide-react";
import { useStore } from "../store";

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-6 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}

export function MetricsPanel() {
  const d = useStore((s) => s.display);
  const runPhase = useStore((s) => s.runPhase);

  if (runPhase !== "live") return null;

  const err = d.errorRate;
  const avail = d.availability;

  return (
    <div className="absolute top-4 right-4 z-10 w-60 rounded-xl border border-border bg-card/90 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        <Activity className="size-3.5 text-primary" /> Live metrics
      </div>
      <Row label="Total RPS" value={Math.round(d.offeredRps).toLocaleString()} />
      <Row label="Avg latency" value={`${Math.round(d.avgMs)}ms`} />
      <Row label="p95 / p99" value={`${Math.round(d.p95Ms)} / ${Math.round(d.p99Ms)}ms`} tone={d.p99Ms > 150 ? "warn" : "ok"} />
      <Row label="Error rate" value={`${(err * 100).toFixed(1)}%`} tone={err > 0.05 ? "bad" : err > 0.01 ? "warn" : "ok"} />
      <Row label="Availability" value={`${(avail * 100).toFixed(1)}%`} tone={avail < 0.95 ? "bad" : avail < 0.99 ? "warn" : "ok"} />
      <Row label="Active / failing" value={`${d.activeNodes} / ${d.failingNodes}`} tone={d.failingNodes > 0 ? "bad" : "ok"} />
      <Row label="Cost / mo" value={`$${Math.round(d.totalCostUsd).toLocaleString()}`} />
    </div>
  );
}
