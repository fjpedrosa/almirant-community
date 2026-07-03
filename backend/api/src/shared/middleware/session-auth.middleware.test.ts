import { describe, expect, it } from "bun:test";
import { extractTokenCandidates } from "./session-auth.middleware";

/**
 * Characterization tests for token extraction in the session-auth middleware.
 *
 * SCOPE NOTE (intentional): only the PURE `extractTokenCandidates` function is
 * unit-tested here. The `sessionAuthMiddleware` session-resolution branch runs
 * a multi-join Drizzle query (`db.select().from().innerJoin().leftJoin()...`)
 * against a real connection and is wired into an Elysia `derive` closure. Faking
 * that fluent chain faithfully is brittle and would not prove real behavior, so
 * the join-chain / session-resolution proof is DEFERRED to the live-DB
 * integration test. This file locks the security-sensitive parsing rules:
 * where a candidate token comes from and how it is normalized before it is
 * looked up in the `session` table.
 */

const makeRequest = (headers: Record<string, string>): Request =>
  new Request("http://localhost/api/anything", { headers });

describe("extractTokenCandidates", () => {
  it("extracts a token from the Authorization Bearer header", () => {
    const request = makeRequest({ authorization: "Bearer abc123" });

    expect(extractTokenCandidates(request)).toEqual(["abc123"]);
  });

  it("ignores a non-Bearer Authorization header", () => {
    const request = makeRequest({ authorization: "Basic abc123" });

    expect(extractTokenCandidates(request)).toEqual([]);
  });

  it("returns an empty list when neither header nor cookie is present", () => {
    const request = makeRequest({});

    expect(extractTokenCandidates(request)).toEqual([]);
  });

  it("reads the plain better-auth.session_token cookie", () => {
    const request = makeRequest({
      cookie: "better-auth.session_token=plaintoken",
    });

    expect(extractTokenCandidates(request)).toEqual(["plaintoken"]);
  });

  it("reads the __Host-better-auth.session_token cookie", () => {
    const request = makeRequest({
      cookie: "__Host-better-auth.session_token=hosttoken",
    });

    expect(extractTokenCandidates(request)).toEqual(["hosttoken"]);
  });

  it("reads the __Secure-better-auth.session_token cookie", () => {
    const request = makeRequest({
      cookie: "__Secure-better-auth.session_token=securetoken",
    });

    expect(extractTokenCandidates(request)).toEqual(["securetoken"]);
  });

  it("strips the '.signature' suffix from a signed cookie value", () => {
    const request = makeRequest({
      cookie: "better-auth.session_token=tok.thesignaturepart",
    });

    expect(extractTokenCandidates(request)).toEqual(["tok"]);
  });

  it("strips the '.signature' suffix from a Bearer token", () => {
    const request = makeRequest({ authorization: "Bearer tok.sigpart" });

    expect(extractTokenCandidates(request)).toEqual(["tok"]);
  });

  it("de-dupes the same token supplied via header and via signed cookie", () => {
    const request = makeRequest({
      authorization: "Bearer tok",
      cookie: "better-auth.session_token=tok.signature",
    });

    expect(extractTokenCandidates(request)).toEqual(["tok"]);
  });

  it("URL-decodes cookie values before normalizing", () => {
    // A cookie value that was percent-encoded; the '.' separator survives
    // decoding and must still split token from signature.
    const request = makeRequest({
      cookie: "better-auth.session_token=tok%2Eabc.signature",
    });

    // %2E decodes to '.', so the first dot (from %2E) is the split point.
    expect(extractTokenCandidates(request)).toEqual(["tok"]);
  });

  it("collects distinct tokens from multiple cookie variants in name order", () => {
    const request = makeRequest({
      cookie: [
        "__Host-better-auth.session_token=hosttok.sig",
        "__Secure-better-auth.session_token=securetok.sig",
        "better-auth.session_token=plaintok.sig",
      ].join("; "),
    });

    expect(extractTokenCandidates(request)).toEqual([
      "hosttok",
      "securetok",
      "plaintok",
    ]);
  });

  it("prefers the Authorization header as the first candidate over cookies", () => {
    const request = makeRequest({
      authorization: "Bearer headertok",
      cookie: "better-auth.session_token=cookietok.sig",
    });

    expect(extractTokenCandidates(request)).toEqual([
      "headertok",
      "cookietok",
    ]);
  });

  it("ignores unrelated cookies and malformed cookie segments", () => {
    const request = makeRequest({
      cookie: "theme=dark; malformed; better-auth.session_token=realtok.sig; x=y",
    });

    expect(extractTokenCandidates(request)).toEqual(["realtok"]);
  });

  it("drops empty candidates so a bare 'Bearer ' yields nothing", () => {
    const request = makeRequest({ authorization: "Bearer " });

    expect(extractTokenCandidates(request)).toEqual([]);
  });
});
