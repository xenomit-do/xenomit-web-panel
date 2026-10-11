import { AdminBotClient } from "@/components/admin/AdminBotClient";

export default async function AdminBotPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  return <AdminBotClient botId={decodeURIComponent(botId)} />;
}
