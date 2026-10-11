// Orchestrator client contract tests — JWT shape/signature and REST call
// semantics — using an injected fetchImpl, no network needed.

import { describe, it, expect } from "vitest";
import { verify } from "crypto";
import {
  mintPanelJwt,
  orchestratorPublicKey,
  OrchestratorClient,
  OrchestratorError,
} from "@/lib/orchestrator";

function decodeJwt(token: string) {
  const [h, p, s] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    payload: JSON.parse(Buffer.from(p, "base64url").toString()),
    signature: Buffer.from(s, "base64url"),
    signed: Buffer.from(`${h}.${p}`),
  };
}

describe("mintPanelJwt — docs/04 §4.6 claims", () => {
  it("carries sub/role/act and verifies against the panel public key", () => {
    const jwt = mintPanelJwt({ sub: "user-1", role: "admin", act: "fleet:read" });
    const { header, payload, signature, signed } = decodeJwt(jwt);
    expect(header.alg).toBe("EdDSA");
    expect(payload.sub).toBe("user-1");
    expect(payload.role).toBe("admin");
    expect(payload.act).toBe("fleet:read");
    expect(payload.jti).toBeTruthy();
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(60_000);
    expect(payload.exp - payload.iat).toBeGreaterThan(0);
    expect(verify(null, signed, orchestratorPublicKey(), signature)).toBe(true);
  });

  it("produces unique jti per call", () => {
    const a = decodeJwt(mintPanelJwt({ sub: "u", role: "user", act: "*" }));
    const b = decodeJwt(mintPanelJwt({ sub: "u", role: "user", act: "*" }));
    expect(a.payload.jti).not.toBe(b.payload.jti);
  });
});

describe("OrchestratorClient — request semantics", () => {
  interface Call {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  }
  const recorder = (status = 200, body: unknown = { ok: true }) => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>).map(
            ([k, v]) => [k.toLowerCase(), String(v)]
          )
        ),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };

  it("sends a Bearer JWT and JSON body to the right path", async () => {
    const { calls, fetchImpl } = recorder(200, { id: "xnb_9" });
    const c = new OrchestratorClient({
      baseUrl: "http://orch.test",
      sub: "user-1",
      role: "user",
      fetchImpl,
    });
    const res = await c.createBot({
      name: "bot",
      owner: "user-1",
      account: { server: "int1.darkorbit.com", authMode: "password" },
      credentials: { authMode: "password", username: "u", password: "p" },
      config: { settings: { activeModule: null, modules: {} } },
    });
    expect(res.id).toBe("xnb_9");
    const call = calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe("http://orch.test/v1/bots");
    expect(call.headers.authorization).toMatch(/^Bearer .+\..+\..+/);
    const claims = decodeJwt(call.headers.authorization.slice(7)).payload;
    expect(claims.sub).toBe("user-1");
    expect(claims.role).toBe("user");
    // credentials flow through to the wire — the panel's rule is that they
    // never reach the DB/logs, not that the client strips them.
    expect(call.body).toEqual({
      name: "bot",
      owner: "user-1",
      account: { server: "int1.darkorbit.com", authMode: "password" },
      credentials: { authMode: "password", username: "u", password: "p" },
      config: { settings: { activeModule: null, modules: {} } },
    });
  });

  it("maps non-2xx to OrchestratorError with status + code", async () => {
    const { fetchImpl } = recorder(403, { error: "not owner", code: "forbidden" });
    const c = new OrchestratorClient({ sub: "u", role: "user", fetchImpl });
    await expect(c.getBot("xnb_1")).rejects.toMatchObject({
      name: "OrchestratorError",
      status: 403,
      message: "not owner",
      code: "forbidden",
    });
  });

  it("maps network failure to a 503 OrchestratorError", async () => {
    const fetchImpl = (async () => {
      throw new Error("conn refused");
    }) as typeof fetch;
    const c = new OrchestratorClient({ sub: "u", role: "user", fetchImpl });
    const e = await c.listBots().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OrchestratorError);
    expect((e as OrchestratorError).status).toBe(503);
  });

  it("forwards Last-Event-ID on the event stream", async () => {
    let seen: Record<string, string> = {};
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seen = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(
          ([k, v]) => [k.toLowerCase(), String(v)]
        )
      );
      return new Response(new ReadableStream(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    const c = new OrchestratorClient({ sub: "svc", role: "admin", fetchImpl });
    await c.openEventStream("evt-42");
    expect(seen["last-event-id"]).toBe("evt-42");
    expect(seen.accept).toBe("text/event-stream");
  });
});
