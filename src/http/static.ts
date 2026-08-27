import { createReadStream, promises as fs } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { isInside } from "../core/paths.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".zip": "application/zip",
};

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Serves the bundled `web/` directory. Returns false when the request does not
 * correspond to a file, letting the caller fall back to index.html for
 * client-side routes.
 */
export async function serveStatic(
  res: ServerResponse,
  webRoot: string,
  requestPath: string,
): Promise<boolean> {
  const relative = requestPath.replace(/^\/+/, "") || "index.html";
  const absolute = resolve(webRoot, relative);
  if (!isInside(webRoot, absolute)) return false;

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absolute);
  } catch {
    return false;
  }
  if (stat.isDirectory()) {
    return serveStatic(res, webRoot, join(relative, "index.html"));
  }
  if (!stat.isFile()) return false;

  const isHtml = absolute.endsWith(".html");
  res.writeHead(200, {
    "content-type": mimeFor(absolute),
    "content-length": stat.size,
    // The app shell must never be cached or a redeploy serves a stale index
    // pointing at chunks that no longer exist. Assets are content-addressed by
    // path here, so a short TTL is enough.
    "cache-control": isHtml ? "no-cache" : "public, max-age=600",
    "last-modified": stat.mtime.toUTCString(),
  });
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(absolute);
    stream.on("error", fail);
    stream.on("end", done);
    stream.pipe(res);
  });
  return true;
}
