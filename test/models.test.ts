// Tests for models.ts: which Region each model goes to. Run: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { assignRegions, mantleBaseUrl, readModelLists, savedModelLists } from "../extensions/models.ts";

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

test("saved models rebuild the lists of the configured Regions", () => {
	const saved = [
		{ id: "openai.gpt-5.6-luna", baseUrl: mantleBaseUrl("us-east-2") },
		{ id: "openai.gpt-6-luna", baseUrl: mantleBaseUrl("us-east-1") },
		{ id: "openai.gpt-6-sol", baseUrl: mantleBaseUrl("us-west-2") },
	];
	const result = savedModelLists(saved, ["us-east-2", "us-east-1", "eu-west-1"]);
	assert.deepEqual(
		[...result].map(([region, list]) => [region, [...(list ?? [])]]),
		[
			["us-east-2", ["openai.gpt-5.6-luna"]],
			["us-east-1", ["openai.gpt-6-luna"]],
			["eu-west-1", []],
		],
	);
});

test("a Region whose list cannot be read keeps its fallback list", async () => {
	const fetchForRegion = (region: string): typeof fetch => async () =>
		region === "us-east-2"
			? Response.json({ data: [{ id: "openai.gpt-5.6-luna" }] })
			: new Response("unavailable", { status: 503 });
	const fallback = new Map([["us-east-1", new Set(["openai.gpt-6-luna"])]]);
	const result = await readModelLists(["us-east-2", "us-east-1", "us-west-2"], fetchForRegion, fallback, new AbortController().signal);
	assert.deepEqual(
		[...result].map(([region, list]) => [region, list && [...list]]),
		[
			["us-east-2", ["openai.gpt-5.6-luna"]],
			["us-east-1", ["openai.gpt-6-luna"]],
			["us-west-2", undefined],
		],
	);
});
