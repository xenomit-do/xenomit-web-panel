import { db } from "@/lib/db";
import { requireUser, ownedInstance, json, err } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const RANGES: Record<string, number> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
};
const MAX_POINTS = 600;

// GET /api/instances/:id/stats?range=1h|24h|7d|30d&metric=credits|uridium|honor|experience
export async function GET(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  const { id } = await ctx.params;
  const inst = await ownedInstance(user.id, id);
  if (!inst) return err(404, "instance not found");

  const url = new URL(req.url);
  const range = RANGES[url.searchParams.get("range") ?? "1h"] ?? RANGES["1h"];
  const metric = url.searchParams.get("metric") ?? "all";
  const since = new Date(Date.now() - range);

  const events = await db.statEvent.findMany({
    where: { instanceId: id, at: { gte: since } },
    orderBy: { at: "asc" },
    take: 100_000,
    select: { at: true, rewards: true, balances: true, source: true },
  });

  // Downsample to <= MAX_POINTS buckets, keeping the latest balance per bucket.
  const bucketMs = Math.max(1, Math.floor(range / MAX_POINTS));
  const buckets = new Map<number, { at: number; rewards: number[]; balances: number[]; count: number }>();
  for (const e of events) {
    const key = Math.floor(e.at.getTime() / bucketMs);
    const b = buckets.get(key) ?? {
      at: key * bucketMs,
      rewards: [0, 0, 0, 0],
      balances: [0, 0, 0, 0],
      count: 0,
    };
    const rw = e.rewards as number[];
    const bl = e.balances as number[];
    for (let i = 0; i < 4; i++) {
      b.rewards[i] += rw[i] ?? 0;
      b.balances[i] = bl[i] ?? b.balances[i]; // last writer wins
    }
    b.count++;
    buckets.set(key, b);
  }

  return json({
    range: url.searchParams.get("range") ?? "1h",
    metric,
    event_count: events.length,
    points: [...buckets.values()]
      .sort((a, b) => a.at - b.at)
      .map((b) => ({ at: b.at, rewards: b.rewards, balances: b.balances, events: b.count })),
  });
}
