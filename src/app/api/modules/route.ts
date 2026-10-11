import { requireUser, json, err } from "@/lib/api";
import {
  MODULE_PRESETS,
  PRESET_DESCRIPTORS,
  KNOWN_SERVERS,
} from "@shared/module-presets";

// GET /api/modules — module presets + their descriptors for the Create-bot
// wizard's Advanced section (docs/08 §8.4). The bot's hello-published
// descriptors remain authoritative once it connects.
export async function GET() {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  return json({
    presets: MODULE_PRESETS,
    descriptors: PRESET_DESCRIPTORS,
    servers: KNOWN_SERVERS,
    orchestrator: !!process.env.ORCHESTRATOR_URL || process.env.ORCHESTRATOR_MOCK === "1",
  });
}
