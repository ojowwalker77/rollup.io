import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import { useMemo } from "react";
import { useStore } from "../store";
import { SystemNode } from "./SystemNode";

const nodeTypes: NodeTypes = { system: SystemNode };

export function FlowCanvas() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const resultNodes = useStore((s) => s.result.nodes);
  const runPhase = useStore((s) => s.runPhase);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const onConnect = useStore((s) => s.onConnect);
  const deleteEdge = useStore((s) => s.deleteEdge);
  const select = useStore((s) => s.select);
  const selectEdge = useStore((s) => s.selectEdge);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const theme = useStore((s) => s.theme);
  const live = runPhase === "live";

  const gridFine = theme === "dark" ? "oklch(0.72 0.13 243 / 0.05)" : "oklch(0.5 0.12 243 / 0.1)";
  const gridCoarse = theme === "dark" ? "oklch(0.72 0.13 243 / 0.09)" : "oklch(0.5 0.12 243 / 0.16)";
  const idleStroke = theme === "dark" ? "oklch(0.55 0.03 250)" : "oklch(0.62 0.03 250)";

  const styledEdges = useMemo(
    () =>
      edges.map((e) => {
        // Backpressure: a connection feeding a saturating component is redlined.
        const targetHealth = live ? resultNodes[e.target]?.health : undefined;
        const stressed = targetHealth === "fail" || targetHealth === "hot";
        const selected = e.id === selectedEdgeId;
        const stroke = selected
          ? "var(--signal)"
          : stressed
            ? "var(--destructive)"
            : live
              ? "var(--signal)"
              : idleStroke;
        return {
          ...e,
          animated: live,
          interactionWidth: 18,
          style: {
            stroke,
            strokeWidth: selected ? 3 : stressed ? 2.5 : live ? 2 : 1.75,
            strokeOpacity: live && !stressed ? 0.85 : 1,
          },
        };
      }),
    [edges, live, resultNodes, selectedEdgeId, idleStroke],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={styledEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_, n) => select(n.id)}
      onEdgeClick={(_, e) => selectEdge(e.id)}
      onEdgeDoubleClick={(_, e) => deleteEdge(e.id)}
      onPaneClick={() => select(null)}
      edgesFocusable={!live}
      edgesReconnectable={!live}
      elementsSelectable={!live}
      deleteKeyCode={live ? null : ["Backspace", "Delete"]}
      nodesDraggable={!live}
      nodesConnectable={runPhase === "build"}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      {/* Blueprint paper: a fine grid with a coarser drafting grid over it. */}
      <Background id="fine" variant={BackgroundVariant.Lines} gap={26} lineWidth={1} color={gridFine} />
      <Background id="coarse" variant={BackgroundVariant.Lines} gap={130} lineWidth={1} color={gridCoarse} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
