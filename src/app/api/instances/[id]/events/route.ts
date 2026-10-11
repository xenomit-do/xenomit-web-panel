import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/instances/:id/events?cursor=<id>&limit=<n> — reward feed, newest first.
export async function GET(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));

  const events = await db.statEvent.findMany({
    where: { instanceId: id },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  return json({
    events: page.map((e) => ({
      id: e.id,
      at: e.at,
      source: e.source,
      message: e.message,
      rewards: e.rewards,
      balances: e.balances,
    })),
    next_cursor: hasMore ? page[page.length - 1]?.id : null,
  });
}
