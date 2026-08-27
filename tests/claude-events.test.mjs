import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTurnEnd, NdjsonParser, toTranscriptEntries } from "../dist/services/claude-events.js";

/** Fresh sequence counter per assertion, mirroring one session. */
function convert(payload) {
  let seq = 0;
  return toTranscriptEntries(payload, () => (seq += 1), "2026-01-01T00:00:00.000Z");
}

describe("NdjsonParser", () => {
  it("emits one object per complete line", () => {
    const parser = new NdjsonParser();
    const out = parser.push('{"a":1}\n{"a":2}\n');
    assert.deepEqual(out, [{ a: 1 }, { a: 2 }]);
  });

  it("holds a partial line until its newline arrives", () => {
    const parser = new NdjsonParser();
    assert.deepEqual(parser.push('{"a":'), []);
    assert.deepEqual(parser.push('1}\n'), [{ a: 1 }]);
  });

  it("survives a split in the middle of a multi-byte payload", () => {
    const parser = new NdjsonParser();
    parser.push('{"text":"héllo wor');
    assert.deepEqual(parser.push('ld"}\n'), [{ text: "héllo world" }]);
  });

  it("wraps a non-JSON diagnostic line instead of dropping it", () => {
    const parser = new NdjsonParser();
    assert.deepEqual(parser.push("warning: something\n"), [{ type: "__text__", text: "warning: something" }]);
  });

  it("ignores blank lines", () => {
    assert.deepEqual(new NdjsonParser().push("\n\n\n"), []);
  });

  it("flushes a trailing line that never got its newline", () => {
    const parser = new NdjsonParser();
    parser.push('{"a":1}');
    assert.deepEqual(parser.flush(), [{ a: 1 }]);
    assert.deepEqual(parser.flush(), []);
  });
});

describe("toTranscriptEntries", () => {
  it("reads the init handshake", () => {
    const [entry] = convert({
      type: "system",
      subtype: "init",
      model: "claude-sonnet-5",
      cwd: "/volume1/code",
      tools: ["Read", "Bash"],
      session_id: "abc",
    });
    assert.equal(entry.kind, "init");
    assert.equal(entry.model, "claude-sonnet-5");
    assert.deepEqual(entry.tools, ["Read", "Bash"]);
    assert.equal(entry.claudeSessionId, "abc");
  });

  it("splits an assistant message into its blocks, in order", () => {
    const entries = convert({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "Here you go." },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a" } },
        ],
      },
    });
    assert.deepEqual(entries.map((e) => e.kind), ["thinking", "assistant", "tool_use"]);
    assert.deepEqual(entries.map((e) => e.seq), [1, 2, 3]);
    assert.equal(entries[2].name, "Read");
  });

  it("drops an assistant turn whose only block is empty interleaved thinking", () => {
    const entries = convert({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "", signature: "x".repeat(4000) }] },
    });
    assert.deepEqual(entries, []);
  });

  it("reads a tool result, flagging errors", () => {
    const [ok] = convert({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] },
    });
    assert.equal(ok.kind, "tool_result");
    assert.equal(ok.isError, false);
    assert.equal(ok.text, "done");

    const [failed] = convert({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "boom" }] },
    });
    assert.equal(failed.isError, true);
  });

  it("flattens a block-array tool result into text", () => {
    const [entry] = convert({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }],
      },
    });
    assert.equal(entry.text, "a\nb");
  });

  it("reads the result envelope, including usage and cost", () => {
    const [entry] = convert({
      type: "result",
      subtype: "success",
      duration_ms: 1234,
      total_cost_usd: 0.5,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
      result: "all done",
    });
    assert.equal(entry.kind, "result");
    assert.equal(entry.isError, false);
    assert.equal(entry.durationMs, 1234);
    assert.equal(entry.costUsd, 0.5);
    assert.deepEqual(entry.usage, {
      inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40,
    });
  });

  it("marks an error result from its subtype alone", () => {
    const [entry] = convert({ type: "result", subtype: "error_during_execution" });
    assert.equal(entry.isError, true);
  });

  it("drops the CLI's telemetry envelopes", () => {
    const noise = [
      { type: "active_goal", value: null },
      { type: "autocompact_state", value: {} },
      { type: "rate_limit_event", rate_limit_info: {} },
      { type: "system", subtype: "status", status: "requesting" },
      { type: "system", subtype: "thinking_tokens", estimated_tokens: 50 },
      { type: "system", subtype: "task_summary", detail: "Reading a file" },
      { type: "system", subtype: "post_turn_summary" },
      { type: "system", subtype: "commands_changed", commands: [] },
      { type: "stream_event", event: {} },
    ];
    for (const payload of noise) {
      assert.deepEqual(convert(payload), [], `expected ${JSON.stringify(payload).slice(0, 60)} to be dropped`);
    }
  });

  it("preserves an envelope it does not understand, so nothing is lost silently", () => {
    const [entry] = convert({ type: "something_new_in_a_later_cli", detail: 42 });
    assert.equal(entry.kind, "raw");
    assert.deepEqual(entry.payload, { type: "something_new_in_a_later_cli", detail: 42 });
  });

  it("preserves an unknown system subtype as raw", () => {
    const [entry] = convert({ type: "system", subtype: "brand_new" });
    assert.equal(entry.kind, "raw");
  });
});

describe("isTurnEnd", () => {
  it("is true only for the result envelope", () => {
    assert.equal(isTurnEnd({ type: "result" }), true);
    assert.equal(isTurnEnd({ type: "assistant" }), false);
    assert.equal(isTurnEnd(null), false);
  });
});
