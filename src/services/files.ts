import { createReadStream, promises as fs } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, posix } from "node:path";
import type { ContentRoot } from "../config.js";
import { PathError, resolveWithinRoot, toPosix } from "../core/paths.js";
import { mimeFor } from "../http/static.js";

/** Above this, the preview endpoint refuses and the UI offers a download. */
export const TEXT_PREVIEW_LIMIT = 512 * 1024;

export type FileKind = "directory" | "text" | "image" | "video" | "audio" | "pdf" | "archive" | "binary";

export type FileEntry = {
  name: string;
  path: string;
  kind: FileKind;
  sizeBytes: number;
  modifiedAt: string;
  /** True when the entry is a symlink; the resolved target still had to pass
   *  the root check, so a listed symlink is always safe to open. */
  symlink: boolean;
};

export type Listing = {
  rootId: string;
  path: string;
  parent: string | null;
  entries: FileEntry[];
  truncated: boolean;
};

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".env", ".log", ".csv", ".tsv", ".xml", ".html", ".htm", ".css", ".scss", ".less",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".swift", ".sh", ".bash", ".zsh", ".fish",
  ".sql", ".graphql", ".proto", ".dockerfile", ".gitignore", ".editorconfig", ".lock", ".patch", ".diff",
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".heic"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".ts", ".wmv"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma"]);
const ARCHIVE_EXTENSIONS = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"]);

/** Files with no extension that are conventionally plain text. */
const TEXT_BASENAMES = new Set([
  "readme", "license", "licence", "changelog", "makefile", "dockerfile", "procfile", "notice", "authors",
]);

export function classify(name: string, isDirectory: boolean): FileKind {
  if (isDirectory) return "directory";
  const ext = extname(name).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (ext === "" && TEXT_BASENAMES.has(name.toLowerCase())) return "text";
  return "binary";
}

function parentOf(path: string): string | null {
  if (!path) return null;
  const parent = posix.dirname(path);
  return parent === "." ? "" : parent;
}

export async function list(
  root: ContentRoot,
  requestedPath: string,
  opts: { limit?: number; showHidden?: boolean } = {},
): Promise<Listing> {
  const limit = Math.min(Math.max(opts.limit ?? 1000, 1), 5000);
  const resolved = await resolveWithinRoot(root, requestedPath);

  const stat = await statOrThrow(resolved.absolute);
  if (!stat.isDirectory()) {
    throw new PathError("not a directory", 400);
  }

  const dirents = await fs.readdir(resolved.absolute, { withFileTypes: true });
  const visible = opts.showHidden ? dirents : dirents.filter((d) => !d.name.startsWith("."));
  const truncated = visible.length > limit;

  const entries: FileEntry[] = [];
  for (const dirent of visible.slice(0, limit)) {
    const absolute = join(resolved.absolute, dirent.name);
    let entryStat;
    try {
      // `stat` follows symlinks so a link to a directory sorts and behaves like
      // one. A dangling link throws and is simply skipped.
      entryStat = await fs.stat(absolute);
    } catch {
      continue;
    }
    entries.push({
      name: dirent.name,
      path: toPosix(resolved.relative ? posix.join(resolved.relative, dirent.name) : dirent.name),
      kind: classify(dirent.name, entryStat.isDirectory()),
      sizeBytes: entryStat.isDirectory() ? 0 : entryStat.size,
      modifiedAt: entryStat.mtime.toISOString(),
      symlink: dirent.isSymbolicLink(),
    });
  }

  // Directories first, then case-insensitive by name — the ordering people
  // expect from a file manager.
  entries.sort((a, b) => {
    if ((a.kind === "directory") !== (b.kind === "directory")) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  return {
    rootId: root.id,
    path: resolved.relative,
    parent: parentOf(resolved.relative),
    entries,
    truncated,
  };
}

export type FileDetail = {
  rootId: string;
  path: string;
  name: string;
  kind: FileKind;
  sizeBytes: number;
  modifiedAt: string;
  mimeType: string;
  /** Present only for text files inside the preview limit. */
  content: string | null;
  /** True when content was cut short at the preview limit. */
  contentTruncated: boolean;
  /** Why content is null, when it is. */
  reason: string | null;
};

export async function read(root: ContentRoot, requestedPath: string): Promise<FileDetail> {
  const resolved = await resolveWithinRoot(root, requestedPath);
  const stat = await statOrThrow(resolved.absolute);
  if (stat.isDirectory()) throw new PathError("path is a directory", 400);

  const name = posix.basename(resolved.relative) || root.label;
  const kind = classify(name, false);
  const base: FileDetail = {
    rootId: root.id,
    path: resolved.relative,
    name,
    kind,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    mimeType: mimeFor(name),
    content: null,
    contentTruncated: false,
    reason: null,
  };

  if (kind !== "text") {
    return { ...base, reason: `preview unavailable for ${kind} files — use the raw endpoint` };
  }
  if (stat.size > TEXT_PREVIEW_LIMIT) {
    return { ...base, reason: `file exceeds the ${TEXT_PREVIEW_LIMIT} byte preview limit` };
  }

  const buffer = await fs.readFile(resolved.absolute);
  // A ".log" or ".csv" can still hold binary garbage. A NUL byte in the first
  // block is the cheap, reliable tell, and it stops the UI rendering mojibake.
  if (buffer.subarray(0, 8192).includes(0)) {
    return { ...base, kind: "binary", reason: "file contains binary data" };
  }

  return { ...base, content: buffer.toString("utf8") };
}

/**
 * Streams a file with Range support so the browser can seek inside NAS video
 * and audio without downloading the whole thing.
 */
export async function stream(
  res: ServerResponse,
  root: ContentRoot,
  requestedPath: string,
  rangeHeader: string | undefined,
  disposition: "inline" | "attachment",
): Promise<void> {
  const resolved = await resolveWithinRoot(root, requestedPath);
  const stat = await statOrThrow(resolved.absolute);
  if (stat.isDirectory()) throw new PathError("path is a directory", 400);

  const name = posix.basename(resolved.relative);
  const type = mimeFor(name);
  const filename = encodeURIComponent(name);
  const contentDisposition = `${disposition}; filename*=UTF-8''${filename}`;
  const range = parseRange(rangeHeader, stat.size);

  if (range === "unsatisfiable") {
    res.writeHead(416, { "content-range": `bytes */${stat.size}` });
    res.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(stat.size - 1, 0);
  const length = stat.size === 0 ? 0 : end - start + 1;

  res.writeHead(range ? 206 : 200, {
    "content-type": type,
    "content-length": length,
    "content-disposition": contentDisposition,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=60",
    ...(range ? { "content-range": `bytes ${start}-${end}/${stat.size}` } : {}),
  });

  if (stat.size === 0) {
    res.end();
    return;
  }

  await new Promise<void>((done, fail) => {
    const readStream = createReadStream(resolved.absolute, { start, end });
    readStream.on("error", fail);
    readStream.on("end", done);
    res.on("close", () => readStream.destroy());
    readStream.pipe(res);
  });
}

type Range = { start: number; end: number };

export function parseRange(header: string | undefined, size: number): Range | "unsatisfiable" | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, rawStart = "", rawEnd = ""] = match;

  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // Suffix form: "bytes=-500" means the last 500 bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    const start = Math.max(size - suffix, 0);
    return { start, end: Math.max(size - 1, 0) };
  }

  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Number(rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unsatisfiable";
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}

export type SearchHit = { rootId: string; path: string; name: string; kind: FileKind; sizeBytes: number };

/**
 * Breadth-first filename search. A NAS share can hold millions of files, so the
 * walk is bounded on three axes — hits, directories visited, and depth — and
 * reports when it stopped early rather than pretending the result is complete.
 */
export async function search(
  root: ContentRoot,
  query: string,
  opts: { limit?: number; maxDirs?: number; maxDepth?: number } = {},
): Promise<{ hits: SearchHit[]; truncated: boolean; scannedDirs: number }> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) {
    throw new PathError("search query must be at least 2 characters", 400);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const maxDirs = opts.maxDirs ?? 20_000;
  const maxDepth = opts.maxDepth ?? 12;

  const hits: SearchHit[] = [];
  const queue: Array<{ absolute: string; relative: string; depth: number }> = [
    { absolute: root.path, relative: "", depth: 0 },
  ];
  let scannedDirs = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (hits.length >= limit || scannedDirs >= maxDirs) {
      truncated = true;
      break;
    }
    const current = queue.shift()!;
    scannedDirs += 1;

    let dirents;
    try {
      dirents = await fs.readdir(current.absolute, { withFileTypes: true });
    } catch {
      continue; // Unreadable share or permission-denied subtree — skip it.
    }

    for (const dirent of dirents) {
      if (dirent.name.startsWith(".")) continue;
      const relative = current.relative ? posix.join(current.relative, dirent.name) : dirent.name;

      if (dirent.name.toLowerCase().includes(needle)) {
        let sizeBytes = 0;
        try {
          sizeBytes = dirent.isDirectory() ? 0 : (await fs.stat(join(current.absolute, dirent.name))).size;
        } catch {
          continue;
        }
        hits.push({
          rootId: root.id,
          path: relative,
          name: dirent.name,
          kind: classify(dirent.name, dirent.isDirectory()),
          sizeBytes,
        });
        if (hits.length >= limit) {
          truncated = true;
          break;
        }
      }

      // Only descend into real directories. Following symlinked directories
      // invites both traversal out of the root and infinite loops.
      if (dirent.isDirectory() && current.depth < maxDepth) {
        queue.push({
          absolute: join(current.absolute, dirent.name),
          relative,
          depth: current.depth + 1,
        });
      }
    }
  }

  return { hits, truncated, scannedDirs };
}

async function statOrThrow(absolute: string) {
  try {
    return await fs.stat(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new PathError("not found", 404);
    if (code === "EACCES") throw new PathError("permission denied", 403);
    throw err;
  }
}
