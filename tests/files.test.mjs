import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { classify, list, parseRange, read, search, TEXT_PREVIEW_LIMIT } from "../dist/services/files.js";
import { PathError } from "../dist/core/paths.js";

let base;
let root;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "homespace-files-"));
  await fs.mkdir(join(base, "docs"), { recursive: true });
  await fs.mkdir(join(base, "docs", "deep"), { recursive: true });
  await fs.writeFile(join(base, "readme.md"), "# Title\n");
  await fs.writeFile(join(base, ".hidden"), "shh");
  await fs.writeFile(join(base, "docs", "notes.txt"), "note body");
  await fs.writeFile(join(base, "docs", "deep", "buried-report.txt"), "deep");
  await fs.writeFile(join(base, "blob.log"), Buffer.from([0x00, 0x01, 0x02, 0x41]));
  await fs.writeFile(join(base, "huge.txt"), "x".repeat(TEXT_PREVIEW_LIMIT + 10));
  root = { id: "test", label: "Test", path: base, workspace: false, readOnly: true };
});

after(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe("classify", () => {
  it("recognises directories first", () => {
    assert.equal(classify("anything.mp4", true), "directory");
  });

  it("maps common media and text extensions", () => {
    assert.equal(classify("a.md", false), "text");
    assert.equal(classify("a.TS", false), "text");
    assert.equal(classify("a.mkv", false), "video");
    assert.equal(classify("a.FLAC", false), "audio");
    assert.equal(classify("a.png", false), "image");
    assert.equal(classify("a.pdf", false), "pdf");
    assert.equal(classify("a.tar.gz", false), "archive");
  });

  it("treats conventional extensionless names as text", () => {
    assert.equal(classify("LICENSE", false), "text");
    assert.equal(classify("Makefile", false), "text");
  });

  it("falls back to binary", () => {
    assert.equal(classify("firmware.bin", false), "binary");
    assert.equal(classify("noextension", false), "binary");
  });
});

describe("list", () => {
  it("puts directories first, then sorts by name", async () => {
    const listing = await list(root, "");
    assert.equal(listing.entries[0].name, "docs");
    assert.deepEqual(listing.entries.map((e) => e.name), ["docs", "blob.log", "huge.txt", "readme.md"]);
  });

  it("hides dotfiles unless asked", async () => {
    const hidden = await list(root, "", { showHidden: true });
    assert.ok(hidden.entries.some((e) => e.name === ".hidden"));
  });

  it("reports the parent of a subdirectory and null at the root", async () => {
    assert.equal((await list(root, "")).parent, null);
    assert.equal((await list(root, "docs")).parent, "");
    assert.equal((await list(root, "docs/deep")).parent, "docs");
  });

  it("refuses to list a file", async () => {
    await assert.rejects(() => list(root, "readme.md"), (err) => err instanceof PathError && err.status === 400);
  });

  it("404s on a missing directory", async () => {
    await assert.rejects(() => list(root, "nope"), (err) => err instanceof PathError && err.status === 404);
  });
});

describe("read", () => {
  it("returns the content of a text file", async () => {
    const detail = await read(root, "readme.md");
    assert.equal(detail.kind, "text");
    assert.equal(detail.content, "# Title\n");
    assert.equal(detail.mimeType, "text/markdown; charset=utf-8");
  });

  it("reclassifies a text-extension file that holds binary data", async () => {
    const detail = await read(root, "blob.log");
    assert.equal(detail.kind, "binary");
    assert.equal(detail.content, null);
    assert.match(detail.reason, /binary/);
  });

  it("refuses to inline a file past the preview limit", async () => {
    const detail = await read(root, "huge.txt");
    assert.equal(detail.content, null);
    assert.match(detail.reason, /preview limit/);
  });

  it("refuses to read a directory", async () => {
    await assert.rejects(() => read(root, "docs"), (err) => err instanceof PathError && err.status === 400);
  });
});

describe("search", () => {
  it("finds a file nested several levels down", async () => {
    const { hits } = await search(root, "buried");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, "docs/deep/buried-report.txt");
  });

  it("matches case-insensitively on a substring", async () => {
    const { hits } = await search(root, "README");
    assert.ok(hits.some((h) => h.name === "readme.md"));
  });

  it("rejects a query that is too short to be useful", async () => {
    await assert.rejects(() => search(root, "a"), (err) => err instanceof PathError && err.status === 400);
  });

  it("reports truncation instead of silently capping", async () => {
    const result = await search(root, "txt", { limit: 1 });
    assert.equal(result.hits.length, 1);
    assert.equal(result.truncated, true);
  });
});

describe("parseRange", () => {
  it("returns null when there is no Range header", () => {
    assert.equal(parseRange(undefined, 1000), null);
    assert.equal(parseRange("bytes=-", 1000), null);
  });

  it("parses a closed range", () => {
    assert.deepEqual(parseRange("bytes=100-199", 1000), { start: 100, end: 199 });
  });

  it("parses an open-ended range", () => {
    assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  });

  it("parses a suffix range", () => {
    assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  });

  it("clamps an end past the file size", () => {
    assert.deepEqual(parseRange("bytes=900-99999", 1000), { start: 900, end: 999 });
  });

  it("reports an unsatisfiable range", () => {
    assert.equal(parseRange("bytes=5000-6000", 1000), "unsatisfiable");
    assert.equal(parseRange("bytes=500-100", 1000), "unsatisfiable");
  });

  it("ignores a malformed header rather than throwing", () => {
    assert.equal(parseRange("items=0-10", 1000), null);
  });
});
