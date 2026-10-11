// Hard security rule: the panel must never transport or store DarkOrbit
// session cookies. Any payload key matching a session-cookie name is stripped
// recursively before storage, relay or processing.

const FORBIDDEN_KEYS = new Set([
  "sid",
  "dosid",
  "session_id",
  "sessionid",
  "cookie",
  "cookies",
]);

export function sanitizePayload<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizePayload(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue;
    out[k] = sanitizePayload(v);
  }
  return out as T;
}

export function containsForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) return true;
    if (containsForbiddenKey(v, depth + 1)) return true;
  }
  return false;
}
