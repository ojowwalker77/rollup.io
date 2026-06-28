// The scenario library, ordered easy → hard. Add a scenario by creating a file
// here and dropping it into this list at the right difficulty.

import { ACME_MUSIC } from "./acme";
import { HOTEL } from "./hotel";
import { LIVE_CHAT } from "./realtime";
import type { Scenario } from "./types";

export const SCENARIOS: Scenario[] = [HOTEL, LIVE_CHAT, ACME_MUSIC];

export const DEFAULT_SCENARIO: Scenario = HOTEL;

export { goalsFromSla, profileAt } from "./types";
export type { Difficulty, Goal, Level, Scenario, Sla, Starter, StarterNode } from "./types";
