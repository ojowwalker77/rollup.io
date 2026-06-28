import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import { specOf } from "./sim/components";
import { runSimulation, type SimEdge, type SimNode } from "./sim/engine";
import { DEFAULT_SCENARIO, SCENARIOS, profileAt, type Level, type Scenario } from "./sim/scenarios";
import type { Config, Metrics, SimResult } from "./sim/types";

export interface SystemNodeData extends Record<string, unknown> {
  type: string;
  config: Config;
}
export type FlowNode = Node<SystemNodeData>;

export type Theme = "dark" | "light";
export type RunPhase = "build" | "live" | "won" | "lost";

export interface TimePoint {
  t: number; // 0..1 through the window
  offered: number;
  served: number;
  rep: number;
}

/** How long a live run takes in real time (ticks @ 100ms). */
const PLAY_TICKS = 180; // ~18s
const REP_RECOVER = 0.7;

const THEME_KEY = "rollup.theme";
function loadTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) || "dark";
  } catch {
    return "dark";
  }
}

const BEST_KEY = "rollup.best";
function loadBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveBest(b: Record<string, number>) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

const ZERO_METRICS: Metrics = {
  offeredRps: 0,
  servedRps: 0,
  avgMs: 0,
  p95Ms: 0,
  p99Ms: 0,
  errorRate: 0,
  availability: 1,
  activeNodes: 0,
  failingNodes: 0,
  totalCostUsd: 0,
};

interface State {
  screen: "home" | "play";
  scenario: Scenario;
  levelIndex: number;
  nodes: FlowNode[];
  edges: Edge[];
  selectedId: string | null;
  selectedEdgeId: string | null;
  runPhase: RunPhase;
  clock: number; // 0..1 through the live window
  reputation: number; // 0..100 — customers/turnover meter
  history: TimePoint[];
  traffic: number; // build-time preview multiplier
  briefingOpen: boolean;
  bestCost: Record<string, number>;
  theme: Theme;
  result: SimResult; // live/preview
  evalResult: SimResult; // nominal 1× (build-time design check)
  display: Metrics;
  seq: number;

  onNodesChange: (c: NodeChange[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;
  addComponent: (type: string, position?: { x: number; y: number }) => void;
  deleteEdge: (id: string) => void;
  updateConfig: (id: string, key: string, value: number | string) => void;
  deleteNode: (id: string) => void;
  select: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  selectScenario: (id: string) => void;
  goHome: () => void;
  setTraffic: (t: number) => void;
  setBriefing: (open: boolean) => void;
  toggleTheme: () => void;
  goLive: () => void;
  backToBuild: () => void;
  resetLevel: () => void;
  nextLevel: () => void;
  tick: () => void;
}

function toSim(nodes: FlowNode[]): SimNode[] {
  return nodes.map((n) => ({ id: n.id, type: n.data.type, config: n.data.config }));
}
function toSimEdges(edges: Edge[]): SimEdge[] {
  return edges.map((e) => ({ source: e.source, target: e.target }));
}
function lerp(a: number, b: number, t: number): number {
  return Math.abs(b - a) < 0.001 ? b : a + (b - a) * t;
}

function clientNode(level: Level): FlowNode {
  const spec = specOf("client");
  return {
    id: "client",
    type: "system",
    position: { x: 80, y: 240 },
    data: { type: "client", config: { ...spec.defaults, rps: level.clientRps, writeRatio: level.clientWriteRatio } },
  };
}

/** Materialize a level's board: the client plus its inherited starter (if any).
 *  Levels without a starter open blank (the from-scratch beats). */
function buildBoard(level: Level): { nodes: FlowNode[]; edges: Edge[] } {
  const nodes: FlowNode[] = [clientNode(level)];
  const edges: Edge[] = [];
  if (level.starter) {
    for (const sn of level.starter.nodes) {
      nodes.push({
        id: sn.ref,
        type: "system",
        position: sn.pos,
        data: { type: sn.type, config: { ...specOf(sn.type).defaults, ...sn.config } },
      });
    }
    for (const [source, target] of level.starter.edges) {
      edges.push({ id: `${source}->${target}`, source, target, animated: false });
    }
  }
  return { nodes, edges };
}

function lerpMetrics(from: Metrics, to: Metrics, k: number): Metrics {
  return {
    offeredRps: lerp(from.offeredRps, to.offeredRps, k),
    servedRps: lerp(from.servedRps, to.servedRps, k),
    avgMs: lerp(from.avgMs, to.avgMs, k),
    p95Ms: lerp(from.p95Ms, to.p95Ms, k),
    p99Ms: lerp(from.p99Ms, to.p99Ms, k),
    errorRate: lerp(from.errorRate, to.errorRate, k),
    availability: lerp(from.availability, to.availability, k),
    activeNodes: to.activeNodes,
    failingNodes: to.failingNodes,
    totalCostUsd: to.totalCostUsd,
  };
}

const level0 = DEFAULT_SCENARIO.levels[0]!;
const board0 = buildBoard(level0);

export const useStore = create<State>()((set, get) => ({
  screen: "home",
  scenario: DEFAULT_SCENARIO,
  levelIndex: 0,
  nodes: board0.nodes,
  edges: board0.edges,
  selectedId: null,
  selectedEdgeId: null,
  runPhase: "build",
  clock: 0,
  reputation: 100,
  history: [],
  traffic: 1,
  briefingOpen: true,
  bestCost: loadBest(),
  theme: loadTheme(),
  result: runSimulation(toSim(board0.nodes), board0.edges, 0, level0.mix),
  evalResult: runSimulation(toSim(board0.nodes), board0.edges, 1, level0.mix),
  display: ZERO_METRICS,
  seq: 0,

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes.filter((c) => c.type !== "remove"), get().nodes) as FlowNode[] }),
  onEdgesChange: (changes) => {
    const edges = applyEdgeChanges(changes, get().edges);
    const selectedEdgeId = get().selectedEdgeId;
    set({ edges, selectedEdgeId: selectedEdgeId && edges.some((e) => e.id === selectedEdgeId) ? selectedEdgeId : null });
  },
  onConnect: (conn) => {
    if (get().runPhase === "live") return;
    set({ edges: addEdge({ ...conn, animated: false }, get().edges), selectedEdgeId: null });
  },

  addComponent: (type, position) => {
    if (get().runPhase === "live") return;
    const spec = specOf(type);
    if (spec.category === "source" || !get().scenario.components.includes(type)) return;
    const seq = get().seq + 1;
    const id = `${type}-${seq}`;
    const pos = position ?? { x: 360 + (seq % 5) * 40, y: 360 + (seq % 3) * 36 };
    const node: FlowNode = { id, type: "system", position: pos, data: { type, config: { ...spec.defaults } } };
    set({ nodes: [...get().nodes, node], seq, selectedId: id, selectedEdgeId: null });
  },

  deleteEdge: (id) => {
    if (get().runPhase === "live") return;
    set({
      edges: get().edges.filter((e) => e.id !== id),
      selectedEdgeId: get().selectedEdgeId === id ? null : get().selectedEdgeId,
    });
  },

  updateConfig: (id, key, value) => {
    if (get().runPhase === "live") return;
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n,
      ),
    });
  },

  deleteNode: (id) => {
    if (get().runPhase === "live") return;
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
      selectedEdgeId: null,
    });
  },

  select: (id) => set({ selectedId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedId: null }),
  setTraffic: (t) => set({ traffic: t }),
  setBriefing: (open) => set({ briefingOpen: open }),

  selectScenario: (id) => {
    const scenario = SCENARIOS.find((s) => s.id === id) ?? DEFAULT_SCENARIO;
    const level = scenario.levels[0]!;
    const board = buildBoard(level);
    set({
      screen: "play",
      scenario,
      levelIndex: 0,
      nodes: board.nodes,
      edges: board.edges,
      selectedId: null,
      selectedEdgeId: null,
      runPhase: "build",
      clock: 0,
      reputation: 100,
      history: [],
      traffic: 1,
      briefingOpen: true,
      result: runSimulation(toSim(board.nodes), board.edges, 0, level.mix),
      evalResult: runSimulation(toSim(board.nodes), board.edges, 1, level.mix),
      display: ZERO_METRICS,
      seq: 0,
    });
  },

  goHome: () =>
    set({
      screen: "home",
      selectedId: null,
      selectedEdgeId: null,
      runPhase: "build",
      clock: 0,
      history: [],
      reputation: 100,
      display: ZERO_METRICS,
    }),

  toggleTheme: () => {
    const theme: Theme = get().theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },

  goLive: () => {
    if (get().runPhase !== "build") return;
    set({ runPhase: "live", clock: 0, history: [], reputation: 100, display: ZERO_METRICS });
  },

  backToBuild: () => set({ runPhase: "build", clock: 0, history: [], reputation: 100 }),

  resetLevel: () => {
    const { scenario, levelIndex } = get();
    const level = scenario.levels[levelIndex]!;
    const board = buildBoard(level);
    set({
      nodes: board.nodes,
      edges: board.edges,
      selectedId: null,
      selectedEdgeId: null,
      runPhase: "build",
      clock: 0,
      history: [],
      reputation: 100,
      display: ZERO_METRICS,
      seq: 0,
    });
  },

  // Each level opens from its own inherited board (a starter architecture
  // missing the piece that level teaches), or blank for the from-scratch beats.
  nextLevel: () => {
    const { levelIndex, scenario } = get();
    const ni = levelIndex + 1;
    const level = scenario.levels[ni];
    if (!level) {
      set({ runPhase: "build" });
      return;
    }
    const board = buildBoard(level);
    set({
      levelIndex: ni,
      nodes: board.nodes,
      edges: board.edges,
      runPhase: "build",
      clock: 0,
      history: [],
      reputation: 100,
      display: ZERO_METRICS,
      briefingOpen: true,
      selectedId: null,
      selectedEdgeId: null,
      seq: 0,
    });
  },

  tick: () => {
    const s = get();
    const { nodes, edges, runPhase, traffic, display, scenario, levelIndex } = s;
    const level = scenario.levels[levelIndex]!;
    const sim = toSim(nodes);
    const se = toSimEdges(edges);

    if (runPhase === "live") {
      const t = s.clock;
      const mult = profileAt(level, t);
      const result = runSimulation(sim, se, mult, level.mix);
      const m = result.metrics;

      const meets = m.offeredRps > 1 && m.availability >= level.sla.availability && m.p99Ms <= level.sla.p99Ms;
      const drain = 0.8 + m.errorRate * 14 + Math.max(0, m.p99Ms / level.sla.p99Ms - 1) * 2.5;
      let reputation = s.reputation + (meets ? REP_RECOVER : -drain);
      reputation = Math.max(0, Math.min(100, reputation));

      const history = s.history.concat({ t, offered: m.offeredRps, served: m.servedRps, rep: reputation });
      const clock = t + 1 / PLAY_TICKS;
      const cost = m.totalCostUsd;

      let nextPhase: RunPhase = "live";
      let bestCost = s.bestCost;
      if (reputation <= 0) {
        nextPhase = "lost";
      } else if (clock >= 1) {
        if (cost <= level.budgetUsd) {
          nextPhase = "won";
          const prev = bestCost[level.id];
          if (prev === undefined || cost < prev) {
            bestCost = { ...bestCost, [level.id]: cost };
            saveBest(bestCost);
          }
        } else {
          nextPhase = "lost";
        }
      }

      set({
        result,
        display: lerpMetrics(display, m, 0.32),
        clock: Math.min(1, clock),
        reputation,
        history,
        runPhase: nextPhase,
        bestCost,
      });
      return;
    }

    // build / won / lost — static preview (build uses the slider; results freeze).
    const previewMult = runPhase === "build" ? traffic : profileAt(level, 1);
    const result = runSimulation(sim, se, previewMult, level.mix);
    const evalResult = runSimulation(sim, se, 1, level.mix);
    set({ result, evalResult, display: runPhase === "build" ? ZERO_METRICS : lerpMetrics(display, result.metrics, 0.32) });
  },
}));
