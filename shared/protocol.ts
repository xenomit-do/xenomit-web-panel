// Agent Protocol v1 — shared types for the panel backend, frontend and mock agent.

export const AGENT_PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Map frame
// ---------------------------------------------------------------------------

export interface MapInfo {
  id: number; // -1 or absent = loading
  name: string;
  width: number;
  height: number;
}

export interface PetInfo {
  owned: boolean;
  active: boolean;
  destroyed: boolean;
  gear?: string | null;
}

export interface Hero {
  id: number;
  x: number;
  y: number;
  dest?: { x: number; y: number };
  hp: number;
  max_hp: number;
  shield: number;
  max_shield: number;
  nanohull: number;
  nanohull_max: number;
  faction?: string;
  clan?: string;
  configuration: number; // 1 | 2
  killed: boolean;
  level?: number;
  cargo?: { used: number; max: number };
  pet?: PetInfo;
}

export type EntityKind =
  | "hero"
  | "player"
  | "npc"
  | "pet"
  | "box"
  | "ore"
  | "portal"
  | "base"
  | "station"
  | "beacon"
  | "mine"
  | "other";

export type ClanDiplomacy = "ally" | "war" | "neutral" | "none" | string;

export interface Entity {
  id: number;
  kind: EntityKind;
  name?: string;
  x: number;
  y: number;
  dest?: { x: number; y: number };
  hp?: number;
  max_hp?: number;
  shield?: number;
  max_shield?: number;
  faction?: string;
  clan?: string;
  clan_diplomacy?: ClanDiplomacy;
  type_id?: string;
  is_npc?: boolean;
  is_hero?: boolean;
  is_collectable?: boolean;
}

export interface Portal {
  id: number;
  x: number;
  y: number;
  target_map: number;
  target_name?: string;
  jumping?: boolean;
}

export type Obstacle =
  | { type: "circle"; center: { x: number; y: number }; radius: number; inverted?: boolean }
  | {
      type: "rectangle";
      bounds: { x: number; y: number; w: number; h: number };
      inverted?: boolean;
    }
  | { type: "polygon"; points: { x: number; y: number }[]; inverted?: boolean };

export interface SafePlace {
  kind: "portal" | "battle_station" | "base";
  name?: string;
  x: number;
  y: number;
  radius: number;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type ClientKind = "ruffle" | "packet" | "flash";
export type BackendKind = "native" | "legacy_pipe" | "tcp";

/** Fixed positional order used by balances/rewards arrays. */
export const BALANCE_KEYS = ["credits", "uridium", "honor", "experience"] as const;
export type Balances = [number, number, number, number];

export interface StatusMessage {
  bot_running: boolean;
  module_id?: string | null;
  activity?: string;
  uptime_s: number;
  sid_expires_at?: number | string | null; // epoch ms or ISO
  client: ClientKind;
  backend: BackendKind;
  capture_ms?: number;
  bridge_ping_ms?: number;
  cpu_pct?: number;
  ram_mb?: number;
  deaths?: number;
  balances?: Balances;
  rates?: { cre_h: number; uri_h: number; exp_h: number; hon_h: number };
  // v1.1 (managed bots, docs/08 §8.7) — optional; old panels ignore them.
  phase?: string;
  needs_human?: { kind: string; detail?: string } | null;
}

// ---------------------------------------------------------------------------
// Stats / catalog / logs
// ---------------------------------------------------------------------------

export interface StatEvent {
  at: number | string; // epoch ms or ISO
  source: string;
  message?: string;
  rewards: Balances;
  balances: Balances;
  seq?: number; // v1.1: per-instance monotonic for idempotent replay
}

export interface CatalogMap {
  id: number;
  name: string;
  min_level?: number;
}

export interface CatalogLink {
  from: number;
  to: number;
  portal_id?: number;
}

export interface MapCatalog {
  maps: CatalogMap[];
  links: CatalogLink[];
}

export interface LogLine {
  at: number | string;
  level: "debug" | "info" | "warn" | "error" | string;
  line: string;
}

// ---------------------------------------------------------------------------
// Module descriptors & config
// ---------------------------------------------------------------------------

export type SettingKind =
  | { type: "boolean" }
  | { type: "integer"; min?: number; max?: number }
  | { type: "number"; min?: number; max?: number }
  | { type: "text" }
  | { type: "map" }
  | { type: "choice"; options: { label: string; value: string | number }[] }
  | { type: "boolean_map"; discover?: "player" | "ship" | "npc" | "portal" | "unknown" }
  | { type: "json" };

export interface SettingDescriptor {
  key: string; // dotted path
  label: string;
  description?: string;
  group?: string;
  kind: SettingKind;
  default?: unknown;
}

export interface ModuleDescriptor {
  id: string;
  name: string;
  description?: string;
  required_services?: string[];
  settings: SettingDescriptor[];
}

export interface ModuleConfig {
  active_module?: string | null;
  modules: Record<string, Record<string, unknown>>;
}

export interface InstanceIdentity {
  server: string;
  user_id: string;
  username: string;
}

// ---------------------------------------------------------------------------
// Agent -> Server messages
// ---------------------------------------------------------------------------

export interface HelloMessage {
  type: "hello";
  protocol: number;
  agent_version?: string;
  os?: string;
  machine?: string;
  instance: InstanceIdentity;
  client: ClientKind;
  backend: BackendKind;
  modules: ModuleDescriptor[];
  config: ModuleConfig;
  // v1.1 (managed bots, docs/08 §8.7) — optional; old panels ignore them.
  managed?: boolean;
  epoch?: number;
  restored?: { quality: "clean" | "degraded" | string; downtime_ms?: number };
}

export interface FrameMessage {
  type: "frame";
  seq: number;
  captured_at?: number | string;
  map?: MapInfo;
  hero?: Hero;
  entities?: Entity[];
  portals?: Portal[];
  obstacles?: Obstacle[];
  safe_places?: SafePlace[];
}

export interface StatusMsg extends StatusMessage {
  type: "status";
}

export interface StatEventMsg extends StatEvent {
  type: "stat_event";
}

export interface CatalogMsg extends MapCatalog {
  type: "catalog";
}

export interface ConfigMsg {
  type: "config";
  config: ModuleConfig;
}

export interface LogMsg extends LogLine {
  type: "log";
}

export interface CommandResultMsg {
  type: "command_result";
  id: string;
  ok: boolean;
  error?: string;
  data?: unknown;
}

export interface PongMsg {
  type: "pong";
  t: number;
}

export type AgentMessage =
  | HelloMessage
  | FrameMessage
  | StatusMsg
  | StatEventMsg
  | CatalogMsg
  | ConfigMsg
  | LogMsg
  | CommandResultMsg
  | PongMsg;

// ---------------------------------------------------------------------------
// Server -> Agent messages
// ---------------------------------------------------------------------------

export type GameCommandPayload =
  | { command: "jump_portal"; portal_id: number }
  | { command: "set_pet"; enabled: boolean }
  | { command: "select_pet_gear"; gear_type: string; target: string }
  | { command: "select_configuration"; configuration: 1 | 2 }
  | { command: "use_item"; item_id: string; activate: boolean }
  | { command: "revive"; repair_type: string };

export type CommandAction =
  | "start"
  | "stop"
  | "set_module"
  | "update_config"
  | "game_command"
  | "refresh_stats"
  | "reset_stats"
  | "shutdown";

export interface CommandPayloads {
  start: Record<string, never>;
  stop: Record<string, never>;
  set_module: { module_id: string };
  update_config: { module_id: string; settings: Record<string, unknown> };
  game_command: GameCommandPayload;
  refresh_stats: Record<string, never>;
  reset_stats: Record<string, never>;
  shutdown: Record<string, never>;
}

export interface CommandMsg {
  type: "command";
  id: string;
  action: CommandAction;
  payload?: Record<string, unknown>;
}

export interface SetStreamRateMsg {
  type: "set_stream_rate";
  hz: number; // 1..10
}

export interface PingMsg {
  type: "ping";
  t: number;
}

/** v1.1: acknowledges a stat_event seq so the agent can trim its outbox. */
export interface StatAckMsg {
  type: "stat_ack";
  seq: number;
}

export type ServerMessage = CommandMsg | SetStreamRateMsg | PingMsg | StatAckMsg;

// ---------------------------------------------------------------------------
// Viewer socket (browser <-> panel relay)
// ---------------------------------------------------------------------------

export type ViewClientMessage =
  | { type: "subscribe"; instance_ids: string[] }
  | { type: "unsubscribe"; instance_ids: string[] }
  | { type: "ping"; t?: number };

export type ViewServerMessage =
  | { type: "hello"; user_id: string }
  | {
      type: "snapshot";
      instance_id: string;
      online: boolean;
      last_seen_at?: string | null;
      frame?: FrameMessage | null;
      status?: StatusMessage | null;
      catalog?: MapCatalog | null;
      logs?: LogLine[];
      phase?: string | null;
      phase_detail?: unknown;
      desired_state?: string | null;
    }
  | { type: "presence"; instance_id: string; online: boolean; last_seen_at?: string | null }
  | {
      type: "phase"; // orchestrator lifecycle event (managed instances)
      instance_id: string;
      phase: string;
      detail?: unknown;
      desired_state?: string | null;
      epoch?: number;
      version?: string | null;
      at?: string;
    }
  | ({ type: "frame"; instance_id: string } & Omit<FrameMessage, "type">)
  | ({ type: "status"; instance_id: string } & StatusMessage)
  | ({ type: "stat_event"; instance_id: string } & StatEvent)
  | ({ type: "config"; instance_id: string } & ConfigMsg)
  | ({ type: "catalog"; instance_id: string } & MapCatalog)
  | ({ type: "log"; instance_id: string } & LogLine)
  | {
      type: "command_update";
      instance_id: string;
      id: string;
      ok: boolean;
      error?: string;
      data?: unknown;
    }
  | { type: "pong"; t: number }
  | { type: "error"; error: string };

// ---------------------------------------------------------------------------
// Pairing REST
// ---------------------------------------------------------------------------

export interface PairRequest {
  code: string;
  instance?: Partial<InstanceIdentity>;
}

export interface PairResponse {
  instance_id: string;
  token: string;
  agent_ws_url: string;
}
