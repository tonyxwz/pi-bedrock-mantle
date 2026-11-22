// Extension settings: reads `extensionSettings["pi-bedrock-mantle"]` from pi's global
// settings.json and checks its shape.

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

/** Per-model settings. */
export interface MantleModelSettings {
	/** Region that serves this model. Offered even when the Region's model list omits it. */
	region?: string;
}

/** The extension's settings, checked. */
export interface MantleSettings {
	/** Region for models without a pinned Region, and the provider's base URL. */
	region: string;
	/** Regions whose model lists are read, in order of preference. Starts with `region`. */
	regions: string[];
	/** Per-model settings, keyed by Mantle model id. */
	models: Record<string, MantleModelSettings>;
	/** Responses server tools added to every request. */
	serverTools: Record<string, unknown>[];
}

export const SETTINGS_KEY = "pi-bedrock-mantle";

// Codex sends the same: retrieval stays inside AWS, and Fetch needs no ExternalWebAccess permission.
const DEFAULT_SERVER_TOOLS: Record<string, unknown>[] = [{ type: "web_search", external_web_access: false }];

/**
 * Read the settings from the global settings.json. Extensions cannot call `pi.getSettings()`
 * while loading, and the Regions are needed then to register the models, so this reads the file
 * through pi's SettingsManager. Project settings are skipped: the project may not be trusted yet.
 */
export function readMantleSettings(): MantleSettings {
	const global = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: false }).getGlobalSettings();
	const raw = (global as { extensionSettings?: Record<string, unknown> }).extensionSettings?.[SETTINGS_KEY];
	return checkSettings(raw ?? {});
}

/** Check user-written settings (a trust boundary) and fill in defaults. */
export function checkSettings(raw: unknown): MantleSettings {
	if (!isObject(raw)) throw settingsError("must be an object");
	const region =
		optionalString(raw.region, "region") ??
		(process.env.BEDROCK_MANTLE_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1");
	const extraRegions = optionalStringArray(raw.regions, "regions") ?? [];
	const models: Record<string, MantleModelSettings> = {};
	if (raw.models !== undefined) {
		if (!isObject(raw.models)) throw settingsError('"models" must be an object keyed by model id');
		for (const [id, value] of Object.entries(raw.models)) {
			if (!isObject(value)) throw settingsError(`"models.${id}" must be an object`);
			models[id] = { region: optionalString(value.region, `models.${id}.region`) };
		}
	}
	let serverTools = DEFAULT_SERVER_TOOLS;
	if (raw.serverTools !== undefined) {
		if (!Array.isArray(raw.serverTools) || !raw.serverTools.every(isObject)) {
			throw settingsError('"serverTools" must be an array of tool objects');
		}
		serverTools = raw.serverTools;
	}
	return { region, regions: [...new Set([region, ...extraRegions])], models, serverTools };
}

function optionalString(value: unknown, name: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value === "") throw settingsError(`"${name}" must be a non-empty string`);
	return value;
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item !== "")) {
		throw settingsError(`"${name}" must be an array of Region names`);
	}
	return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function settingsError(message: string): Error {
	return new Error(`extensionSettings["${SETTINGS_KEY}"]: ${message}`);
}
