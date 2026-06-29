import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { specOf } from "../sim/components";
import type { Health } from "../sim/types";
import { useStore, type SystemNodeData } from "../store";
import { ComponentIcon } from "./component-icons";

const HEALTH: Record<Health, { border: string; glow: string; text: string }> = {
  idle: { border: "#3f3f46", glow: "transparent", text: "#71717a" },
  healthy: { border: "#10b981", glow: "#10b98140", text: "#34d399" },
  warn: { border: "#f59e0b", glow: "#f59e0b40", text: "#fbbf24" },
  hot: { border: "#fb923c", glow: "#fb923c55", text: "#fdba74" },
  fail: { border: "#ef4444", glow: "#ef444480", text: "#f87171" },
};

const handleClass = "!h-2.5 !w-2.5 !border-2 !border-background !bg-muted-foreground";

function fmtRps(n: number): string {
  if (!isFinite(n) || n >= 1e8) return "∞";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return Math.round(n).toString();
}

/** The one config that defines this component — surfaced on the node face. */
function summary(type: string, c: Record<string, number | string>): string {
  switch (type) {
    case "client":
    case "web_client":
    case "mobile_client":
    case "partner_api":
      return `${Number(c.rps).toLocaleString()} rps · ${Math.round(Number(c.writeRatio) * 100)}% W`;
    case "app_server": {
      const flags: string[] = [];
      if (Number(c.queriesPerReq) > 1) flags.push("N+1");
      if (c.io === "blocking") flags.push("sync");
      return `${c.replicas}× · ${c.vcpus} vCPU${flags.length ? ` · ${flags.join(" ")}` : ""}`;
    }
    case "aws_ec2_asg":
    case "gcp_compute_mig":
      return `${c.instances} EC2 · ${c.vcpus} vCPU`;
    case "aws_ecs_fargate":
      return `${c.tasks} tasks · ${c.vcpus} vCPU`;
    case "aws_eks":
    case "gcp_gke":
      return `${c.pods} pods · ${c.vcpus} vCPU`;
    case "gcp_cloud_run":
      return `${c.instances} instances · ${c.maxConcurrency} conc`;
    case "aws_lambda":
      return `${Number(c.reservedConcurrency).toLocaleString()} conc · ${c.durationMs}ms`;
    case "gcp_cloud_functions":
      return `${Number(c.maxInstances).toLocaleString()} max · ${c.durationMs}ms`;
    case "api_gateway":
      return `${c.gateways} units · ${Number(c.maxRpsPerGateway).toLocaleString()} rps`;
    case "aws_api_gateway":
    case "aws_alb":
    case "aws_vpc_lattice":
    case "aws_route53":
    case "aws_waf":
    case "aws_amplify":
    case "aws_appsync":
    case "aws_cognito":
    case "aws_secrets_manager":
    case "aws_cloudwatch":
    case "gcp_cloud_load_balancing":
    case "gcp_api_gateway":
    case "gcp_cloud_monitoring":
    case "gcp_secret_manager":
      return `${Number(c.maxRps).toLocaleString()} rps`;
    case "sql":
    case "aws_rds":
    case "aws_aurora":
    case "gcp_cloud_sql":
      return `${c.tier} · ${c.readReplicas} replica${Number(c.readReplicas) === 1 ? "" : "s"}${c.indexed === "no" ? " · no index" : ""}`;
    case "cache":
    case "redis":
    case "aws_elasticache_redis":
    case "gcp_memorystore_redis": {
      const hit = Math.min(Number(c.memoryGB) / Math.max(Number(c.workingSetGB), 0.001), 0.99);
      return `${c.memoryGB}GB · ${Math.round(hit * 100)}% hit`;
    }
    case "nosql":
      return `${c.nodes} nodes · ${c.consistency}`;
    case "aws_dynamodb":
    case "gcp_firestore":
      return `${c.partitions} partitions · ${c.consistency}`;
    case "gcp_spanner":
      return `${c.nodes} nodes · ${c.consistency}`;
    case "object_store":
    case "aws_s3":
    case "gcp_cloud_storage":
      return `${c.firstByteMs}ms TTFB`;
    case "aws_efs":
      return `${Number(c.maxRps).toLocaleString()} ops/s`;
    case "cdn": {
      const hit = Math.min(Number(c.edgeTb) / Math.max(Number(c.catalogTb), 0.001), 0.995);
      return `${c.edgeTb}TB · ${Math.round(hit * 100)}% edge`;
    }
    case "aws_cloudfront":
    case "gcp_cloud_cdn": {
      const hit = Math.min(Number(c.edgeTb) / Math.max(Number(c.catalogTb), 0.001), 0.995);
      return `${c.edgeTb}TB · ${Math.round(hit * 100)}% edge`;
    }
    case "search_index":
    case "aws_opensearch":
      return `${c.nodes} nodes · ${c.shardGb}GB shards`;
    case "event_queue":
      return `${c.partitions} partitions · ${c.consumers} consumers`;
    case "realtime_gateway":
      return `${c.instances}× · ${c.throughputK}k/s push`;
    case "inference_server": {
      const hit = Math.min(Number(c.memoryGB) / Math.max(Number(c.workingSetGB), 0.001), 0.95);
      return `${c.replicas} GPU · ${Math.round(hit * 100)}% cached`;
    }
    case "observability":
      return c.coverage === "full" ? "metrics · logs · traces" : "metrics only";
    case "aws_sqs":
      return `${c.queues} queues · ${c.consumers} consumers`;
    case "gcp_pubsub":
      return `${c.topics} topics · ${c.subscribers} subscribers`;
    case "aws_sns":
      return `${c.topics} topics · ${Number(c.maxRps).toLocaleString()} rps`;
    case "aws_eventbridge":
      return `${c.buses} buses · ${Number(c.maxRps).toLocaleString()} rps`;
    case "aws_kinesis":
      return `${c.shards} shards · ${c.consumers} consumers`;
    case "aws_msk":
      return `${c.brokers} brokers · ${c.consumers} consumers`;
    case "aws_step_functions":
      return `${Number(c.maxRps).toLocaleString()} starts/s`;
    case "aws_redshift":
      return `${c.nodes} nodes · ${c.queryMs}ms`;
    case "aws_glue":
      return `${c.workers} workers`;
    case "aws_athena":
      return `${c.concurrentQueries} queries`;
    case "gcp_bigquery":
      return `${c.slots} slots · ${c.queryMs}ms`;
    case "gcp_dataflow":
      return `${c.workers} workers`;
    default:
      return Object.entries(c)
        .slice(0, 2)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ");
  }
}

export function SystemNode({ id, data, selected }: NodeProps) {
  const d = data as SystemNodeData;
  const spec = specOf(d.type);
  const r = useStore((s) => s.result.nodes[id]);
  const ev = useStore((s) => s.evalResult.nodes[id]);
  const runPhase = useStore((s) => s.runPhase);
  const isSource = spec.category === "source";
  const hasRun = runPhase !== "build";
  // Internals (health, utilization, latency, redline) are only visible if the
  // run is instrumented — that's what provisioning Observability buys you.
  const instrumented = useStore((s) => s.observability) !== "none";
  const showInternals = hasRun && instrumented;

  const health = showInternals ? r?.health ?? "idle" : "idle";
  const hc = HEALTH[health];
  const util = r?.utilization ?? 0;
  const loaded = showInternals && (r?.input.rps ?? 0) > 0.01;
  const barPct = Math.min(util, 1) * 100;
  const showGlow = showInternals && health !== "idle";

  // Build-time capacity plan (static peak estimate — not a live result).
  const cap = ev?.capacity ?? 0;
  const peak = ev?.input.rps ?? 0;
  const wired = peak > 0.01;
  const headroomPct = cap > 0 ? Math.min(peak / cap, 1) * 100 : 0;

  return (
    <div
      className={cn(
        "relative w-44 rounded-xl border bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur-sm transition-all",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        health === "fail" && "node-redline",
      )}
      style={showGlow ? { borderColor: hc.border } : undefined}
    >
      {showGlow && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-xl",
            (health === "hot" || health === "warn") && "node-pulse",
          )}
          style={{ boxShadow: `0 0 22px ${hc.glow}` }}
        />
      )}

      {!isSource && <Handle type="target" position={Position.Left} className={handleClass} />}

      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md" style={{ background: `${spec.accent}1f` }}>
          <ComponentIcon type={d.type} className="size-3.5" style={{ color: spec.accent }} />
        </span>
        <span className="text-[13px] font-semibold">{spec.label}</span>
      </div>

      <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {summary(d.type, d.config)}
      </div>

      {isSource ? (
        <div className="mt-2 h-[18px] text-[11px] leading-[18px] text-muted-foreground">traffic source</div>
      ) : loaded ? (
        // Live + instrumented: measured load, latency, and a health-colored bar.
        <div className="mt-2">
          <div className="flex items-baseline justify-between font-mono text-[11px]">
            <span style={{ color: hc.text }}>{Math.round(util * 100)}%</span>
            <span className="text-muted-foreground">{Math.round(r!.serviceMs)}ms</span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: hc.border }} />
          </div>
        </div>
      ) : showInternals ? (
        <div className="mt-2 h-[18px] text-[11px] leading-[18px] text-muted-foreground">no load</div>
      ) : hasRun ? (
        // Live but no observability — it's running, but you can't see inside.
        <div className="mt-2 flex h-[18px] items-center gap-1.5 text-[11px] leading-[18px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-muted-foreground/50" /> live · no telemetry
        </div>
      ) : (
        // Build: a calm capacity plan in azure — design estimate, not a live run.
        <div className="mt-2">
          <div className="flex items-baseline justify-between font-mono text-[11px]">
            <span className="text-muted-foreground">cap ≈ {fmtRps(cap)}</span>
            <span className="text-muted-foreground">{wired ? `peak ${fmtRps(peak)}` : "not wired"}</span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-signal/70 transition-all"
              style={{ width: `${wired ? headroomPct : 0}%` }}
            />
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}
