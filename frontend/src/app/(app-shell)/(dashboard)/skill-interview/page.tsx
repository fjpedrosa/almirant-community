import { redirect } from "next/navigation";

export default function SkillInterviewPage() {
  redirect("/agents?tab=skills");
}
