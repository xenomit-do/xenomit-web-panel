import { auth, signIn } from "../../auth";
import { redirect } from "next/navigation";
import { InviteForm } from "@/components/InviteForm";

export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) redirect("/dashboard");

  const { error } = await searchParams;
  const discordEnabled = !!process.env.AUTH_DISCORD_ID;
  const devLogin =
    process.env.DEV_LOGIN === "true" ||
    (process.env.DEV_LOGIN !== "false" && !discordEnabled);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-2xl text-center">
        <div className="text-5xl font-bold tracking-tight mb-4">
          XENOMIT<span className="text-sky-400">·PANEL</span>
        </div>
        <p className="muted text-lg mb-2">
          Control every running Xenomit instance from anywhere.
        </p>
        <p className="muted mb-10">
          Live map view, remote start/stop, schema-driven configuration and
          per-instance statistics — for all your bots, in one dashboard.
        </p>

        <div className="flex flex-col items-center gap-4">
          {error && (
            <div className="panel px-4 py-2 border-red-900 text-red-300 text-sm">
              {error === "AccessDenied"
                ? "This panel is invite-only — redeem an invite code first, or ask an admin to pre-approve your Discord account."
                : `Sign-in failed: ${error}`}
            </div>
          )}
          {discordEnabled && (
            <div className="relative flex flex-col items-center gap-2">
              <div className="muted text-xs">
                Invite-only — redeem a code, then sign in
              </div>
              <InviteForm />
            </div>
          )}
          {discordEnabled && (
            <form
              action={async () => {
                "use server";
                await signIn("discord", { redirectTo: "/dashboard" });
              }}
            >
              <button className="btn btn-primary text-base px-8 py-3" type="submit">
                Login with Discord
              </button>
            </form>
          )}
          {devLogin && (
            <form
              action={async (fd: FormData) => {
                "use server";
                await signIn("dev", {
                  username: fd.get("username") || "Dev User",
                  redirectTo: "/dashboard",
                });
              }}
              className="flex gap-2"
            >
              <input
                name="username"
                className="input"
                placeholder="dev username"
                defaultValue="Dev User"
              />
              <button className="btn" type="submit">
                Dev Login
              </button>
            </form>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-16 text-left">
          {[
            ["Live map", "Watch every instance on a real-time star map at 4 Hz."],
            ["Remote control", "Start, stop, switch modules and tune config from any device."],
            ["Multi-instance", "Aggregate rates, balances and deaths across your whole fleet."],
          ].map(([t, d]) => (
            <div key={t} className="panel p-4">
              <div className="font-semibold mb-1">{t}</div>
              <div className="muted text-sm">{d}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
