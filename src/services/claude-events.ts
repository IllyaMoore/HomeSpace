/**
 * Normalisation of Claude Code's `--output-format stream-json` protocol into
 * the flat, UI-shaped entries HomeSpace stores and streams.
 *
 * The CLI emits one JSON object per line. We care about five envelopes:
 *
 *   {"type":"system","subtype":"init",...}   session handshake: id, model, tools
 *   {"type":"assistant","message":{...}}     an assistant turn (Anthropic shape)
 *   {"type":"user","message":{...}}          tool results fed back in
 *   {"type":"result","subtype":"success"}    end of turn, with cost and usage
 *   {"type":"stream_event",...}              token deltas (--include-partial-messages)
 *
 * The CLI also emits a steady drip of telemetry — status pings, thinking-token
 * counters, rate-limit notices, task summaries. Those are listed below and
 * dropped: keeping them turned a six-line exchange into a twenty-two-line one
 * where the actual answer was hard to find. Anything NOT on that list and not
 * understood is still preserved verbatim as a "raw" entry, so a CLI upgrade
 * that adds an envelope degrades to "shown but not styled" rather than
 * "silently lost".
 */

export type TranscriptEntry =
  | { seq: number; at: string; kind: "init"; model: string | null; tools: string[]; cwd: string | null; claudeSessionId: string | null }
  | { seq: number; at: string; kind: "user"; text: string }
  | { seq: number; at: string; kind: "assistant"; text: string }
  | { seq: number; at: string; kind: "thinking"; text: string }
  | { seq: number; at: string; kind: "tool_use"; toolId: string; name: string; input: unknown }
  | { seq: number; at: string; kind: "tool_result"; toolId: string; isError: boolean; text: string }
  | { seq: number; at: string; kind: "result"; subtype: string; isError: boolean; durationMs: number | null; costUsd: number | null; usage: TokenUsage | null; text: string | null }
  | { seq: number; at: string; kind: "notice"; level: "info" | "warn" | "error"; text: string }
  | { seq: number; at: string; kind: "raw"; payload: unknown };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/**
 * Top-level envelope types that carry no information for a human reading the
 * transcript afterwards.
 */
const TELEMETRY_TYPES = new Set([
  "active_goal",
  "autocompact_state",
  "rate_limit_event",
  "control_response",
  "control_request",
]);

/** `{"type":"system","subtype":…}` envelopes in the same category. */
const TELEMETRY_SYSTEM_SUBTYPES = new Set([
  "status",
  "thinking_tokens",
  "task_summary",
  "post_turn_summary",
  "commands_changed",
  "mcp_status",
  "compact_boundary",
]);

type ContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};

function blocksOf(message: unknown): ContentBlock[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as ContentBlock[];
  return [];
}

function stringifyResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const typed = block as ContentBlock;
        if (typed?.type === "text" && typeof typed.text === "string") return typed.text;
        return JSON.stringify(block);
      })
      .join("\n");
  }
  if (content === undefined || content === null) return "";
  return JSON.stringify(content);
}

function readUsage(raw: unknown): TokenUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const usage = raw as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheCreationTokens: num(usage.cache_creation_input_tokens),
  };
}

/**
 * Converts one protocol line into zero or more transcript entries. `nextSeq` is
 * called for each entry so ordering stays consistent with everything else the
 * session has recorded.
 */
export function toTranscriptEntries(
  payload: unknown,
  nextSeq: () => number,
  at: string = new Date().toISOString(),
): TranscriptEntry[] {
  if (typeof payload !== "object" || payload === null) {
    return [{ seq: nextSeq(), at, kind: "raw", payload }];
  }
  const envelope = payload as Record<string, unknown>;
  const entries: TranscriptEntry[] = [];

  if (typeof envelope.type === "string" && TELEMETRY_TYPES.has(envelope.type)) return [];

  switch (envelope.type) {
    case "system": {
      if (typeof envelope.subtype === "string" && TELEMETRY_SYSTEM_SUBTYPES.has(envelope.subtype)) {
        return [];
      }
      if (envelope.subtype !== "init") {
        return [{ seq: nextSeq(), at, kind: "raw", payload }];
      }
      entries.push({
        seq: nextSeq(),
        at,
        kind: "init",
        model: typeof envelope.model === "string" ? envelope.model : null,
        tools: Array.isArray(envelope.tools) ? envelope.tools.filter((t): t is string => typeof t === "string") : [],
        cwd: typeof envelope.cwd === "string" ? envelope.cwd : null,
        claudeSessionId: typeof envelope.session_id === "string" ? envelope.session_id : null,
      });
      return entries;
    }

    case "assistant": {
      for (const block of blocksOf(envelope.message)) {
        if (block.type === "text" && block.text) {
          entries.push({ seq: nextSeq(), at, kind: "assistant", text: block.text });
        } else if (block.type === "thinking" && block.thinking) {
          entries.push({ seq: nextSeq(), at, kind: "thinking", text: block.thinking });
        } else if (block.type === "tool_use") {
          entries.push({
            seq: nextSeq(),
            at,
            kind: "tool_use",
            toolId: block.id ?? "",
            name: block.name ?? "tool",
            input: block.input ?? null,
          });
        }
      }
      // Interleaved thinking arrives as a block with an empty `thinking` string
      // and a long opaque `signature`. There is nothing to show, and dumping the
      // envelope as raw put a screenful of base64 in the middle of the
      // conversation — so an assistant turn with no renderable block is dropped.
      return entries;
    }

    case "user": {
      for (const block of blocksOf(envelope.message)) {
        if (block.type === "tool_result") {
          entries.push({
            seq: nextSeq(),
            at,
            kind: "tool_result",
            toolId: block.tool_use_id ?? "",
            isError: block.is_error === true,
            text: stringifyResultContent(block.content),
          });
        } else if (block.type === "text" && block.text) {
          entries.push({ seq: nextSeq(), at, kind: "user", text: block.text });
        }
      }
      return entries;
    }

    case "result": {
      const subtype = typeof envelope.subtype === "string" ? envelope.subtype : "unknown";
      entries.push({
        seq: nextSeq(),
        at,
        kind: "result",
        subtype,
        isError: envelope.is_error === true || subtype.startsWith("error"),
        durationMs: typeof envelope.duration_ms === "number" ? envelope.duration_ms : null,
        costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : null,
        usage: readUsage(envelope.usage),
        text: typeof envelope.result === "string" ? envelope.result : null,
      });
      return entries;
    }

    // Token deltas are high-volume and only useful live. The session manager
    // forwards them over SSE without adding them to the stored transcript.
    case "stream_event":
      return [];

    default:
      return [{ seq: nextSeq(), at, kind: "raw", payload }];
  }
}

/** True when this envelope marks the end of a turn. */
export function isTurnEnd(payload: unknown): boolean {
  return (payload as { type?: unknown } | null)?.type === "result";
}

/**
 * Splits a byte stream into complete JSON lines. Chunk boundaries land in the
 * middle of a line constantly, so the tail is held until its newline arrives.
 */
export class NdjsonParser {
  #buffer = "";

  push(chunk: string): unknown[] {
    this.#buffer += chunk;
    const out: unknown[] = [];
    let index = this.#buffer.indexOf("\n");

    while (index !== -1) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line) {
        try {
          out.push(JSON.parse(line));
        } catch {
          // Not JSON — the CLI printed a plain diagnostic. Surface it as text
          // rather than discarding it.
          out.push({ type: "__text__", text: line });
        }
      }
      index = this.#buffer.indexOf("\n");
    }
    return out;
  }

  /** Anything left after the stream closed without a trailing newline. */
  flush(): unknown[] {
    if (!this.#buffer.trim()) {
      this.#buffer = "";
      return [];
    }
    const out = this.push("\n");
    this.#buffer = "";
    return out;
  }
}
