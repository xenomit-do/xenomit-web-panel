import type {
  AgentMessage,
  CommandAction,
  ModuleDescriptor,
  SettingDescriptor,
} from "@shared/protocol";

export const MAX_AGENT_MESSAGE_BYTES = 64 * 1024;
export const MAX_ENTITIES = 4096;
const MAX_LOG_LINE = 4096;
const MAX_MODULES = 64;
const MAX_SETTINGS_PER_MODULE = 512;

const CLIENT_KINDS = new Set(["ruffle", "packet", "flash"]);
const BACKENDS = new Set(["native", "legacy_pipe", "tcp"]);
const ENTITY_KINDS = new Set([
  "hero", "player", "npc", "pet", "box", "ore", "portal",
  "base", "station", "beacon", "mine", "other",
]);

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Light structural validation of an inbound agent message. */
export function validateAgentMessage(msg: unknown): msg is AgentMessage {
  if (!isRecord(msg) || typeof msg.type !== "string") return false;
  switch (msg.type) {
    case "hello":
      return (
        msg.protocol === 1 &&
        isRecord(msg.instance) &&
        typeof msg.instance.server === "string" &&
        typeof msg.instance.user_id === "string" &&
        typeof msg.instance.username === "string" &&
        CLIENT_KINDS.has(msg.client as string) &&
        BACKENDS.has(msg.backend as string) &&
        Array.isArray(msg.modules) &&
        (msg.modules as unknown[]).length <= MAX_MODULES &&
        isRecord(msg.config)
      );
    case "frame":
      return (
        num(msg.seq) &&
        (msg.entities === undefined ||
          (Array.isArray(msg.entities) &&
            msg.entities.length <= MAX_ENTITIES &&
            msg.entities.every(
              (e) => isRecord(e) && num(e.id) && num(e.x) && num(e.y) &&
                (e.kind === undefined || ENTITY_KINDS.has(e.kind as string))
            )))
      );
    case "status":
      return typeof msg.bot_running === "boolean" && num(msg.uptime_s);
    case "stat_event":
      return (
        Array.isArray(msg.rewards) &&
        msg.rewards.length === 4 &&
        (msg.rewards as unknown[]).every(num) &&
        Array.isArray(msg.balances) &&
        msg.balances.length === 4 &&
        (msg.balances as unknown[]).every(num)
      );
    case "catalog":
      return Array.isArray(msg.maps) && Array.isArray(msg.links);
    case "config":
      return isRecord(msg.config);
    case "log":
      return typeof msg.line === "string" && msg.line.length <= MAX_LOG_LINE;
    case "command_result":
      return typeof msg.id === "string" && typeof msg.ok === "boolean";
    case "pong":
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Settings validation (schema-driven; also mirrored client-side)
// ---------------------------------------------------------------------------

export function settingDefault(desc: SettingDescriptor): unknown {
  if (desc.default !== undefined) return desc.default;
  switch (desc.kind.type) {
    case "boolean": return false;
    case "integer":
    case "number": return desc.kind.min ?? 0;
    case "text": return "";
    case "map": return null;
    case "choice": return desc.kind.options[0]?.value ?? null;
    case "boolean_map": return {};
    case "json": return {};
  }
}

export function validateSettingValue(
  desc: SettingDescriptor,
  value: unknown
): string | null {
  const k = desc.kind;
  switch (k.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "must be a boolean";
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value))
        return "must be an integer";
      if (k.min !== undefined && value < k.min) return `must be ≥ ${k.min}`;
      if (k.max !== undefined && value > k.max) return `must be ≤ ${k.max}`;
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        return "must be a number";
      if (k.min !== undefined && value < k.min) return `must be ≥ ${k.min}`;
      if (k.max !== undefined && value > k.max) return `must be ≤ ${k.max}`;
      return null;
    case "text":
      return typeof value === "string" && value.length <= 1024
        ? null
        : "must be a short string";
    case "map":
      return value === null || typeof value === "number"
        ? null
        : "must be null or a map id";
    case "choice":
      return k.options.some((o) => o.value === value)
        ? null
        : "must be one of the allowed options";
    case "boolean_map":
      if (!isRecord(value)) return "must be an object";
      for (const v of Object.values(value))
        if (typeof v !== "boolean") return "entries must be booleans";
      return null;
    case "json":
      try {
        JSON.stringify(value);
        return null;
      } catch {
        return "must be JSON-serializable";
      }
  }
}

/** Validate a full settings object against a module descriptor. */
export function validateSettings(
  descriptor: ModuleDescriptor,
  settings: Record<string, unknown>
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const keys = Object.keys(settings);
  if (keys.length > MAX_SETTINGS_PER_MODULE) {
    return { ok: false, errors: { _: "too many settings" } };
  }
  for (const desc of descriptor.settings) {
    if (!(desc.key in settings)) continue; // absent keys fall back to defaults
    const err = validateSettingValue(desc, settings[desc.key]);
    if (err) errors[desc.key] = err;
  }
  const known = new Set(descriptor.settings.map((s) => s.key));
  for (const key of keys) {
    if (!known.has(key)) errors[key] = "unknown setting";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Fill in defaults for keys a descriptor defines but the config omits. */
export function applyDefaults(
  descriptor: ModuleDescriptor,
  settings: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...settings };
  for (const desc of descriptor.settings)
    if (!(desc.key in out)) out[desc.key] = settingDefault(desc);
  return out;
}

// ---------------------------------------------------------------------------
// Command validation
// ---------------------------------------------------------------------------

const ACTIONS: CommandAction[] = [
  "start", "stop", "set_module", "update_config",
  "game_command", "refresh_stats", "reset_stats", "shutdown",
];

export function validateCommand(
  action: unknown,
  payload: unknown
): { ok: true; action: CommandAction; payload: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof action !== "string" || !ACTIONS.includes(action as CommandAction))
    return { ok: false, error: "unknown action" };
  const p = payload === undefined ? {} : payload;
  if (!isRecord(p)) return { ok: false, error: "payload must be an object" };
  const a = action as CommandAction;
  if (a === "set_module" && typeof p.module_id !== "string")
    return { ok: false, error: "set_module requires module_id" };
  if (a === "update_config") {
    if (typeof p.module_id !== "string" || !isRecord(p.settings))
      return { ok: false, error: "update_config requires module_id + settings" };
  }
  if (a === "game_command") {
    if (typeof p.command !== "string") return { ok: false, error: "game_command requires command" };
    const c = p.command;
    if (c === "jump_portal" && !num(p.portal_id))
      return { ok: false, error: "jump_portal requires portal_id" };
    if (c === "set_pet" && typeof p.enabled !== "boolean")
      return { ok: false, error: "set_pet requires enabled" };
    if (c === "select_pet_gear" && (typeof p.gear_type !== "string" || typeof p.target !== "string"))
      return { ok: false, error: "select_pet_gear requires gear_type + target" };
    if (c === "select_configuration" && p.configuration !== 1 && p.configuration !== 2)
      return { ok: false, error: "select_configuration requires configuration 1|2" };
    if (c === "use_item" && (typeof p.item_id !== "string" || typeof p.activate !== "boolean"))
      return { ok: false, error: "use_item requires item_id + activate" };
    if (c === "revive" && typeof p.repair_type !== "string")
      return { ok: false, error: "revive requires repair_type" };
    if (!["jump_portal","set_pet","select_pet_gear","select_configuration","use_item","revive"].includes(c))
      return { ok: false, error: "unknown game_command" };
  }
  return { ok: true, action: a, payload: p };
}
