import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";
import { hub } from "@/server/hub";
import type { ModuleDescriptor } from "@shared/protocol";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/instances/:id/config — ModuleDescriptors + current config.
export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");

  const [catalog, configs, state] = await Promise.all([
    db.moduleCatalog.findUnique({ where: { instanceId: id } }),
    db.config.findMany({ where: { instanceId: id } }),
    db.instanceState.findUnique({ where: { instanceId: id } }),
  ]);

  const activeModule =
    (state?.latestStatus as { module_id?: string } | null)?.module_id ?? null;

  return json({
    online: hub.isOnline(id),
    modules: (catalog?.descriptors as ModuleDescriptor[] | null) ?? [],
    config: {
      active_module: activeModule,
      modules: Object.fromEntries(configs.map((c) => [c.moduleId, c.settings])),
    },
    catalog: state?.latestCatalog ?? null,
  });
}
