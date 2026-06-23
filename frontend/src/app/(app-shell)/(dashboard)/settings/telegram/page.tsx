import { redirect } from "next/navigation";

export default function SettingsTelegramPage() {
  redirect("/settings/integrations?provider=discord");
}
