import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, normalizeConfig, PERMISSION_MODES } from "../dist/config.js";

const minimal = { server: { token: "0123456789abcdef0" }, roots: [] };

describe("normalizeConfig", () => {
  it("fills in defaults", () => {
    const config = normalizeConfig(minimal);
    assert.equal(config.server.host, "127.0.0.1");
    assert.equal(config.server.port, 7333);
    assert.equal(config.claude.bin, "claude");
    assert.equal(config.claude.permissionMode, "manual");
    assert.equal(config.claude.maxConcurrentSessions, 4);
    assert.deepEqual(config.roots, []);
  });

  it("slugifies a root id from its label when none is given", () => {
    const config = normalizeConfig({ ...minimal, roots: [{ label: "Media Library!", path: "/volume1/media" }] });
    assert.equal(config.roots[0].id, "media-library");
  });

  it("defaults a root to read-only and not a workspace", () => {
    const config = normalizeConfig({ ...minimal, roots: [{ label: "Media", path: "/volume1/media" }] });
    assert.equal(config.roots[0].readOnly, true);
    assert.equal(config.roots[0].workspace, false);
  });

  it("rejects a relative root path", () => {
    assert.throws(
      () => normalizeConfig({ ...minimal, roots: [{ label: "Rel", path: "relative/path" }] }),
      (err) => err instanceof ConfigError && /absolute/.test(err.message),
    );
  });

  it("rejects duplicate root ids", () => {
    assert.throws(
      () => normalizeConfig({
        ...minimal,
        roots: [{ label: "Media", path: "/a" }, { id: "media", label: "Other", path: "/b" }],
      }),
      (err) => err instanceof ConfigError && /duplicate/.test(err.message),
    );
  });

  it("rejects a token that is too short to be worth having", () => {
    assert.throws(
      () => normalizeConfig({ server: { token: "short" } }),
      (err) => err instanceof ConfigError && /16 characters/.test(err.message),
    );
  });

  it("accepts an empty token so `init` can generate one", () => {
    assert.equal(normalizeConfig({ server: {} }).server.token, "");
  });

  it("accepts every documented permission mode", () => {
    for (const mode of PERMISSION_MODES) {
      assert.equal(normalizeConfig({ ...minimal, claude: { permissionMode: mode } }).claude.permissionMode, mode);
    }
  });

  it("rejects an unknown permission mode", () => {
    assert.throws(
      () => normalizeConfig({ ...minimal, claude: { permissionMode: "yolo" } }),
      (err) => err instanceof ConfigError && /must be one of/.test(err.message),
    );
  });

  it("rejects a non-object root value", () => {
    assert.throws(() => normalizeConfig("nope"), (err) => err instanceof ConfigError);
    assert.throws(() => normalizeConfig({ ...minimal, roots: "nope" }), (err) => err instanceof ConfigError);
  });

  it("keeps an explicit null model as null rather than coercing it", () => {
    assert.equal(normalizeConfig({ ...minimal, claude: { model: null } }).claude.model, null);
  });
});
