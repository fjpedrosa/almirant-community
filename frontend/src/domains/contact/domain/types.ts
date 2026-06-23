export interface ContactSubmissionInput {
  email: string;
  reason: "general" | "support" | "partnership" | "feedback" | "other";
  message: string;
}

export interface ContactSubmissionResult {
  id: string;
  createdAt: string;
}
