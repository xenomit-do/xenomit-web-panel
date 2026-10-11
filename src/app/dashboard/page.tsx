import { auth } from "../../../auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { DashboardClient } from "@/components/DashboardClient";
import { ViewSocketProvider } from "@/hooks/useViewSocket";
import { orchestratorEnabled } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [user, instances] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, status: true },
    }),
    db.instance.findMany({
      where: { userId: session.user.id, revokedAt: null },
      include: { state: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!user || user.status !== "active") redirect("/");

  return (
    <ViewSocketProvider>
      <DashboardClient
        user={session.user.name ?? "pilot"}
        admin={user.role === "admin"}
        orchestrator={orchestratorEnabled()}
        initialInstances={instances.map((i) => ({
          id: i.id,
          kind: i.kind,
          bot_id: i.botId,
          server: i.server,
          username: i.username,
          game_user_id: i.gameUserId,
          nickname: i.nickname,
          last_seen_at: i.lastSeenAt?.toISOString() ?? null,
          status: (i.state?.latestStatus ?? null) as never,
          map_name:
            (i.state?.latestFrame as { map?: { name?: string } } | null)?.map
              ?.name ?? null,
          phase: i.phase,
          phase_detail: i.phaseDetail ?? null,
          desired_state: i.desiredState,
          version: i.version,
        }))}
      />
    </ViewSocketProvider>
  );
}
