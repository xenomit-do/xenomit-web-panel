import { auth } from "../../../auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import Link from "next/link";
import { AccountClient } from "@/components/AccountClient";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [user, instances] = await Promise.all([
    db.user.findUnique({ where: { id: session.user.id } }),
    db.instance.findMany({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="flex items-center gap-3 mb-8">
        <Link href="/dashboard" className="btn text-xs px-2 py-1">←</Link>
        <h1 className="text-2xl font-bold">Account</h1>
      </header>

      <div className="panel p-5 mb-6 flex items-center gap-4">
        {session.user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.user.image} alt="" className="w-14 h-14 rounded-full" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-[#1a2338] flex items-center justify-center text-xl">
            {(session.user.name ?? "?")[0].toUpperCase()}
          </div>
        )}
        <div>
          <div className="font-semibold text-lg">{session.user.name}</div>
          <div className="muted text-sm">
            {session.user.provider === "discord" ? "Discord" : "Dev"} account ·{" "}
            plan <b>{user?.plan ?? "free"}</b> ·{" "}
            {instances.length}/{user?.instanceLimit ?? 8} instances
          </div>
        </div>
      </div>

      <AccountClient
        instances={instances.map((i) => ({
          id: i.id,
          server: i.server,
          username: i.username,
          nickname: i.nickname,
          created_at: i.createdAt.toISOString(),
          last_seen_at: i.lastSeenAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
