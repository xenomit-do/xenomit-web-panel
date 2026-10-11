// Module presets for the "Create bot" wizard (docs/08 §8.4 step 2).
// These mirror the descriptors botd publishes in `hello` — the panel ships a
// copy so the wizard's Advanced section can render before the bot exists.
// The agent's own descriptors remain authoritative once it connects.

import type { ModuleDescriptor } from "./protocol";

export interface ModulePreset {
  id: string; // module id sent to the orchestrator as config.activeModule
  label: string;
  blurb: string;
}

export const MODULE_PRESETS: ModulePreset[] = [
  { id: "collector", label: "Collect", blurb: "Roam a map and hoover up bonus boxes." },
  { id: "npc_killer", label: "Kill NPCs", blurb: "Pure hunting loop on a working map." },
  { id: "kill_collect", label: "Kill + collect", blurb: "Hunt NPCs and grab drops along the way." },
  { id: "palladium", label: "Palladium", blurb: "Farm palladium on the 5-x maps." },
];

const SHIP = [
  { key: "ship.offensive_config", label: "Offensive config", group: "Ship",
    kind: { type: "choice", options: [{ label: "Config 1", value: 1 }, { label: "Config 2", value: 2 }] }, default: 1 },
  { key: "ship.run_config", label: "Run config", group: "Ship",
    kind: { type: "choice", options: [{ label: "Config 1", value: 1 }, { label: "Config 2", value: 2 }] }, default: 2 },
  { key: "ship.pet_enabled", label: "Enable P.E.T.", group: "Ship",
    kind: { type: "boolean" }, default: true },
] satisfies ModuleDescriptor["settings"];

const SAFETY = [
  { key: "safety.min_health", label: "Min health %", group: "Safety",
    kind: { type: "integer", min: 0, max: 100 }, default: 20 },
  { key: "safety.max_deaths", label: "Max deaths", group: "Safety",
    kind: { type: "integer", min: 0, max: 50 }, default: 5 },
  { key: "safety.run_from_enemy", label: "Run from enemies", group: "Safety",
    kind: { type: "boolean" }, default: true },
  { key: "safety.revive_location", label: "Revive location", group: "Safety",
    kind: { type: "choice", options: [
      { label: "Portal", value: "portal" }, { label: "Base", value: "base" }, { label: "Spot", value: "spot" }] },
    default: "portal" },
] satisfies ModuleDescriptor["settings"];

/** Default descriptors per preset module id (the Advanced section renders
 *  these; everything is optional so a bare preset is a valid config). */
export const PRESET_DESCRIPTORS: Record<string, ModuleDescriptor> = {
  collector: {
    id: "collector", name: "Collect",
    description: "Collect bonus boxes on a working map.",
    required_services: ["hero", "pathfinding", "collector"],
    settings: [
      { key: "navigation.working_map", label: "Working map", group: "Navigation",
        kind: { type: "map" }, default: null },
      { key: "features.avoid_enemies", label: "Avoid enemy players", group: "Features",
        kind: { type: "boolean" }, default: true },
      ...SAFETY,
    ],
  },
  npc_killer: {
    id: "npc_killer", name: "NPC Killer",
    description: "Pure hunting loop.",
    required_services: ["hero", "pathfinding", "targeting"],
    settings: [
      { key: "navigation.working_map", label: "Working map", group: "Navigation",
        kind: { type: "map" }, default: null },
      { key: "targets.npcs", label: "NPC kill list", group: "Targets",
        kind: { type: "boolean_map", discover: "npc" }, default: { Lordakia: true } },
      ...SHIP, ...SAFETY,
    ],
  },
  kill_collect: {
    id: "kill_collect", name: "Kill & Collect",
    description: "Hunt NPCs and collect boxes on a working map.",
    required_services: ["hero", "pathfinding"],
    settings: [
      { key: "navigation.working_map", label: "Working map", group: "Navigation",
        kind: { type: "map" }, default: null },
      { key: "targets.npcs", label: "NPC kill list", group: "Targets",
        kind: { type: "boolean_map", discover: "npc" }, default: { Streuner: true, Lordakia: true } },
      { key: "features.collect_boxes", label: "Collect boxes", group: "Features",
        kind: { type: "boolean" }, default: true },
      ...SHIP, ...SAFETY,
    ],
  },
  palladium: {
    id: "palladium", name: "Palladium",
    description: "Collect palladium on 5-x maps.",
    required_services: ["hero", "pathfinding", "collector"],
    settings: [
      { key: "navigation.working_map", label: "Working map", group: "Navigation",
        kind: { type: "map" }, default: 9 },
      { key: "features.avoid_enemies", label: "Avoid enemy players", group: "Features",
        kind: { type: "boolean" }, default: true },
      ...SAFETY,
    ],
  },
};

/** Game servers offered in the wizard (free-text is still allowed). */
export const KNOWN_SERVERS = [
  "int1.darkorbit.com", "int2.darkorbit.com", "int3.darkorbit.com",
  "int4.darkorbit.com", "int5.darkorbit.com", "int6.darkorbit.com",
  "int7.darkorbit.com", "int8.darkorbit.com",
  "us1.darkorbit.com", "us2.darkorbit.com",
  "eu1.darkorbit.com", "eu2.darkorbit.com",
  "ge1.darkorbit.com", "ge2.darkorbit.com", "ge3.darkorbit.com",
];
