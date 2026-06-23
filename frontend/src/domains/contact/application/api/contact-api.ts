"use client";

import { API_BASE } from "@/lib/api/client";
import type {
  ContactSubmissionInput,
  ContactSubmissionResult,
} from "../../domain/types";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const contactRequest = async <T>(
  endpoint: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(`${API_BASE}/contact${endpoint}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.success) {
    throw new Error(payload.error || "Contact request failed");
  }

  return payload.data as T;
};

export const contactApi = {
  submit: (input: ContactSubmissionInput) =>
    contactRequest<ContactSubmissionResult>("/submit", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
