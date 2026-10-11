"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  MapCatalog,
  ModuleDescriptor,
  SettingDescriptor,
} from "@shared/protocol";
import type { InstanceLive } from "@/hooks/useViewSocket";
import { validateSettingValue, settingDefault } from "@/lib/validate";

interface ConfigResponse {
  online: boolean;
  modules: ModuleDescriptor[];
  config: { active_module: string | null; modules: Record<string, Record<string, unknown>> };
  catalog: MapCatalog | null;
}

export function ConfigTab({
  instanceId,
  live,
}: {
  instanceId: string;
  live: InstanceLive;
}) {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/instances/${instanceId}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ConfigResponse | null) => {
        if (!d) return;
        setData(d);
        const first = d.config.active_module ?? d.modules[0]?.id ?? null;
        setModuleId((m) => m ?? first);
      })
      .catch(() => {});
  }, [instanceId]);

  const descriptor = data?.modules.find((m) => m.id === moduleId) ?? null;
  const catalog = live.catalog ?? data?.catalog ?? null;

  // Load this module's settings into the draft whenever the module changes.
  useEffect(() => {
    if (!data || !descriptor) return;
    const stored = data.config.modules[descriptor.id] ?? {};
    const merged = { ...stored };
    for (const s of descriptor.settings)
      if (!(s.key in merged)) merged[s.key] = settingDefault(s);
    setDraft(merged);
    setErrors({});
    setSavedMsg(null);
  }, [data, descriptor]);

  // NPC species seen on the live map feed boolean_map discover=npc lists.
  const seenNpcs = useMemo(() => {
    const names = new Set<string>();
    for (const e of live.frame?.entities ?? [])
      if (e.is_npc || e.kind === "npc") names.add(e.name ?? e.type_id ?? String(e.id));
    return [...names].sort();
  }, [live.frame]);

  if (!data) return <div className="p-6 muted">Loading config…</div>;
  if (!data.modules.length)
    return (
      <div className="p-6 muted">
        No module descriptors yet — the agent pushes them in <code>hello</code>
        when it connects.
      </div>
    );

  const groups = new Map<string, SettingDescriptor[]>();
  for (const s of descriptor?.settings ?? []) {
    const g = s.group || "General";
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }

  function set(key: string, value: unknown, desc: SettingDescriptor) {
    setDraft((d) => ({ ...d, [key]: value }));
    const err = validateSettingValue(desc, value);
    setErrors((e) => {
      const next = { ...e };
      if (err) next[key] = err; else delete next[key];
      return next;
    });
  }

  async function save() {
    if (!descriptor) return;
    // Full client-side validation before sending.
    const errs: Record<string, string> = {};
    for (const s of descriptor.settings) {
      if (!(s.key in draft)) continue;
      const e = validateSettingValue(s, draft[s.key]);
      if (e) errs[s.key] = e;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch(`/api/instances/${instanceId}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "update_config",
        payload: { module_id: descriptor.id, settings: draft },
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    setSavedMsg(
      res.ok && body.ok !== false
        ? "Applied (echoed by agent)"
        : body.error ?? `failed (${res.status})`
    );
  }

  return (
    <div className="h-full flex min-h-0">
      <aside className="w-44 shrink-0 border-r border-[#232d47] overflow-y-auto p-2">
        {data.modules.map((m) => (
          <button
            key={m.id}
            onClick={() => setModuleId(m.id)}
            className={`block w-full text-left px-3 py-2 rounded text-sm ${
              m.id === moduleId ? "bg-[#1a2338] text-sky-300" : "muted hover:text-[#dbe4f5]"
            }`}
          >
            <div className="font-medium">{m.name}</div>
            {m.id === data.config.active_module && (
              <div className="text-[10px] text-green-400">active</div>
            )}
          </button>
        ))}
      </aside>

      <div className="flex-1 overflow-y-auto p-4 min-w-0">
        {descriptor && (
          <>
            <div className="mb-3">
              <div className="font-semibold">{descriptor.name}</div>
              {descriptor.description && (
                <div className="muted text-sm">{descriptor.description}</div>
              )}
            </div>
            {[...groups.entries()].map(([group, settings]) => (
              <div key={group} className="mb-5">
                <div className="text-xs uppercase tracking-wider muted mb-2 border-b border-[#232d47] pb-1">
                  {group}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3">
                  {settings.map((s) => (
                    <SettingRow
                      key={s.key}
                      desc={s}
                      value={draft[s.key]}
                      error={errors[s.key]}
                      catalog={catalog}
                      seenNpcs={seenNpcs}
                      onChange={(v) => set(s.key, v, s)}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3 sticky bottom-0 bg-[#101624] py-3">
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? "Applying…" : "Apply config"}
              </button>
              {savedMsg && <span className="text-sm muted">{savedMsg}</span>}
              {Object.keys(errors).length > 0 && (
                <span className="text-sm text-red-400">
                  {Object.keys(errors).length} invalid value(s)
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SettingRow({
  desc,
  value,
  error,
  catalog,
  seenNpcs,
  onChange,
}: {
  desc: SettingDescriptor;
  value: unknown;
  error?: string;
  catalog: MapCatalog | null;
  seenNpcs: string[];
  onChange: (v: unknown) => void;
}) {
  return (
    <label className="block text-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{desc.label}</span>
        {desc.description && (
          <span className="muted text-[11px] ml-2 truncate" title={desc.description}>
            {desc.description}
          </span>
        )}
      </div>
      <SettingWidget
        desc={desc}
        value={value}
        catalog={catalog}
        seenNpcs={seenNpcs}
        onChange={onChange}
      />
      {error && <div className="text-red-400 text-xs mt-1">{error}</div>}
    </label>
  );
}

export function SettingWidget({
  desc,
  value,
  catalog,
  seenNpcs,
  onChange,
}: {
  desc: SettingDescriptor;
  value: unknown;
  catalog: MapCatalog | null;
  seenNpcs: string[];
  onChange: (v: unknown) => void;
}) {
  const k = desc.kind;
  switch (k.type) {
    case "boolean":
      return (
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`w-10 h-5 rounded-full relative transition-colors ${
            value ? "bg-sky-600" : "bg-[#2a3550]"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
              value ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      );
    case "integer":
    case "number":
      return (
        <input
          type="number"
          className="input w-full"
          value={typeof value === "number" ? value : ""}
          min={k.min}
          max={k.max}
          step={k.type === "integer" ? 1 : "any"}
          onChange={(e) => {
            const v = e.target.value === "" ? undefined : Number(e.target.value);
            if (v === undefined) return onChange(v);
            let c = v;
            if (k.min !== undefined) c = Math.max(k.min, c);
            if (k.max !== undefined) c = Math.min(k.max, c);
            onChange(k.type === "integer" ? Math.round(c) : c);
          }}
        />
      );
    case "text":
      return (
        <input
          className="input w-full"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "map":
      return <MapSelect value={value} catalog={catalog} onChange={onChange} />;
    case "choice":
      return (
        <select
          className="input w-full"
          value={String(value ?? "")}
          onChange={(e) => {
            const opt = k.options.find((o) => String(o.value) === e.target.value);
            onChange(opt?.value ?? e.target.value);
          }}
        >
          {k.options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "boolean_map":
      return (
        <BooleanMapWidget
          desc={desc}
          value={value}
          seenNpcs={seenNpcs}
          onChange={onChange}
        />
      );
    case "json":
      return <JsonWidget value={value} onChange={onChange} />;
  }
}

function MapSelect({
  value,
  catalog,
  onChange,
}: {
  value: unknown;
  catalog: MapCatalog | null;
  onChange: (v: unknown) => void;
}) {
  const [q, setQ] = useState("");
  const maps = (catalog?.maps ?? []).filter(
    (m) => !q || m.name.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div>
      <input
        className="input w-full mb-1"
        placeholder="Search maps…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        className="input w-full"
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">Current map</option>
        {maps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.min_level ? ` (lvl ${m.min_level}+)` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function BooleanMapWidget({
  desc,
  value,
  seenNpcs,
  onChange,
}: {
  desc: SettingDescriptor;
  value: unknown;
  seenNpcs: string[];
  onChange: (v: unknown) => void;
}) {
  const map = (value as Record<string, boolean>) ?? {};
  const discover = desc.kind.type === "boolean_map" ? desc.kind.discover : undefined;
  const options = new Set(Object.keys(map));
  if (discover === "npc") for (const n of seenNpcs) options.add(n);
  const sorted = [...options].sort();
  return (
    <div className="max-h-44 overflow-y-auto border border-[#232d47] rounded p-2 flex flex-col gap-1">
      {sorted.length === 0 && (
        <span className="muted text-xs">No entries discovered yet.</span>
      )}
      {sorted.map((opt) => (
        <label key={opt} className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={!!map[opt]}
            onChange={(e) => onChange({ ...map, [opt]: e.target.checked })}
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

function JsonWidget({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <div>
      <textarea
        className={`input w-full font-mono text-xs h-28 ${bad ? "border-red-500" : ""}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && <div className="text-red-400 text-xs">Invalid JSON</div>}
    </div>
  );
}
