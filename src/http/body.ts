import type { IncomingMessage } from "node:http";
import { HttpError } from "./respond.js";

const DEFAULT_LIMIT = 1024 * 1024; // 1 MiB — plenty for a prompt, small enough to be safe.

export async function readBody(
  req: IncomingMessage,
  limit = DEFAULT_LIMIT,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.byteLength;
    if (size > limit) {
      throw new HttpError(413, `request body exceeds ${limit} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T = unknown>(
  req: IncomingMessage,
  limit?: number,
): Promise<T> {
  const raw = await readBody(req, limit);
  if (raw.byteLength === 0) return {} as T;
  try {
    return JSON.parse(raw.toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  opts: { maxLength?: number; optional?: boolean } = {},
): string {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    if (opts.optional) return "";
    throw new HttpError(400, `"${field}" is required`);
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `"${field}" must be a string`);
  }
  if (opts.maxLength && value.length > opts.maxLength) {
    throw new HttpError(400, `"${field}" exceeds ${opts.maxLength} characters`);
  }
  return value;
}
