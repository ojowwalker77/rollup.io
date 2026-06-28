import { AlertTriangle, ArrowRight, Link2Off, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { specOf } from "../sim/components";
import type { ConfigField } from "../sim/types";
import { useStore } from "../store";
import { ComponentIcon } from "./component-icons";

function fmtRps(n: number): string {
  if (!isFinite(n)) return "∞";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Math.round(n).toString();
}

function Field({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  const isPercent = field.type === "slider" && (field.max ?? 1) <= 1;
  const display =
    field.type === "slider"
      ? isPercent
        ? `${Math.round(Number(value) * 100)}%`
        : `${value}${field.unit ? ` ${field.unit}` : ""}`
      : null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <Label className="text-[13px]">{field.label}</Label>
        {field.type === "slider" && <span className="font-mono text-xs text-foreground/80">{display}</span>}
        {field.type === "number" && field.unit && (
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{field.unit}</span>
        )}
      </div>

      {field.type === "number" && (
        <Input
          type="number"
          value={value as number}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="mt-1.5 h-8 font-mono"
        />
      )}

      {field.type === "slider" && (
        <Slider
          className="mt-3"
          value={[Number(value)]}
          min={field.min}
          max={field.max}
          step={field.step}
          onValueChange={([v]) => onChange(v ?? 0)}
        />
      )}

      {field.type === "select" && (
        <Select value={value as string} onValueChange={onChange}>
          <SelectTrigger className="mt-1.5 h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.help && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{field.help}</p>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-foreground";
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export function ConfigPanel() {
  const selectedId = useStore((s) => s.selectedId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const node = useStore((s) => s.nodes.find((n) => n.id === s.selectedId));
  const edge = useStore((s) => s.edges.find((e) => e.id === s.selectedEdgeId));
  const sourceNode = useStore((s) => s.nodes.find((n) => n.id === edge?.source));
  const targetNode = useStore((s) => s.nodes.find((n) => n.id === edge?.target));
  const r = useStore((s) => (s.selectedId ? s.result.nodes[s.selectedId] : undefined));
  const runPhase = useStore((s) => s.runPhase);
  const updateConfig = useStore((s) => s.updateConfig);
  const deleteNode = useStore((s) => s.deleteNode);
  const deleteEdge = useStore((s) => s.deleteEdge);

  if (selectedEdgeId && edge) {
    return (
      <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card/30">
        <div className="border-b border-border p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-red-400">
              <Link2Off className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Connection</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Selected dependency path</p>
            </div>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-5">
          <div className="flex w-full items-center justify-between rounded-lg border border-border bg-card p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{sourceNode ? specOf(sourceNode.data.type).label : edge.source}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">source</div>
            </div>
            <ArrowRight className="mx-3 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 text-right">
              <div className="truncate text-sm font-medium">{targetNode ? specOf(targetNode.data.type).label : edge.target}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">dependency</div>
            </div>
          </div>
        </div>

        <div className="border-t border-border p-3">
          <Button
            variant="outline"
            className="w-full text-destructive hover:text-destructive"
            disabled={runPhase === "live"}
            onClick={() => deleteEdge(edge.id)}
          >
            <Link2Off className="size-3.5" />
            Delete connection
          </Button>
        </div>
      </aside>
    );
  }

  if (!selectedId || !node) {
    return (
      <aside className="flex w-80 shrink-0 flex-col items-center justify-center border-l border-border bg-card/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">Select a component to tune it.</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Each component exposes the levers that actually govern it — not a generic replica count.
        </p>
      </aside>
    );
  }

  const spec = specOf(node.data.type);
  const loaded = (r?.input.rps ?? 0) > 0.01;
  const showLiveStats = runPhase !== "build" && loaded;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card/30">
      <div className="flex items-start gap-2.5 border-b border-border p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md" style={{ background: `${spec.accent}1f` }}>
          <ComponentIcon type={node.data.type} className="size-4" style={{ color: spec.accent }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{spec.label}</h2>
            {spec.category !== "source" && r && (
              <span className="font-mono text-xs text-muted-foreground">${Math.round(r.costUsd).toLocaleString()}/mo</span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{spec.blurb}</p>
        </div>
      </div>

      {showLiveStats && r && (
        <div className="grid grid-cols-2 gap-px border-b border-border bg-border">
          <Stat label="Load" value={`${fmtRps(r.input.rps)} rps`} />
          <Stat label="Capacity" value={`${fmtRps(r.capacity)} rps`} />
          <Stat
            label="Utilization"
            value={`${Math.round(r.utilization * 100)}%`}
            tone={r.utilization >= 1 ? "bad" : r.utilization >= 0.9 ? "warn" : "ok"}
          />
          <Stat label="Latency" value={`${Math.round(r.serviceMs)} ms`} />
        </div>
      )}

      {showLiveStats && r?.bottleneck && (
        <div className="flex items-start gap-2 border-b border-border bg-red-500/10 px-4 py-2.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-red-400 uppercase">Bottleneck</p>
            <p className="mt-0.5 text-xs text-red-200">{r.bottleneck}</p>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="divide-y divide-border">
          {spec.fields.map((f) => (
            <Field
              key={f.key}
              field={f}
              value={node.data.config[f.key] ?? ""}
              onChange={(v) => updateConfig(node.id, f.key, v)}
            />
          ))}
        </div>
      </ScrollArea>

      {spec.category !== "source" && (
        <div className="border-t border-border p-3">
          <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => deleteNode(node.id)}>
            <Trash2 className="size-3.5" />
            Delete component
          </Button>
        </div>
      )}
    </aside>
  );
}
