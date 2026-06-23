import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import type { auth } from "./auth";

export const authClient = createAuthClient({
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    organizationClient(),
    inferAdditionalFields<typeof auth>(),
  ],
});
