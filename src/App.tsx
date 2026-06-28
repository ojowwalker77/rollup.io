import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Briefing } from "./components/Briefing";
import { ChallengePanel } from "./components/ChallengePanel";
import { ConfigPanel } from "./components/ConfigPanel";
import { FlowCanvas } from "./components/FlowCanvas";
import { GameOver } from "./components/GameOver";
import { Header } from "./components/Header";
import { LevelComplete } from "./components/LevelComplete";
import { MetricsPanel } from "./components/MetricsPanel";
import { Palette } from "./components/Palette";
import { ScenarioSelect } from "./components/ScenarioSelect";
import { Timeline } from "./components/Timeline";
import { TopControls } from "./components/TopControls";
import { useStore } from "./store";

export function App() {
  const theme = useStore((s) => s.theme);
  const screen = useStore((s) => s.screen);

  // Drive the steady-state simulation on a timer so the numbers feel live.
  useEffect(() => {
    const id = setInterval(() => useStore.getState().tick(), 100);
    return () => clearInterval(id);
  }, []);

  // Reflect the chosen theme onto <html> for the CSS token switch.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <TooltipProvider>
      <ReactFlowProvider>
        {screen === "home" ? (
          <ScenarioSelect />
        ) : (
          <>
            <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
              <Header />
              <div className="flex min-h-0 flex-1">
                <Palette />
                <main className="relative min-w-0 flex-1">
                  <FlowCanvas />
                  <TopControls />
                  <MetricsPanel />
                  <ChallengePanel />
                  <Timeline />
                </main>
                <ConfigPanel />
              </div>
            </div>
            <Briefing />
            <LevelComplete />
            <GameOver />
          </>
        )}
      </ReactFlowProvider>
    </TooltipProvider>
  );
}

export default App;
