// Orchestrator Admin API contract (docs/04 §4.6) — the typed surface shared
// by src/lib/orchestrator.ts (client), mock-orchestrator/ (in-repo fake) and
// tests. Auth on every call is a short-lived EdDSA JWT minted by the panel:
//   { sub: <panel user id | "panel-service">, role: "user"|"admin",
//     act: <panel instance id | "*">, iat, exp (<=60s), jti }
// The orchestrator enforces owner == sub for non-admin callers.

// ---------------------------------------------------------------------------
// JWT claims
// ---------------------------------------------------------------------------

export interface PanelJwtClaims {
  sub: string;
  role: "user" | "admin";
  act: string;
  iat: number;
  exp: number;
  jti?: string;
}

// ---------------------------------------------------------------------------
// Bot spec / status (mirrors the XenomitBot CR in docs/04 §4.1)
// ---------------------------------------------------------------------------

export type DesiredState = "Running" | "Paused" | "Stopped";

export type BotPhase =
  | "Pending"
  | "Provisioning"
  | "Armed"
  | "Starting"
  | "Running"
  | "Draining"
  | "Paused"
  | "Stopped"
  | "NeedsHuman"
  | "NeedsUpdate"
  | "Quarantined"
  | "Terminating"
  | "Terminated"
  | "Failed"
  | string; // forward-compatible: unknown phases must still render

export interface AccountSpec {
  server: string;
  authMode: "password" | "session";
}

export interface VersionSpec {
  channel: "stable" | "canary" | "pinned";
  pinnedImage?: string | null;
}

export interface ProxySelector {
  country?: string[];
  tags?: string[];
}

export type ProxySpec =
  | { mode: "pool"; selector?: ProxySelector; fixedVaultPath?: null }
  | {
      mode: "fixed";
      selector?: null;
      // Inline proxy material — forwarded to the orchestrator, which moves it
      // to Vault and never echoes it back. Never persisted by the panel.
      fixed: { scheme: "http" | "https" | "socks5"; host: string; port: number; username?: string; password?: string };
    };

export interface BotConfigSpec {
  clientKind?: "packet" | "ruffle" | "flash";
  settings: { activeModule: string | null; modules: Record<string, Record<string, unknown>> };
}

/** Credentials are accepted only inside POST /v1/bots — the orchestrator
 *  writes them to Vault and never stores or returns them in plain form. */
export type BotCredentials =
  | { authMode: "password"; username: string; password: string }
  | { authMode: "session"; dosid: string };

export interface CreateBotRequest {
  owner: string; // panel user id — must equal JWT sub unless role=admin
  name?: string;
  desiredState?: DesiredState; // default Running
  account: AccountSpec;
  credentials: BotCredentials;
  config: BotConfigSpec;
  version?: VersionSpec;
  proxy?: ProxySpec;
  restorePolicy?: "best_effort" | "strict";
}

export interface BotCondition {
  type: string; // Ready | SnapshotRestored | ProxyHealthy | ConfigValid | …
  status: boolean;
  detail?: string;
  since?: string;
}

export interface BotSnapshot {
  id: string;
  at: string;
  kind: "clean" | "degraded" | "checkpoint";
  sizeBytes?: number;
  note?: string;
}

export interface BotStatus {
  id: string; // bot-…
  owner: string;
  name?: string;
  desiredState: DesiredState;
  phase: BotPhase;
  phaseDetail?: {
    kind?: string; // NeedsHuman: captcha | credentials | dosid_expired | update
    message?: string;
    [k: string]: unknown;
  } | null;
  epoch: number;
  podName?: string | null;
  node?: string | null;
  image?: string | null;
  version?: string | null;
  proxyRef?: string | null;
  proxyExitIp?: string | null;
  account?: { server: string; authMode: "password" | "session" };
  configRevision?: number;
  uptimeSeconds?: number;
  offlineSeconds?: number;
  lastExit?: { code: number; at: string; reason?: string } | null;
  lastSnapshotId?: string | null;
  conditions?: BotCondition[];
  timeline?: { phase: BotPhase; at: string; detail?: unknown }[];
  createdAt: string;
}

export interface BotSummary {
  id: string;
  owner: string;
  name?: string;
  desiredState: DesiredState;
  phase: BotPhase;
  version?: string | null;
  node?: string | null;
  proxyRef?: string | null;
  uptimeSeconds?: number;
  offlineSeconds?: number;
  createdAt: string;
}

export interface PatchBotRequest {
  desiredState?: DesiredState;
  config?: BotConfigSpec;
  version?: VersionSpec;
  proxy?: ProxySpec;
}

export interface FleetSummary {
  total: number;
  byPhase: Record<string, number>;
  byVersion: Record<string, number>;
  offlineSeconds: number;
  needsHuman: number;
  needsUpdate: number;
  quota?: Record<string, { used: number; limit: number | null }>;
}

// ---------------------------------------------------------------------------
// Rollouts (docs/04 §4.6: POST/GET /v1/rollouts[/{id}], pause|resume|abort|rollback)
// ---------------------------------------------------------------------------

export interface RolloutSelector {
  phases?: string[];
  versions?: string[];
}

export interface Rollout {
  id: string;
  image: string; // target image digest/tag
  selector?: RolloutSelector;
  canary?: string[]; // bot ids that go first
  wave?: { size?: number; waitSeconds?: number };
  status: "running" | "paused" | "done" | "aborted" | "rolled_back";
  progress: {
    total: number;
    done: number;
    failed: number;
    currentWave: number;
  };
  createdBy: string;
  createdAt: string;
}

export interface CreateRolloutRequest {
  image: string;
  selector?: RolloutSelector;
  canary?: string[];
  wave?: { size?: number; waitSeconds?: number };
}

export type RolloutAction = "pause" | "resume" | "abort" | "rollback";

// ---------------------------------------------------------------------------
// Proxies (docs/04 §4.1 Proxy CR — pool CRUD used by the admin console)
// ---------------------------------------------------------------------------

export interface ProxyResource {
  id: string;
  scheme: "http" | "https" | "socks5";
  host: string;
  port: number;
  country?: string | null;
  tags?: string[];
  capacity: number;
  assigned: number;
  healthy: boolean;
  exitIp?: string | null;
  createdAt: string;
}

export interface CreateProxyRequest {
  scheme: "http" | "https" | "socks5";
  host: string;
  port: number;
  country?: string;
  tags?: string[];
  capacity?: number;
  username?: string; // → Vault, never returned
  password?: string;
}

// ---------------------------------------------------------------------------
// SSE lifecycle stream (docs/04 §4.6: GET /v1/events)
// ---------------------------------------------------------------------------

export interface BotEvent {
  id: number; // SSE id — send as Last-Event-ID on reconnect
  at: string;
  botId: string;
  owner: string;
  type: "phase" | "desired_state" | "snapshot" | "exit" | "deleted" | "created";
  phase?: BotPhase;
  desiredState?: DesiredState;
  detail?: unknown;
  epoch?: number;
  version?: string | null;
}

// ---------------------------------------------------------------------------
// Panel-side service endpoint (docs/08 §8.6): the orchestrator calls
// POST /api/orchestrator/instances to mint Instance + agent token in one step.
// ---------------------------------------------------------------------------

export interface ProvisionInstanceRequest {
  bot_id: string;
  owner: string; // panel user id
  server?: string;
  username?: string;
  desired_state?: DesiredState;
}

export interface ProvisionInstanceResponse {
  instance_id: string;
  token: string; // shown once
  agent_ws_url: string;
}
