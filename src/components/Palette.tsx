import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { COMPONENT_LIST } from "../sim/components";
import type { Category } from "../sim/types";
import { useStore } from "../store";
import { ComponentIcon } from "./component-icons";

const GROUPS: { key: Category; label: string }[] = [
  { key: "frontend", label: "Frontend" },
  { key: "networking", label: "Networking" },
  { key: "compute", label: "Compute" },
  { key: "containers", label: "Containers" },
  { key: "delivery", label: "Delivery" },
  { key: "storage", label: "Storage" },
  { key: "database", label: "Database" },
  { key: "integration", label: "Integration" },
  { key: "analytics", label: "Analytics" },
  { key: "security", label: "Security" },
  { key: "observability", label: "Observability" },
  { key: "data", label: "Data" },
];

export function Palette() {
  const [q, setQ] = useState("");
  const addComponent = useStore((s) => s.addComponent);
  const allowed = useStore((s) => s.availableComponents());

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return COMPONENT_LIST.filter(
      (c) =>
        c.category !== "source" &&
        allowed.includes(c.type) &&
        (!needle || c.label.toLowerCase().includes(needle) || c.blurb.toLowerCase().includes(needle)),
    );
  }, [allowed, q]);

  return (
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border bg-card/30">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search components…"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="p-2">
          {GROUPS.map((g) => {
            const items = filtered.filter((c) => c.category === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key} className="mb-2">
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                  {g.label}
                </div>
                {items.map((c) => {
                  return (
                    <button
                      key={c.type}
                      onClick={() => addComponent(c.type)}
                      className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
                    >
                      <span
                        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border"
                        style={{ background: `${c.accent}14` }}
                      >
                        <ComponentIcon type={c.type} className="size-4" style={{ color: c.accent }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between">
                          <span className="text-sm font-medium">{c.label}</span>
                          <Plus className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted-foreground">
                          {c.blurb}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
