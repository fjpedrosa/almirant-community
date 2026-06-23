import { redirect } from "next/navigation";

export default function VercelSettingsPage() {
  redirect("/settings/integrations?provider=vercel");
}
