import { promises as fs } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { ContentRoot } from "../config.js";

export class PathError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type ResolvedPath = {
  root: ContentRoot;
  /** Absolute path on disk, guaranteed to sit under root.path. */
  absolute: string;
  /** Path relative to the root, using forward slashes. "" means the root itself. */
  relative: string;
};

/**
 * Reject anything that escapes its root.
 *
 * Two checks are needed, and both matter:
 *
 *  1. Lexical — `resolve()` collapses `..` segments, then `relative()` tells us
 *     whether the result still sits under the root.
 *  2. Physical — `realpath()` follows symlinks. A NAS share is full of them, and
 *     a symlink inside an allowed root can point at /etc. We resolve the deepest
 *     existing ancestor and re-check containment against the root's own realpath.
 *
 * Skipping either one leaves a traversal hole, so callers always use this.
 */
export async function resolveWithinRoot(
  root: ContentRoot,
  requested: string,
): Promise<ResolvedPath> {
  if (requested.includes("\0")) {
    throw new PathError("path contains a null byte", 400);
  }

  const cleaned = requested.replace(/^\/+/, "");
  const absolute = resolve(root.path, cleaned);

  if (!isInside(root.path, absolute)) {
    throw new PathError("path escapes its root", 403);
  }

  const rootReal = await realpathOrSelf(root.path);
  const targetReal = await realpathOfNearestAncestor(absolute);
  if (!isInside(rootReal, targetReal)) {
    throw new PathError("path resolves outside its root via a symlink", 403);
  }

  return {
    root,
    absolute,
    relative: toPosix(relative(root.path, absolute)),
  };
}

/** True when `child` is `parent` itself or sits somewhere below it. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === "") return true;
  if (rel.startsWith("..")) return false;
  return !rel.split(sep).includes("..");
}

export function toPosix(value: string): string {
  return value.split(sep).join("/");
}

async function realpathOrSelf(path: string): Promise<string> {
  try {
    return await fs.realpath(path);
  } catch {
    return path;
  }
}

/**
 * `realpath` throws on a path that does not exist yet, which is the normal case
 * when a caller is about to create a file. Walk up to the deepest ancestor that
 * does exist, resolve that, and re-attach the tail — so a symlinked ancestor is
 * still caught.
 */
async function realpathOfNearestAncestor(absolute: string): Promise<string> {
  let current = absolute;
  const tail: string[] = [];

  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = resolve(current, "..");
      if (parent === current) return absolute;
      tail.push(current.slice(parent.length).replace(/^[/\\]+/, ""));
      current = parent;
    }
  }
}

export function findRoot(roots: ContentRoot[], id: string): ContentRoot {
  const root = roots.find((r) => r.id === id);
  if (!root) throw new PathError(`unknown root "${id}"`, 404);
  return root;
}

/**
 * Turn an absolute NAS path back into a root-relative reference, so responses
 * never leak the NAS's real directory layout to the browser.
 */
export function describeAbsolute(
  roots: ContentRoot[],
  absolute: string,
): { rootId: string; path: string } | null {
  for (const root of roots) {
    if (isInside(root.path, absolute)) {
      return { rootId: root.id, path: toPosix(relative(root.path, absolute)) };
    }
  }
  return null;
}
