import { execSync } from "child_process";
import { rmSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(root, "..", "prisma", "test.db");

export default function setup() {
  if (existsSync(dbPath)) rmSync(dbPath);
  execSync("prisma db push --skip-generate --force-reset", {
    cwd: path.join(root, ".."),
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
