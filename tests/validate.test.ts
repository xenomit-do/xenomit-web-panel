import { describe, it, expect } from "vitest";
import { sanitizePayload, containsForbiddenKey } from "@/lib/sanitize";
import {
  validateAgentMessage,
  validateSettings,
  validateCommand,
  settingDefault,
} from "@/lib/validate";
import type { ModuleDescriptor } from "@shared/protocol";

describe("sanitizePayload — session-cookie firewall", () => {
  it("strips sid/dosid/session_id/cookie keys recursively", () => {
    const dirty = {
      a: 1,
      sid: "evil",
      nested: { dosid: "evil", ok: true, deep: { cookie: "x", keep: 1 } },
      arr: [{ session_id: "y" }, 2],
    };
    const clean = sanitizePayload(dirty) as Record<string, unknown>;
    expect(clean.sid).toBeUndefined();
    expect((clean.nested as Record<string, unknown>).dosid).toBeUndefined();
    expect(
      ((clean.nested as Record<string, unknown>).deep as Record<string, unknown>).keep
    ).toBe(1);
    expect((clean.arr as unknown[])[1]).toBe(2);
    expect(containsForbiddenKey(dirty)).toBe(true);
    expect(containsForbiddenKey(clean)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(containsForbiddenKey({ SID: "x" })).toBe(true);
    expect(sanitizePayload({ DoSid: "x", a: 1 })).toEqual({ a: 1 });
  });
});

describe("validateAgentMessage", () => {
  const hello = {
    type: "hello",
    protocol: 1,
    instance: { server: "s", user_id: "1", username: "u" },
    client: "ruffle",
    backend: "native",
    modules: [],
    config: { modules: {} },
  };
  it("accepts a valid hello", () => {
    expect(validateAgentMessage(hello)).toBe(true);
  });
  it("rejects wrong protocol / bad client kind", () => {
    expect(validateAgentMessage({ ...hello, protocol: 2 })).toBe(false);
    expect(validateAgentMessage({ ...hello, client: "telnet" })).toBe(false);
  });
  it("enforces the entity cap", () => {
    const entities = Array.from({ length: 4097 }, (_, i) => ({ id: i, x: 0, y: 0 }));
    expect(validateAgentMessage({ type: "frame", seq: 1, entities })).toBe(false);
    entities.pop();
    expect(validateAgentMessage({ type: "frame", seq: 1, entities })).toBe(true);
  });
  it("requires 4-wide balances on stat_event", () => {
    expect(
      validateAgentMessage({ type: "stat_event", at: 0, source: "s", rewards: [1, 2, 3], balances: [1, 2, 3, 4] })
    ).toBe(false);
  });
});

const descriptor: ModuleDescriptor = {
  id: "m",
  name: "M",
  settings: [
    { key: "flag", label: "f", kind: { type: "boolean" } },
    { key: "n", label: "n", kind: { type: "integer", min: 0, max: 10 } },
    { key: "rate", label: "r", kind: { type: "number", min: 0.5 } },
    { key: "zone", label: "z", kind: { type: "text" } },
    { key: "map", label: "m", kind: { type: "map" } },
    { key: "cfg", label: "c", kind: { type: "choice", options: [{ label: "a", value: 1 }, { label: "b", value: 2 }] } },
    { key: "kill", label: "k", kind: { type: "boolean_map", discover: "npc" } },
    { key: "extra", label: "e", kind: { type: "json" } },
  ],
};

describe("validateSettings — every SettingKind", () => {
  it("accepts a full valid object", () => {
    const r = validateSettings(descriptor, {
      flag: true, n: 5, rate: 2.5, zone: "top", map: 4,
      cfg: 2, kill: { Streuner: true }, extra: { x: 1 },
    });
    expect(r.ok).toBe(true);
  });
  it("rejects out-of-range, wrong types, unknown keys", () => {
    const r = validateSettings(descriptor, {
      flag: "yes", n: 99, rate: 0.1, map: "1-1", cfg: 3,
      kill: { Streuner: "yes" }, bogus: 1,
    } as never);
    expect(r.ok).toBe(false);
    expect(r.errors.flag).toBeTruthy();
    expect(r.errors.n).toBeTruthy();
    expect(r.errors.rate).toBeTruthy();
    expect(r.errors.map).toBeTruthy();
    expect(r.errors.cfg).toBeTruthy();
    expect(r.errors.kill).toBeTruthy();
    expect(r.errors.bogus).toBeTruthy();
  });
  it("map kind allows null (current map)", () => {
    expect(validateSettings(descriptor, { map: null }).ok).toBe(true);
  });
  it("supplies defaults", () => {
    expect(settingDefault(descriptor.settings[1])).toBe(0);
    expect(settingDefault(descriptor.settings[4])).toBe(null);
    expect(settingDefault(descriptor.settings[5])).toBe(1);
  });
});

describe("validateCommand", () => {
  it("validates each action shape", () => {
    expect(validateCommand("start", {}).ok).toBe(true);
    expect(validateCommand("set_module", { module_id: "x" }).ok).toBe(true);
    expect(validateCommand("set_module", {}).ok).toBe(false);
    expect(validateCommand("update_config", { module_id: "m", settings: {} }).ok).toBe(true);
    expect(validateCommand("game_command", { command: "jump_portal", portal_id: 5 }).ok).toBe(true);
    expect(validateCommand("game_command", { command: "jump_portal" }).ok).toBe(false);
    expect(validateCommand("game_command", { command: "select_configuration", configuration: 3 }).ok).toBe(false);
    expect(validateCommand("nonsense", {}).ok).toBe(false);
  });
});
