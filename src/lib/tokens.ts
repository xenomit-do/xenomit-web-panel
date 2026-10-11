import { createHash, randomBytes } from "crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Generate an opaque instance token. Shown to the user/agent exactly once. */
export function newInstanceToken(): string {
  return `xnt_${randomBytes(24).toString("base64url")}`;
}

/** Short, human-typable pairing code (unambiguous alphabet). */
export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return code.slice(0, 4) + "-" + code.slice(4);
}
