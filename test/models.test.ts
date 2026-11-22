// Tests for models.ts: which Region each model goes to. Run: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { assignRegions } from "../src/models.ts";

const lists = new Map<string, ReadonlySet<string> | undefined>([
	["us-east-2", new Set(["openai.gpt-5.6-luna"])],
	["us-east-1", new Set(["openai.gpt-5.6-luna", "openai.gpt-6-luna"])],
]);
const ids = ["openai.gpt-5.6-luna", "openai.gpt-6-luna", "openai.gpt-6.2-astra"];

test("uses the first Region that lists the model and leaves out unlisted models", () => {
	const result = assignRegions(ids, { regions: ["us-east-2", "us-east-1"], models: {} }, lists);
	assert.deepEqual(result, [
		{ id: "openai.gpt-5.6-luna", region: "us-east-2" },
		{ id: "openai.gpt-6-luna", region: "us-east-1" },
	]);
});

test("a pinned Region wins, even when no list has the model", () => {
	const models = { "openai.gpt-5.6-luna": { region: "us-east-1" }, "openai.gpt-6.2-astra": { region: "us-east-1" } };
	const result = assignRegions(ids, { regions: ["us-east-2"], models }, lists);
	assert.deepEqual(result, [
		{ id: "openai.gpt-5.6-luna", region: "us-east-1" },
		{ id: "openai.gpt-6.2-astra", region: "us-east-1" },
	]);
});

test("a Region whose list could not be read serves every model", () => {
	const unread = new Map<string, ReadonlySet<string> | undefined>([["us-east-2", undefined]]);
	const result = assignRegions(ids, { regions: ["us-east-2", "us-east-1"], models: {} }, unread);
	assert.deepEqual(
		result.map((model) => model.region),
		["us-east-2", "us-east-2", "us-east-2"],
	);
});
