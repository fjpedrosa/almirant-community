"use server";

import { sendMemberRemovedEmailViaBackend } from "@/lib/auth";

export async function sendMemberRemovedEmail(args: {
  email: string;
  memberName: string;
  organizationName: string;
}): Promise<{ success: boolean }> {
  try {
    await sendMemberRemovedEmailViaBackend({
      ...args,
      removedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to send member removal email:", error);
    return { success: false };
  }
}
