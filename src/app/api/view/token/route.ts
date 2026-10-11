import { requireUser, json, err } from "@/lib/api";
import { mintViewTicket } from "@/lib/viewticket";

// POST /api/view/token — mint a short-lived viewer ticket for the session user.
export async function POST() {
  const user = await requireUser();
  if (!user) return err(401, "unauthorized");
  return json({ ticket: mintViewTicket(user.id), expires_in_s: 60 });
}
