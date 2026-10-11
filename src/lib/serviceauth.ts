// Inbound service auth for orchestrator -> panel calls (docs/08 §8.6).
// Production pairs this with mTLS at the edge; the bearer token stays as the
// application-layer check either way.

import { timingSafeEqual } from "crypto";
import { panelSecrets } from "./orchestrator";

export function verifyServiceAuth(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  const expect = panelSecrets().serviceToken;
  const a = Buffer.from(token);
  const b = Buffer.from(expect);
  return a.length === b.length && timingSafeEqual(a, b);
}
