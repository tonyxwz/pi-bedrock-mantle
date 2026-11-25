// Tests for web-search-tool.ts: leaving the tool out of Mantle requests. Run: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { WEB_SEARCH_TOOL_NAME, withoutWebSearchTool } from "../extensions/web-search-tool.ts";

test("removes only the web search function tool", () => {
	const payload = {
		model: "openai.gpt-6.2-astra",
		tools: [
			{ type: "function", name: "bash" },
			{ type: "function", name: WEB_SEARCH_TOOL_NAME },
			{ type: "web_search" },
		],
	};
	assert.deepEqual(withoutWebSearchTool(payload), {
		model: "openai.gpt-6.2-astra",
		tools: [{ type: "function", name: "bash" }, { type: "web_search" }],
	});
});

test("drops an emptied tool list and leaves payloads without tools alone", () => {
	const only = { tools: [{ type: "function", name: WEB_SEARCH_TOOL_NAME }] };
	assert.deepEqual(withoutWebSearchTool(only), { tools: undefined });
	const none = { model: "m" };
	assert.equal(withoutWebSearchTool(none), none);
});
