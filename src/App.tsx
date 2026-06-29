import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Briefing } from "./components/Briefing";
import { ConfigPanel } from "./components/ConfigPanel";
import { Dock } from "./components/Dock";
import { FlowCanvas } from "./components/FlowCanvas";
import { GameOver } from "./components/GameOver";
import { Header } from "./components/Header";
import { LevelComplete } from "./components/LevelComplete";
import { Palette } from "./components/Palette";
import { ScenarioSelect } from "./components/ScenarioSelect";
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
                </main>
                <ConfigPanel />
              </div>
              <Dock />
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
