import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "../store";

export function TopControls() {
  const runPhase = useStore((s) => s.runPhase);
  const goLive = useStore((s) => s.goLive);
  const clock = useStore((s) => s.clock);

  if (runPhase === "live") {
    return (
      <div className="absolute top-4 left-1/2 z-10 flex w-72 -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-card/90 px-3 py-2.5 shadow-2xl backdrop-blur">
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-sm font-semibold text-red-500">
          <span className="size-2 animate-pulse rounded-full bg-red-500" /> LIVE
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${clock * 100}%` }} />
        </div>
        <span className="w-9 text-right font-mono text-xs text-muted-foreground">{Math.round(clock * 100)}%</span>
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-card/90 px-2.5 py-2 shadow-2xl backdrop-blur">
      <Button onClick={goLive} size="sm" className="w-32">
        <Play className="size-3.5 fill-current" />
        Go Live
      </Button>
      <span className="pr-1 font-mono text-[11px] text-muted-foreground">test under live traffic</span>
    </div>
  );
}
