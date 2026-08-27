import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { describeAbsolute, findRoot, isInside, PathError, resolveWithinRoot } from "../dist/core/paths.js";

let base;
let root;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "homespace-paths-"));
  await fs.mkdir(join(base, "share", "nested"), { recursive: true });
  await fs.mkdir(join(base, "outside"), { recursive: true });
  await fs.writeFile(join(base, "share", "nested", "file.txt"), "ok");
  await fs.writeFile(join(base, "outside", "secret.txt"), "no");
  await symlink(join(base, "outside"), join(base, "share", "escape"), "dir");
  await symlink(join(base, "outside", "secret.txt"), join(base, "share", "leak.txt"));
  root = { id: "share", label: "Share", path: join(base, "share"), workspace: true, readOnly: false };
});

after(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe("isInside", () => {
  it("accepts the parent itself and any descendant", () => {
    assert.equal(isInside("/a/b", "/a/b"), true);
    assert.equal(isInside("/a/b", "/a/b/c/d"), true);
  });

  it("rejects siblings and ancestors", () => {
    assert.equal(isInside("/a/b", "/a/bc"), false);
    assert.equal(isInside("/a/b", "/a"), false);
    assert.equal(isInside("/a/b", "/a/b/../c"), false);
  });
});

describe("resolveWithinRoot", () => {
  it("resolves a normal relative path", async () => {
    const result = await resolveWithinRoot(root, "nested/file.txt");
    assert.equal(result.relative, "nested/file.txt");
    assert.equal(result.absolute, join(base, "share", "nested", "file.txt"));
  });

  it("treats an empty path as the root itself", async () => {
    const result = await resolveWithinRoot(root, "");
    assert.equal(result.relative, "");
    assert.equal(result.absolute, resolve(root.path));
  });

  it("strips leading slashes rather than treating the path as absolute", async () => {
    const result = await resolveWithinRoot(root, "///nested/file.txt");
    assert.equal(result.relative, "nested/file.txt");
  });

  it("rejects lexical traversal", async () => {
    await assert.rejects(
      () => resolveWithinRoot(root, "../outside/secret.txt"),
      (err) => err instanceof PathError && err.status === 403,
    );
  });

  it("rejects traversal buried mid-path", async () => {
    await assert.rejects(
      () => resolveWithinRoot(root, "nested/../../outside/secret.txt"),
      (err) => err instanceof PathError && err.status === 403,
    );
  });

  it("rejects a symlinked directory that points outside the root", async () => {
    await assert.rejects(
      () => resolveWithinRoot(root, "escape/secret.txt"),
      (err) => err instanceof PathError && /symlink/.test(err.message),
    );
  });

  it("rejects a symlinked file that points outside the root", async () => {
    await assert.rejects(
      () => resolveWithinRoot(root, "leak.txt"),
      (err) => err instanceof PathError && /symlink/.test(err.message),
    );
  });

  it("rejects a null byte", async () => {
    await assert.rejects(
      () => resolveWithinRoot(root, "nested/file\0.txt"),
      (err) => err instanceof PathError && err.status === 400,
    );
  });

  it("allows a path that does not exist yet, so long as its ancestors are inside", async () => {
    const result = await resolveWithinRoot(root, "nested/brand-new.txt");
    assert.equal(result.relative, "nested/brand-new.txt");
  });

  it("still rejects a not-yet-existing path under a symlinked ancestor", async () => {
    await assert.rejects(
      () => resolveWithinRoot(root, "escape/brand-new.txt"),
      (err) => err instanceof PathError,
    );
  });
});

describe("findRoot", () => {
  it("returns the matching root", () => {
    assert.equal(findRoot([root], "share").id, "share");
  });

  it("throws 404 for an unknown id", () => {
    assert.throws(() => findRoot([root], "nope"), (err) => err instanceof PathError && err.status === 404);
  });
});

describe("describeAbsolute", () => {
  it("maps an absolute path back to a root-relative reference", () => {
    const described = describeAbsolute([root], join(base, "share", "nested", "file.txt"));
    assert.deepEqual(described, { rootId: "share", path: "nested/file.txt" });
  });

  it("returns null for a path under no root", () => {
    assert.equal(describeAbsolute([root], join(base, "outside", "secret.txt")), null);
  });
});
