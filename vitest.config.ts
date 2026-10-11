import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";
import { generateKeyPairSync } from "crypto";

const root = path.dirname(fileURLToPath(import.meta.url));

// Throwaway Ed25519 pair so tests exercise the real JWT/service-token paths
// without touching .orchestrator-dev.json on disk.
const orchKeys = generateKeyPairSync("ed25519");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@shared": path.resolve(root, "shared"),
    },
  },
  test: {
    env: {
      DATABASE_URL: "file:./test.db",
      AUTH_SECRET: "test-secret-for-vitest",
      ORCHESTRATOR_PRIVATE_KEY: orchKeys.privateKey.export({
        type: "pkcs8",
        format: "pem",
      }) as string,
      ORCHESTRATOR_PUBLIC_KEY: orchKeys.publicKey.export({
        type: "spki",
        format: "pem",
      }) as string,
      ORCHESTRATOR_SERVICE_TOKEN: "test-service-token-vitest",
    },
    globalSetup: "./tests/globalSetup.ts",
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
