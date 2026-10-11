// Typed client for the orchestrator Admin API (docs/04 §4.6, docs/08 §8.6).
// Every call mints a short-lived (<=60 s) EdDSA JWT carrying sub/role/act.
// The panel stores no credentials: CreateBotRequest.credentials flow through
// this client in memory only — never to the DB, logs, or audit rows.

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject,
} from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import type {
  BotSnapshot,
  BotStatus,
  BotSummary,
  CreateBotRequest,
  CreateProxyRequest,
  CreateRolloutRequest,
  FleetSummary,
  PanelJwtClaims,
  PatchBotRequest,
  ProxyResource,
  Rollout,
  RolloutAction,
} from "@shared/orchestrator";

// ---------------------------------------------------------------------------
// Keys & service token
//
// Resolution order for the Ed25519 keypair:
//   1. ORCHESTRATOR_PRIVATE_KEY / ORCHESTRATOR_PUBLIC_KEY env (PEM; \n ok)
//   2. a dev keypair persisted in .orchestrator-dev.json (generated on first
//      use so `npm run dev` + `npm run mock:orch` work with zero config —
//      the mock reads the public key from the same file)
// The inbound service token (orchestrator -> panel calls) resolves likewise:
//   ORCHESTRATOR_SERVICE_TOKEN env, else the dev file's serviceToken.
// ---------------------------------------------------------------------------

const DEV_FILE = path.join(process.cwd(), ".orchestrator-dev.json");
const JWT_TTL_MS = 55_000; // stay under the 60 s contract limit

interface DevSecrets {
  privateKey: string;
  publicKey: string;
  serviceToken: string;
}

function pem(v: string): string {
  return v.includes("\\n") ? v.replace(/\\n/g, "\n") : v;
}

function loadDevSecrets(): DevSecrets {
  try {
    if (existsSync(DEV_FILE)) {
      const parsed = JSON.parse(readFileSync(DEV_FILE, "utf8")) as DevSecrets;
      if (parsed.privateKey && parsed.publicKey && parsed.serviceToken)
        return parsed;
    }
  } catch {
    /* fall through and regenerate */
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const secrets: DevSecrets = {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
    serviceToken: `xns_${randomBytes(24).toString("base64url")}`,
  };
  try {
    mkdirSync(path.dirname(DEV_FILE), { recursive: true });
    writeFileSync(DEV_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  } catch {
    /* read-only fs: secrets become per-process, which is fine for dev */
  }
  return secrets;
}

let cachedSecrets: DevSecrets | null = null;
export function panelSecrets(): DevSecrets {
  if (cachedSecrets) return cachedSecrets;
  const dev = loadDevSecrets();
  cachedSecrets = {
    privateKey: pem(process.env.ORCHESTRATOR_PRIVATE_KEY ?? dev.privateKey),
    publicKey: pem(process.env.ORCHESTRATOR_PUBLIC_KEY ?? dev.publicKey),
    serviceToken: process.env.ORCHESTRATOR_SERVICE_TOKEN ?? dev.serviceToken,
  };
  return cachedSecrets;
}

/** Test hook — reset cached secrets (e.g. after env changes). */
export function resetPanelSecrets() {
  cachedSecrets = null;
}

let cachedPrivateKey: KeyObject | null = null;
function privateKey(): KeyObject {
  return (cachedPrivateKey ??= createPrivateKey(panelSecrets().privateKey));
}

export function orchestratorPublicKey(): KeyObject {
  return createPublicKey(panelSecrets().publicKey);
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

function b64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input).toString("base64url");
}

/** Mint a short-lived EdDSA JWT for one orchestrator call (docs/04 §4.6). */
export function mintPanelJwt(claims: {
  sub: string;
  role: "user" | "admin";
  act: string;
  ttlMs?: number;
}): string {
  const now = Date.now();
  const header = b64url(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payload: PanelJwtClaims = {
    sub: claims.sub,
    role: claims.role,
    act: claims.act,
    iat: now,
    exp: now + Math.min(claims.ttlMs ?? JWT_TTL_MS, 60_000),
    jti: randomUUID(),
  };
  const body = b64url(JSON.stringify(payload));
  const sig = sign(null, Buffer.from(`${header}.${body}`), privateKey());
  return `${header}.${body}.${sig.toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OrchestratorError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

export interface OrchestratorClientOpts {
  baseUrl?: string;
  /** caller identity minted into each JWT */
  sub: string;
  role: "user" | "admin";
  act?: string;
  fetchImpl?: typeof fetch;
}

export function orchestratorEnabled(): boolean {
  return !!process.env.ORCHESTRATOR_URL || process.env.ORCHESTRATOR_MOCK === "1";
}

export function orchestratorBaseUrl(): string {
  return (process.env.ORCHESTRATOR_URL ?? "http://localhost:4010").replace(/\/$/, "");
}

/** Per-user client (role "user"): the orchestrator enforces owner == sub. */
export function orchestratorFor(user: { id: string; role?: string }, act = "*") {
  return new OrchestratorClient({
    sub: user.id,
    role: user.role === "admin" ? "admin" : "user",
    act,
  });
}

/** Service client (role "admin", sub "panel-service") for fleet-wide reads
 *  like the SSE stream and fleet summary. */
export function orchestratorService() {
  return new OrchestratorClient({ sub: "panel-service", role: "admin", act: "*" });
}

export class OrchestratorClient {
  private base: string;
  private sub: string;
  private role: "user" | "admin";
  private act: string;
  private fetchImpl: typeof fetch;

  constructor(opts: OrchestratorClientOpts) {
    this.base = (opts.baseUrl ?? orchestratorBaseUrl()).replace(/\/$/, "");
    this.sub = opts.sub;
    this.role = opts.role;
    this.act = opts.act ?? "*";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private jwt(act?: string): string {
    return mintPanelJwt({ sub: this.sub, role: this.role, act: act ?? this.act });
  }

  private async req<T>(
    method: string,
    path: string,
    opts: { body?: unknown; act?: string; headers?: Record<string, string> } = {}
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.jwt(opts.act)}`,
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(opts.headers ?? {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new OrchestratorError(
        503,
        `orchestrator unreachable: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const msg =
        (data as { error?: string } | null)?.error ??
        `orchestrator ${method} ${path} -> ${res.status}`;
      throw new OrchestratorError(
        res.status,
        msg,
        (data as { code?: string } | null)?.code
      );
    }
    return data as T;
  }

  // -------------------------------------------------------------- bots ---

  createBot(req: CreateBotRequest): Promise<{ id: string }> {
    return this.req("POST", "/v1/bots", { body: req });
  }

  listBots(owner?: string): Promise<{ bots: BotSummary[] }> {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
    return this.req("GET", `/v1/bots${q}`);
  }

  getBot(id: string): Promise<BotStatus> {
    return this.req("GET", `/v1/bots/${encodeURIComponent(id)}`);
  }

  patchBot(id: string, patch: PatchBotRequest): Promise<BotStatus> {
    return this.req("PATCH", `/v1/bots/${encodeURIComponent(id)}`, { body: patch });
  }

  setDesiredState(id: string, desiredState: PatchBotRequest["desiredState"]) {
    return this.patchBot(id, { desiredState });
  }

  deleteBot(id: string): Promise<{ ok: boolean }> {
    return this.req("DELETE", `/v1/bots/${encodeURIComponent(id)}`);
  }

  /** Graceful restart: drain at a safe point and re-arm (one call, keeps the
   *  two-step PATCH race out of the panel). Extension of docs/04 §4.6. */
  restartBot(id: string): Promise<BotStatus> {
    return this.req("POST", `/v1/bots/${encodeURIComponent(id)}/restart`);
  }

  /** Graceful drain to a clean snapshot without deleting the bot. */
  drainBot(id: string): Promise<BotStatus> {
    return this.req("POST", `/v1/bots/${encodeURIComponent(id)}/drain`);
  }

  /** Fresh session cookie for NeedsHuman(captcha|dosid_expired). Forwarded in
   *  memory only — never persisted or logged by the panel. */
  submitDosid(id: string, dosid: string): Promise<BotStatus> {
    return this.req("POST", `/v1/bots/${encodeURIComponent(id)}/dosid`, {
      body: { dosid },
    });
  }

  /** Re-entered account credentials for NeedsHuman(credentials). Same
   *  in-memory forwarding rule as submitDosid. */
  submitCredentials(
    id: string,
    creds: { username: string; password: string }
  ): Promise<BotStatus> {
    return this.req("POST", `/v1/bots/${encodeURIComponent(id)}/credentials`, {
      body: creds,
    });
  }

  listSnapshots(id: string): Promise<{ snapshots: BotSnapshot[] }> {
    return this.req("GET", `/v1/bots/${encodeURIComponent(id)}/snapshots`);
  }

  restoreSnapshot(id: string, snapshotId: string): Promise<BotStatus> {
    return this.req("POST", `/v1/bots/${encodeURIComponent(id)}/restore`, {
      body: { snapshot_id: snapshotId },
    });
  }

  // ------------------------------------------------------------- admin ---

  fleetSummary(): Promise<FleetSummary> {
    return this.req("GET", "/v1/fleet/summary");
  }

  listProxies(): Promise<{ proxies: ProxyResource[] }> {
    return this.req("GET", "/v1/proxies");
  }

  createProxy(req: CreateProxyRequest): Promise<ProxyResource> {
    return this.req("POST", "/v1/proxies", { body: req });
  }

  deleteProxy(id: string): Promise<{ ok: boolean }> {
    return this.req("DELETE", `/v1/proxies/${encodeURIComponent(id)}`);
  }

  listRollouts(): Promise<{ rollouts: Rollout[] }> {
    return this.req("GET", "/v1/rollouts");
  }

  getRollout(id: string): Promise<Rollout> {
    return this.req("GET", `/v1/rollouts/${encodeURIComponent(id)}`);
  }

  createRollout(req: CreateRolloutRequest): Promise<Rollout> {
    return this.req("POST", "/v1/rollouts", { body: req });
  }

  rolloutAction(id: string, action: RolloutAction): Promise<Rollout> {
    return this.req(
      "POST",
      `/v1/rollouts/${encodeURIComponent(id)}/${action}`
    );
  }

  /** Raw SSE stream handle (admin role). Caller owns reconnect/Last-Event-ID —
   *  see src/server/orchestrator-events.ts. */
  async openEventStream(lastEventId?: string): Promise<Response> {
    const headers: Record<string, string> = {
      accept: "text/event-stream",
      authorization: `Bearer ${this.jwt()}`,
    };
    if (lastEventId) headers["last-event-id"] = lastEventId;
    const res = await this.fetchImpl(`${this.base}/v1/events`, { headers });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new OrchestratorError(
        res.status,
        `events stream failed: ${res.status} ${text.slice(0, 200)}`
      );
    }
    return res;
  }
}
