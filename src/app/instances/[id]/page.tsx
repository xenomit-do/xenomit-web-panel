import { auth } from "../../../../auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { InstanceClient } from "@/components/InstanceClient";
import { ViewSocketProvider } from "@/hooks/useViewSocket";

export const dynamic = "force-dynamic";

export default async function InstancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const { id } = await params;

  const inst = await db.instance.findFirst({
    where: { id, userId: session.user.id, revokedAt: null },
    include: { state: true },
  });
  if (!inst) notFound();

  return (
    <ViewSocketProvider>
      <InstanceClient
        instance={{
          id: inst.id,
          kind: inst.kind,
          bot_id: inst.botId,
          server: inst.server,
          username: inst.username,
          nickname: inst.nickname,
          last_seen_at: inst.lastSeenAt?.toISOString() ?? null,
          phase: inst.phase,
          phase_detail: inst.phaseDetail ?? null,
          desired_state: inst.desiredState,
          version: inst.version,
        }}
      />
    </ViewSocketProvider>
  );
}
