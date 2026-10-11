// The Postgres schema twin must stay model-for-model identical to the SQLite
// dev schema — only the datasource/generator block may differ.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function models(schemaPath: string): string {
  const src = readFileSync(path.join(root, schemaPath), "utf8");
  const start = src.search(/^model /m);
  if (start < 0) throw new Error(`no models in ${schemaPath}`);
  // normalize line endings & trailing whitespace so only content matters
  return src
    .slice(start)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

describe("prisma schema parity (sqlite dev ↔ postgres prod)", () => {
  it("model sections are identical", () => {
    expect(models("prisma/postgres/schema.prisma")).toBe(
      models("prisma/schema.prisma")
    );
  });
});
