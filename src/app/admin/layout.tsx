import { requireAdmin } from "@/lib/api";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const NAV = [
  ["fleet", "Fleet"],
  ["rollouts", "Rollouts"],
  ["proxies", "Proxies"],
  ["users", "Users & invites"],
  ["audit", "Audit"],
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Role is re-read from the DB on every request (docs/08 §8.3) — demotion
  // and suspension take effect immediately.
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="border-b border-[#232d47] px-4 py-3 flex items-center gap-4">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          XENOMIT<span className="text-sky-400">·ADMIN</span>
        </Link>
        <nav className="flex gap-1 text-sm">
          {NAV.map(([href, label]) => (
            <Link
              key={href}
              href={`/admin/${href}`}
              className="px-3 py-1.5 rounded-lg muted hover:text-[#dbe4f5] hover:bg-[#151d30]"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <Link href="/dashboard" className="btn text-xs">
          ← Dashboard
        </Link>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
