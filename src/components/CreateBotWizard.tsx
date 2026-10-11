"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MODULE_PRESETS,
  PRESET_DESCRIPTORS,
  KNOWN_SERVERS,
} from "@shared/module-presets";
import { settingDefault, validateSettingValue } from "@/lib/validate";
import { SettingWidget } from "./ConfigTab";

// "Create bot" — 4-step wizard for managed instances (docs/08 §8.4).
// Credentials are sent once to /api/instances and forwarded to the
// orchestrator in memory only — the panel never stores or logs them.

const STEPS = ["Account", "Module", "Network", "Review & launch"] as const;
const COUNTRIES = ["", "DE", "NL", "GB", "FR", "PL", "US"];

export function CreateBotWizard({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Step 1 — account
  const [server, setServer] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "session">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dosid, setDosid] = useState("");

  // Step 2 — module preset + advanced settings
  const [preset, setPreset] = useState("kill_collect");
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [advanced, setAdvanced] = useState(false);
  const descriptor = PRESET_DESCRIPTORS[preset] ?? null;
  const mergedSettings = useMemo(() => {
    const out = { ...settings };
    for (const s of descriptor?.settings ?? [])
      if (!(s.key in out)) out[s.key] = settingDefault(s);
    return out;
  }, [settings, descriptor]);

  // Step 3 — network + version
  const [proxyMode, setProxyMode] = useState<"pool" | "fixed">("pool");
  const [country, setCountry] = useState("");
  const [pxScheme, setPxScheme] = useState("socks5");
  const [pxHost, setPxHost] = useState("");
  const [pxPort, setPxPort] = useState("");
  const [pxUser, setPxUser] = useState("");
  const [pxPass, setPxPass] = useState("");
  const [channel, setChannel] = useState<"stable" | "canary" | "pinned">("stable");
  const [pinnedImage, setPinnedImage] = useState("");
  const [nickname, setNickname] = useState("");

  const step1Ok =
    server.trim().length > 0 &&
    (authMode === "session"
      ? dosid.trim().length > 0
      : username.trim().length > 0 && password.length > 0);
  const step3Ok =
    proxyMode === "pool" ||
    (pxHost.trim().length > 0 &&
      Number.isInteger(Number(pxPort)) &&
      Number(pxPort) >= 1 &&
      Number(pxPort) <= 65535);

  function validateAdvanced(): boolean {
    for (const s of descriptor?.settings ?? []) {
      if (validateSettingValue(s, mergedSettings[s.key])) return false;
    }
    return true;
  }

  function next() {
    setError(null);
    if (step === 0 && !step1Ok) return;
    if (step === 1 && !validateAdvanced())
      return setError("fix the highlighted advanced settings first");
    if (step === 2 && !step3Ok) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function submit() {
    setCreating(true);
    setError(null);
    const account =
      authMode === "session"
        ? { server: server.trim(), auth_mode: "session", dosid: dosid.trim() }
        : {
            server: server.trim(),
            auth_mode: "password",
            username: username.trim(),
            password,
          };
    const body = {
      kind: "managed",
      nickname: nickname.trim() || undefined,
      account,
      preset,
      settings: { [preset]: mergedSettings },
      version: {
        channel,
        ...(channel === "pinned" ? { pinned_image: pinnedImage.trim() } : {}),
      },
      proxy:
        proxyMode === "pool"
          ? { mode: "pool", ...(country ? { country } : {}) }
          : {
              mode: "fixed",
              scheme: pxScheme,
              host: pxHost.trim(),
              port: Number(pxPort),
              ...(pxUser.trim() ? { username: pxUser.trim() } : {}),
              ...(pxPass ? { password: pxPass } : {}),
            },
    };
    try {
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(out.error ?? `create failed (${res.status})`);
        setCreating(false);
        return;
      }
      setCreatedId(out.instance.id);
    } catch {
      setError("network error");
      setCreating(false);
    }
  }

  function finish() {
    onClose();
    if (createdId) router.push(`/instances/${createdId}`);
    else router.refresh();
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={creating || createdId ? undefined : onClose}
    >
      <div
        className="panel p-6 w-full max-w-lg max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {createdId ? (
          <div className="text-center py-6">
            <div className="text-lg font-semibold mb-2 text-green-400">
              Bot created
            </div>
            <p className="muted text-sm mb-6">
              The orchestrator is provisioning it — you&apos;ll watch it go
              Provisioning → Armed → Starting → Running on the next screen.
            </p>
            <button className="btn btn-primary px-8" onClick={finish}>
              Watch it start
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold">Create bot</h2>
              <div className="muted text-xs">
                step {step + 1}/{STEPS.length}
              </div>
            </div>
            <div className="flex gap-1 mb-5">
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`h-1 flex-1 rounded ${i <= step ? "bg-sky-500" : "bg-[#232d47]"}`}
                />
              ))}
            </div>

            {step === 0 && (
              <div className="flex flex-col gap-4">
                <label className="text-sm block">
                  <div className="font-medium mb-1">Server</div>
                  <input
                    className="input w-full"
                    list="xn-servers"
                    placeholder="int1.darkorbit.com"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                  />
                  <datalist id="xn-servers">
                    {KNOWN_SERVERS.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </label>

                <div>
                  <div className="font-medium text-sm mb-2">Sign in with</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`panel p-3 text-left text-sm ${authMode === "password" ? "border-sky-500" : ""}`}
                      onClick={() => setAuthMode("password")}
                    >
                      <div className="font-semibold">Account credentials</div>
                      <div className="muted text-xs mt-0.5">
                        Backpage username + password
                      </div>
                    </button>
                    <button
                      className={`panel p-3 text-left text-sm ${authMode === "session" ? "border-sky-500" : ""}`}
                      onClick={() => setAuthMode("session")}
                    >
                      <div className="font-semibold">Session cookie</div>
                      <div className="muted text-xs mt-0.5">
                        A <code>dosid</code> from an existing login
                      </div>
                    </button>
                  </div>
                </div>

                {authMode === "password" ? (
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      placeholder="Backpage username"
                      autoComplete="off"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                    <input
                      className="input flex-1"
                      type="password"
                      placeholder="Backpage password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                ) : (
                  <label className="text-sm block">
                    <input
                      className="input w-full font-mono text-xs"
                      placeholder="dosid session cookie"
                      autoComplete="off"
                      value={dosid}
                      onChange={(e) => setDosid(e.target.value)}
                    />
                    <div className="muted text-xs mt-1">
                      Session cookies expire — the bot will ask for a fresh one
                      when it does.
                    </div>
                  </label>
                )}

                <p className="muted text-xs">
                  Sent once to the orchestrator and stored in Vault — the panel
                  never keeps credentials.
                </p>
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-3">
                <div className="font-medium text-sm">What should it do?</div>
                <div className="grid grid-cols-2 gap-2">
                  {MODULE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className={`panel p-3 text-left text-sm ${preset === p.id ? "border-sky-500" : ""}`}
                      onClick={() => {
                        setPreset(p.id);
                        setSettings({});
                      }}
                    >
                      <div className="font-semibold">{p.label}</div>
                      <div className="muted text-xs mt-0.5">{p.blurb}</div>
                    </button>
                  ))}
                </div>

                {descriptor && (
                  <>
                    <button
                      className="muted text-xs text-left hover:text-sky-300"
                      onClick={() => setAdvanced((a) => !a)}
                    >
                      {advanced ? "▾" : "▸"} Advanced ({descriptor.settings.length} settings)
                    </button>
                    {advanced && (
                      <div className="border border-[#232d47] rounded-lg p-3 flex flex-col gap-3 max-h-64 overflow-y-auto">
                        {descriptor.settings.map((s) => (
                          <label key={s.key} className="block text-sm">
                            <div className="font-medium text-xs mb-1">{s.label}</div>
                            <SettingWidget
                              desc={s}
                              value={mergedSettings[s.key]}
                              catalog={null}
                              seenNpcs={[]}
                              onChange={(v) =>
                                setSettings((cur) => ({ ...cur, [s.key]: v }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="font-medium text-sm mb-2">Network</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`panel p-3 text-left text-sm ${proxyMode === "pool" ? "border-sky-500" : ""}`}
                      onClick={() => setProxyMode("pool")}
                    >
                      <div className="font-semibold">Use a Xenomit proxy</div>
                      <div className="muted text-xs mt-0.5">
                        Residential pool — recommended
                      </div>
                    </button>
                    <button
                      className={`panel p-3 text-left text-sm ${proxyMode === "fixed" ? "border-sky-500" : ""}`}
                      onClick={() => setProxyMode("fixed")}
                    >
                      <div className="font-semibold">Bring my own proxy</div>
                      <div className="muted text-xs mt-0.5">
                        http / https / socks5
                      </div>
                    </button>
                  </div>
                </div>

                {proxyMode === "pool" ? (
                  <label className="text-sm block">
                    <div className="font-medium mb-1">Country (optional)</div>
                    <select
                      className="input w-full"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c || "any"} value={c}>
                          {c || "Any"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <select
                        className="input w-28"
                        value={pxScheme}
                        onChange={(e) => setPxScheme(e.target.value)}
                      >
                        <option value="socks5">socks5</option>
                        <option value="http">http</option>
                        <option value="https">https</option>
                      </select>
                      <input
                        className="input flex-1"
                        placeholder="host"
                        value={pxHost}
                        onChange={(e) => setPxHost(e.target.value)}
                      />
                      <input
                        className="input w-24"
                        placeholder="port"
                        inputMode="numeric"
                        value={pxPort}
                        onChange={(e) => setPxPort(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="input flex-1"
                        placeholder="username (optional)"
                        autoComplete="off"
                        value={pxUser}
                        onChange={(e) => setPxUser(e.target.value)}
                      />
                      <input
                        className="input flex-1"
                        type="password"
                        placeholder="password (optional)"
                        autoComplete="new-password"
                        value={pxPass}
                        onChange={(e) => setPxPass(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <div className="font-medium text-sm mb-2">Version</div>
                  <div className="flex gap-2 flex-wrap">
                    {(["stable", "canary", "pinned"] as const).map((c) => (
                      <button
                        key={c}
                        className={`btn ${channel === c ? "btn-primary" : ""}`}
                        onClick={() => setChannel(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {channel === "pinned" && (
                    <input
                      className="input w-full mt-2 font-mono text-xs"
                      placeholder="image digest, e.g. registry/xenomit-botd@sha256:…"
                      value={pinnedImage}
                      onChange={(e) => setPinnedImage(e.target.value)}
                    />
                  )}
                </div>

                <label className="text-sm block">
                  <div className="font-medium mb-1">Nickname (optional)</div>
                  <input
                    className="input w-full"
                    placeholder="e.g. boxbot-1"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                </label>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-3 text-sm">
                <div className="panel p-4 flex flex-col gap-1.5">
                  <Row k="Server" v={server || "—"} />
                  <Row
                    k="Sign-in"
                    v={
                      authMode === "session"
                        ? "session cookie (dosid)"
                        : `account ${username || "—"}`
                    }
                  />
                  <Row
                    k="Module"
                    v={MODULE_PRESETS.find((p) => p.id === preset)?.label ?? preset}
                  />
                  <Row
                    k="Proxy"
                    v={
                      proxyMode === "pool"
                        ? `Xenomit pool${country ? ` (${country})` : ""}`
                        : `${pxScheme}://${pxHost}:${pxPort}`
                    }
                  />
                  <Row
                    k="Version"
                    v={channel === "pinned" ? pinnedImage || "pinned" : channel}
                  />
                  <Row k="Nickname" v={nickname || "—"} />
                </div>
                <p className="muted text-xs">
                  Credentials go straight to the orchestrator&apos;s Vault — the
                  panel never stores them. Launching provisions the bot and
                  brings it up automatically.
                </p>
              </div>
            )}

            {error && <div className="text-red-400 text-sm mt-3">{error}</div>}

            <div className="flex gap-2 justify-end mt-5">
              <button className="btn" onClick={onClose} disabled={creating}>
                Cancel
              </button>
              {step > 0 && (
                <button
                  className="btn"
                  onClick={() => setStep((s) => s - 1)}
                  disabled={creating}
                >
                  Back
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button
                  className="btn btn-primary"
                  onClick={next}
                  disabled={
                    (step === 0 && !step1Ok) || (step === 2 && !step3Ok)
                  }
                >
                  Next
                </button>
              ) : (
                <button
                  className="btn btn-green"
                  onClick={submit}
                  disabled={creating}
                >
                  {creating ? "Creating…" : "Launch bot"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="muted">{k}</span>
      <span className="font-medium text-right truncate">{v}</span>
    </div>
  );
}
