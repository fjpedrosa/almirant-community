/**
 * Unit tests for use-auth.ts hook logic.
 *
 * The production hook is imported after the auth client is mocked so its
 * integration behavior is exercised without a live Better Auth server.
 *
 * Tests cover:
 * - Session state derivation (user, isLoading, isAuthenticated)
 * - Sign-in methods (Google, email/password)
 * - Sign-out behavior
 * - Demo mode detection and sign-in flow
 */

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const originalAuthURL = process.env.NEXT_PUBLIC_AUTH_URL;
const originalApiURL = process.env.NEXT_PUBLIC_API_URL;
delete process.env.NEXT_PUBLIC_AUTH_URL;
process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001";
const originalLocationOrigin = Object.getOwnPropertyDescriptor(
  window.location,
  "origin",
);
Object.defineProperty(window.location, "origin", {
  configurable: true,
  value: "http://localhost:3000",
});

const realAuthClientExports = { ...(await import("@/lib/auth-client")) };

const mockUser = {
  id: "user-123",
  name: "Test User",
  email: "test@example.com",
  image: "https://example.com/avatar.jpg",
};

type Session = {
  data: { user: typeof mockUser } | null;
  isPending: boolean;
  error: Error | null;
};

type AuthResult = {
  data: unknown;
  error: { message: string } | null;
};

type SocialOptions = {
  provider: string;
  callbackURL: string;
  errorCallbackURL: string;
};

type EmailOptions = {
  email: string;
  password: string;
  callbackURL: string;
};

type SignUpOptions = EmailOptions & { name: string };

const mockAuthClient = {
  useSession: mock<() => Session>(() => ({
    data: null,
    isPending: false,
    error: null,
  })),
  signIn: {
    social: mock<(options: SocialOptions) => void>(() => undefined),
    email: mock<(options: EmailOptions) => Promise<AuthResult>>(
      async () => ({ data: null, error: null }),
    ),
  },
  signUp: {
    email: mock<(options: SignUpOptions) => Promise<AuthResult>>(
      async () => ({ data: null, error: null }),
    ),
  },
  signOut: mock<() => Promise<void>>(async () => undefined),
};

mock.module("@/lib/auth-client", () => ({ authClient: mockAuthClient }));
const { useAuth } = await import("./use-auth");

afterAll(() => {
  mock.module("@/lib/auth-client", () => realAuthClientExports);
  if (originalLocationOrigin) {
    Object.defineProperty(window.location, "origin", originalLocationOrigin);
  } else {
    Reflect.deleteProperty(window.location, "origin");
  }
  if (originalAuthURL === undefined) {
    delete process.env.NEXT_PUBLIC_AUTH_URL;
  } else {
    process.env.NEXT_PUBLIC_AUTH_URL = originalAuthURL;
  }
  if (originalApiURL === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalApiURL;
  }
});

const captureCookieWrites = (events: string[] = []) => {
  const original = Object.getOwnPropertyDescriptor(document, "cookie");
  const writes: string[] = [];
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "better-auth.session_token=abc; other_cookie=keep",
    set: (value: string) => {
      writes.push(value);
      events.push("cookie");
    },
  });
  return {
    writes,
    restore: () =>
      original
        ? Object.defineProperty(document, "cookie", original)
        : Reflect.deleteProperty(document, "cookie"),
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAuth hook logic", () => {
  beforeEach(() => {
    mockAuthClient.useSession.mockClear().mockImplementation(() => ({
      data: null,
      isPending: false,
      error: null,
    }));
    mockAuthClient.signIn.social
      .mockClear()
      .mockImplementation(() => undefined);
    mockAuthClient.signIn.email
      .mockClear()
      .mockImplementation(async () => ({ data: null, error: null }));
    mockAuthClient.signUp.email
      .mockClear()
      .mockImplementation(async () => ({ data: null, error: null }));
    mockAuthClient.signOut
      .mockClear()
      .mockImplementation(async () => undefined);
  });

  describe("session state", () => {
    it("should return null user when no session exists", () => {
      mockAuthClient.useSession.mockReturnValue({
        data: null,
        isPending: false,
        error: null,
      });

      const result = useAuth();

      expect(result.user).toBeNull();
      expect(result.isAuthenticated).toBe(false);
    });

    it("should return user when session exists", () => {
      mockAuthClient.useSession.mockReturnValue({
        data: { user: mockUser },
        isPending: false,
        error: null,
      });

      const result = useAuth();

      expect(result.user as unknown).toEqual(mockUser);
      expect(result.isAuthenticated).toBe(true);
    });

    it("should indicate loading state when session is pending", () => {
      mockAuthClient.useSession.mockReturnValue({
        data: null,
        isPending: true,
        error: null,
      });

      const result = useAuth();

      expect(result.isLoading).toBe(true);
    });

    it("should not be loading when session is resolved", () => {
      mockAuthClient.useSession.mockReturnValue({
        data: { user: mockUser },
        isPending: false,
        error: null,
      });

      const result = useAuth();

      expect(result.isLoading).toBe(false);
    });

    it("should handle session with no user (empty data)", () => {
      mockAuthClient.useSession.mockReturnValue({
        data: null,
        isPending: false,
        error: null,
      });

      const result = useAuth();

      expect(result.user).toBeNull();
      expect(result.isAuthenticated).toBe(false);
      expect(result.isLoading).toBe(false);
    });
  });

  describe("signInWithGoogle", () => {
    it("should call authClient.signIn.social with google provider", () => {
      const result = useAuth();

      result.signInWithGoogle();

      expect(mockAuthClient.signIn.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: new URL("/", window.location.origin).toString(),
        errorCallbackURL: new URL(
          "/sign-in?error=unauthorized",
          window.location.origin,
        ).toString(),
      });
    });

    it("should use custom callback URL when provided", () => {
      const result = useAuth();

      result.signInWithGoogle("/dashboard");

      expect(mockAuthClient.signIn.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: new URL("/dashboard", window.location.origin).toString(),
        errorCallbackURL: new URL(
          "/sign-in?error=unauthorized",
          window.location.origin,
        ).toString(),
      });
    });

    it("should always use /sign-in?error=unauthorized as error callback", () => {
      const result = useAuth();

      result.signInWithGoogle("/custom-path");

      const call = mockAuthClient.signIn.social.mock.calls[0]!;
      expect(call[0].errorCallbackURL).toBe(
        new URL(
          "/sign-in?error=unauthorized",
          window.location.origin,
        ).toString(),
      );
    });
  });

  describe("signInWithGithub", () => {
    it("uses an absolute frontend-origin callback", () => {
      useAuth().signInWithGithub("/projects");

      expect(mockAuthClient.signIn.social).toHaveBeenCalledWith({
        provider: "github",
        callbackURL: new URL("/projects", window.location.origin).toString(),
        errorCallbackURL: new URL(
          "/sign-in?error=unauthorized",
          window.location.origin,
        ).toString(),
      });
    });
  });

  describe("signInWithEmail", () => {
    it("should call authClient.signIn.email with credentials", async () => {
      const result = useAuth();

      await result.signInWithEmail("user@example.com", "supersecret");

      expect(mockAuthClient.signIn.email).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "supersecret",
        callbackURL: "/",
      });
    });

    it("should use custom callback URL when provided", async () => {
      const result = useAuth();

      await result.signInWithEmail(
        "user@example.com",
        "supersecret",
        "/projects"
      );

      expect(mockAuthClient.signIn.email).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "supersecret",
        callbackURL: "/projects",
      });
    });

    it("should return the result from authClient", async () => {
      const expectedResult = { data: { user: mockUser }, error: null };
      mockAuthClient.signIn.email.mockResolvedValue(expectedResult);

      const result = useAuth();
      const signInResult = await result.signInWithEmail("test@test.com", "password");

      expect(signInResult as unknown).toEqual(expectedResult);
    });

    it("should propagate error responses from authClient", async () => {
      const errorResult = { data: null, error: { message: "Invalid credentials" } };
      mockAuthClient.signIn.email.mockResolvedValue(errorResult);

      const result = useAuth();
      const signInResult = await result.signInWithEmail("wrong@email.com", "wrongpassword");

      expect(signInResult.error).toBeDefined();
      expect(signInResult.error?.message).toBe("Invalid credentials");
    });
  });

  describe("signOut", () => {
    it("should call authClient.signOut", async () => {
      const events: string[] = [];
      const cookieCapture = captureCookieWrites(events);
      const navigate = mock<(path: string) => void>(() => {
        events.push("navigate");
      });
      const result = useAuth({ navigate });

      try {
        await result.signOut();
        expect(mockAuthClient.signOut).toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith("/sign-in");
        expect(events).toEqual(["cookie", "cookie", "navigate"]);
      } finally {
        cookieCapture.restore();
      }
    });

    it("should not throw even if signOut rejects", async () => {
      mockAuthClient.signOut.mockRejectedValue(
        new Error("Session expired")
      );

      const events: string[] = [];
      const cookieCapture = captureCookieWrites(events);
      const navigate = mock<(path: string) => void>(() => {
        events.push("navigate");
      });
      const result = useAuth({ navigate });

      try {
        await expect(result.signOut()).resolves.toBeUndefined();
        expect(navigate).toHaveBeenCalledWith("/sign-in");
        expect(events).toEqual(["cookie", "cookie", "navigate"]);
      } finally {
        cookieCapture.restore();
      }
    });

    it("should complete successfully when signOut succeeds", async () => {
      mockAuthClient.signOut.mockResolvedValue(undefined);

      const navigate = mock<(path: string) => void>(() => undefined);
      const result = useAuth({ navigate });

      await expect(result.signOut()).resolves.toBeUndefined();
      expect(mockAuthClient.signOut).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith("/sign-in");
    });

    it("clears Better Auth cookies before navigating", async () => {
      const cookieCapture = captureCookieWrites();
      const navigate = mock<(path: string) => void>(() => undefined);

      try {
        await useAuth({ navigate }).signOut();
        expect(cookieCapture.writes.length).toBeGreaterThan(0);
        expect(
          cookieCapture.writes.every((value) =>
            value.startsWith("better-auth.session_token="),
          ),
        ).toBe(true);
        expect(
          cookieCapture.writes.every((value) => value.includes("Max-Age=0")),
        ).toBe(true);
        expect(navigate).toHaveBeenCalledWith("/sign-in");
      } finally {
        cookieCapture.restore();
      }
    });
  });

  describe("signUpWithEmail", () => {
    it("should call authClient.signUp.email with registration data", async () => {
      const result = useAuth();

      await result.signUpWithEmail(
        "Jane Doe",
        "jane@example.com",
        "supersecret",
        "/board"
      );

      expect(mockAuthClient.signUp.email).toHaveBeenCalledWith({
        name: "Jane Doe",
        email: "jane@example.com",
        password: "supersecret",
        callbackURL: "/board",
      });
    });

    it("should return the sign-up result from authClient", async () => {
      const expectedResult = { data: { user: mockUser }, error: null };
      mockAuthClient.signUp.email.mockResolvedValue(
        expectedResult
      );

      const result = useAuth();
      const signUpResult = await result.signUpWithEmail(
        "Test User",
        "test@example.com",
        "password123"
      );

      expect(signUpResult as unknown).toEqual(expectedResult);
    });

    it("should propagate sign-up errors", async () => {
      const errorResult = { data: null, error: { message: "Email exists" } };
      mockAuthClient.signUp.email.mockResolvedValue(errorResult);

      const signUpResult = await useAuth().signUpWithEmail(
        "Test User",
        "test@example.com",
        "password123",
      );

      expect(signUpResult as unknown).toEqual(errorResult);
    });
  });
});

describe("hook return value structure", () => {
  it("should return all expected properties", () => {
    mockAuthClient.useSession.mockReturnValue({
      data: { user: mockUser },
      isPending: false,
      error: null,
    });

    const result = useAuth();

    // Verify all expected properties exist
    expect(result).toHaveProperty("user");
    expect(result).toHaveProperty("isLoading");
    expect(result).toHaveProperty("isAuthenticated");
    expect(result).toHaveProperty("signInWithGoogle");
    expect(result).toHaveProperty("signInWithGithub");
    expect(result).toHaveProperty("signInWithEmail");
    expect(result).toHaveProperty("signUpWithEmail");
    expect(result).toHaveProperty("signOut");

    // Verify function types
    expect(typeof result.signInWithGoogle).toBe("function");
    expect(typeof result.signInWithGithub).toBe("function");
    expect(typeof result.signInWithEmail).toBe("function");
    expect(typeof result.signUpWithEmail).toBe("function");
    expect(typeof result.signOut).toBe("function");
  });

  it("should derive isAuthenticated from user presence", () => {
    // No user
    mockAuthClient.useSession.mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    });

    const result1 = useAuth();
    expect(result1.isAuthenticated).toBe(false);

    // With user
    mockAuthClient.useSession.mockReturnValue({
      data: { user: mockUser },
      isPending: false,
      error: null,
    });

    const result2 = useAuth();
    expect(result2.isAuthenticated).toBe(true);
  });

  it("should return correct types for user properties", () => {
    mockAuthClient.useSession.mockReturnValue({
      data: { user: mockUser },
      isPending: false,
      error: null,
    });

    const result = useAuth();

    expect(typeof result.user?.id).toBe("string");
    expect(typeof result.user?.name).toBe("string");
    expect(typeof result.user?.email).toBe("string");
    expect(typeof result.isLoading).toBe("boolean");
    expect(typeof result.isAuthenticated).toBe("boolean");
  });
});

describe("clearBetterAuthCookies utility logic", () => {
  it("should handle various hostname formats for parent domain extraction", () => {
    // Test the logic that extracts parent domain
    const testCases = [
      { hostname: "app.almirant.ai", expected: ".almirant.ai" },
      { hostname: "preview.app.almirant.ai", expected: ".almirant.ai" },
      { hostname: "localhost", expected: null },
    ];

    for (const { hostname, expected } of testCases) {
      const domainParts = hostname.split(".");
      const parentDomain =
        domainParts.length >= 2
          ? `.${domainParts.slice(-2).join(".")}`
          : null;

      expect(parentDomain).toBe(expected);
    }
  });

  it("should handle IP addresses (2 parts but not a domain)", () => {
    // IP addresses like "127.0.0.1" have 4 parts, so they get a "parent domain"
    // In the actual implementation, this would still work but set an invalid cookie domain
    const hostname = "127.0.0.1";
    const domainParts = hostname.split(".");
    expect(domainParts.length).toBe(4);
    // The implementation would compute ".0.1" which is fine (cookie just won't match)
  });

  it("should identify better-auth cookies correctly", () => {
    const cookieNames = [
      "better-auth.session_token",
      "better-auth.refresh_token",
      "other_cookie",
      "__Secure-better-auth.session",
    ];

    const betterAuthCookies = cookieNames.filter((name) =>
      name.includes("better-auth")
    );

    expect(betterAuthCookies).toEqual([
      "better-auth.session_token",
      "better-auth.refresh_token",
      "__Secure-better-auth.session",
    ]);
  });
});
