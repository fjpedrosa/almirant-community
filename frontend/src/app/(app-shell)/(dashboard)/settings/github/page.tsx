import { redirect } from "next/navigation";

export default function GithubSettingsPage() {
  redirect("/settings/code-providers");
}
