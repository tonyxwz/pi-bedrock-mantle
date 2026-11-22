// Tests for settings.ts: checking user-written settings. Run: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSettings } from "../src/settings.ts";

test("fills in defaults", () => {
	const settings = checkSettings({ region: "us-east-2" });
	assert.deepEqual(settings, {
		region: "us-east-2",
		regions: ["us-east-2"],
		models: {},
		serverTools: [{ type: "web_search", external_web_access: false }],
	});
});

test("puts the home Region first in the Region list, once", () => {
	const settings = checkSettings({ region: "us-east-2", regions: ["us-east-1", "us-east-2", "us-west-2"] });
	assert.deepEqual(settings.regions, ["us-east-2", "us-east-1", "us-west-2"]);
});

test("keeps per-model Regions and server tools", () => {
	const settings = checkSettings({
		region: "us-east-2",
		models: { "openai.gpt-6.2-astra": { region: "us-east-1" } },
		serverTools: [],
	});
	assert.deepEqual(settings.models, { "openai.gpt-6.2-astra": { region: "us-east-1" } });
	assert.deepEqual(settings.serverTools, []);
});

test("rejects malformed settings with the setting's name", () => {
	assert.throws(() => checkSettings({ region: 5 }), /"region" must be a non-empty string/);
	assert.throws(() => checkSettings({ regions: "us-east-1" }), /"regions" must be an array/);
	assert.throws(() => checkSettings({ models: { a: "us-east-1" } }), /"models.a" must be an object/);
	assert.throws(() => checkSettings({ serverTools: [1] }), /"serverTools" must be an array of tool objects/);
});
