// Tests for web-search.ts: recording search calls and replaying them in place. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareResponsesPayload, recordWebSearch, type RecordedWebSearchCall } from "../src/web-search.ts";

const ws = (id: string) => ({ type: "web_search_call", id, status: "completed", action: { type: "search", query: id } });
const output = [{ type: "reasoning", id: "rs_1" }, ws("ws_1"), { type: "reasoning", id: "rs_2" }, ws("ws_2"), ws("ws_3"), { type: "message", id: "msg_1", content: [{ type: "output_text", annotations: [{ type: "url_citation", title: "A", url: "https://a" }, { type: "url_citation", title: "A", url: "https://a" }] }] }];

test("records calls with anchors and sources", () => {
	const record = recordWebSearch("resp_1", output)!;
	assert.deepEqual(record.calls.map((c) => [c.item.id, c.before, c.after]), [["ws_1", "rs_2", "rs_1"], ["ws_2", "msg_1", "rs_2"], ["ws_3", "msg_1", "rs_2"]]);
	assert.deepEqual(record.sources, [{ title: "A", url: "https://a" }]);
	assert.equal(recordWebSearch("resp_2", [{ type: "message", id: "m" }]), undefined);
});

test("replays calls in original order and adds server tools", () => {
	const record = recordWebSearch("resp_1", output)!;
	const calls = new Map<string, RecordedWebSearchCall>(record.calls.map((c) => [c.item.id, c]));
	const input = [{ role: "user" }, { type: "reasoning", id: "rs_1" }, { type: "reasoning", id: "rs_2" }, { type: "message", id: "msg_1" }, { role: "user" }];
	const result = prepareResponsesPayload({ input, tools: [{ type: "function" }] }, [{ type: "web_search" }], calls) as { input: { id?: string }[]; tools: unknown[] };
	assert.deepEqual(result.input.map((i) => i.id), [undefined, "rs_1", "ws_1", "rs_2", "ws_2", "ws_3", "msg_1", undefined]);
	assert.equal(result.tools.length, 2);
	// Idempotent when the calls are already present.
	const again = prepareResponsesPayload(result, [], calls) as { input: unknown[] };
	assert.equal(again.input.length, result.input.length);
});

test("falls back to the previous item and skips missing anchors", () => {
	const calls = new Map<string, RecordedWebSearchCall>([
		["ws_a", { item: ws("ws_a") as never, before: "fc_gone", after: "rs_1" }],
		["ws_b", { item: ws("ws_b") as never, before: "fc_gone", after: "rs_1" }],
		["ws_c", { item: ws("ws_c") as never, before: "gone", after: "gone" }],
	]);
	const result = prepareResponsesPayload({ input: [{ type: "reasoning", id: "rs_1" }, { type: "function_call" }] }, [], calls) as { input: { id?: string }[] };
	assert.deepEqual(result.input.map((i) => i.id), ["rs_1", "ws_a", "ws_b", undefined]);
});
