import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "../dist/http/respond.js";
import { Router } from "../dist/http/router.js";
import { tokensMatch } from "../dist/http/auth.js";

const url = (path) => new URL(path, "http://nas.local");
const noop = () => {};

describe("Router", () => {
  it("matches a literal path", () => {
    const router = new Router().get("/api/health", noop);
    assert.ok(router.match("GET", url("/api/health")));
  });

  it("is case-insensitive about the method", () => {
    const router = new Router().get("/api/health", noop);
    assert.ok(router.match("get", url("/api/health")));
  });

  it("captures named parameters", () => {
    const router = new Router().get("/api/agents/:id", noop);
    assert.deepEqual(router.match("GET", url("/api/agents/agent_42")).params, { id: "agent_42" });
  });

  it("decodes percent-encoded segments", () => {
    const router = new Router().get("/api/agents/:id", noop);
    assert.deepEqual(router.match("GET", url("/api/agents/a%20b")).params, { id: "a b" });
  });

  it("collects the remainder into the wildcard", () => {
    const router = new Router().get("/api/files/:rootId/list/*", noop);
    const matched = router.match("GET", url("/api/files/media/list/movies/2024/a.mkv"));
    assert.equal(matched.params.rootId, "media");
    assert.equal(matched.wildcard, "movies/2024/a.mkv");
  });

  it("matches a wildcard with nothing after it", () => {
    const router = new Router().get("/api/files/:rootId/list/*", noop);
    assert.equal(router.match("GET", url("/api/files/media/list/")).wildcard, "");
  });

  it("returns null when no pattern matches", () => {
    const router = new Router().get("/api/health", noop);
    assert.equal(router.match("GET", url("/api/nope")), null);
  });

  it("does not match a longer path against a shorter literal pattern", () => {
    const router = new Router().get("/api/health", noop);
    assert.equal(router.match("GET", url("/api/health/extra")), null);
  });

  it("throws 405 when the path matches but the method does not", () => {
    const router = new Router().get("/api/agents", noop);
    assert.throws(
      () => router.match("DELETE", url("/api/agents")),
      (err) => err instanceof HttpError && err.status === 405,
    );
  });

  it("prefers a real handler over a 405 when another route covers the method", () => {
    const router = new Router().get("/api/agents", noop).post("/api/agents", noop);
    assert.ok(router.match("POST", url("/api/agents")));
  });

  it("rejects invalid percent-encoding with a 400", () => {
    const router = new Router().get("/api/agents/:id", noop);
    assert.throws(
      () => router.match("GET", url("/api/agents/%E0%A4%A")),
      (err) => err instanceof HttpError && err.status === 400,
    );
  });
});

describe("tokensMatch", () => {
  it("accepts an exact match", () => {
    assert.equal(tokensMatch("s3cret-token-value", "s3cret-token-value"), true);
  });

  it("rejects a different token of the same length", () => {
    assert.equal(tokensMatch("s3cret-token-value", "s3cret-token-valuX"), false);
  });

  it("rejects a prefix of the real token", () => {
    assert.equal(tokensMatch("s3cret", "s3cret-token-value"), false);
  });

  it("rejects the empty string", () => {
    assert.equal(tokensMatch("", "s3cret-token-value"), false);
  });
});
