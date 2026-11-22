// The provider's models: the GPT models from pi's amazon-bedrock catalog, each assigned to the
// Mantle Region that serves it.

import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { MantleSettings } from "./settings.ts";

/** A catalog model id and the Region its requests go to. */
export interface ModelRegion {
	id: string;
	region: string;
}

// Bedrock serves web search for GPT-5.4 and later on Mantle; gpt-oss models have no web search.
const WEB_SEARCH_MODEL = /^openai\.gpt-\d/;
const MODEL_LIST_TIMEOUT_MS = 3000;

/** The Mantle Responses base URL of a Region. */
export function mantleBaseUrl(region: string): string {
	return `https://bedrock-mantle.${region}.api.aws/openai/v1`;
}

/** Provider model configs for the GPT models, each with the base URL of its Region. */
export async function mantleModels(
	settings: MantleSettings,
	fetchForRegion: (region: string) => typeof fetch,
): Promise<ProviderModelConfig[]> {
	const catalog = getBuiltinModels("amazon-bedrock").filter(
		(model) => WEB_SEARCH_MODEL.test(model.id) && !model.id.includes(":"),
	);
	const lists = new Map(
		await Promise.all(
			settings.regions.map(async (region) => [region, await listRegionModels(region, fetchForRegion(region))] as const),
		),
	);
	const regions = new Map(assignRegions(catalog.map((model) => model.id), settings, lists).map((m) => [m.id, m.region]));
	return catalog.flatMap((model) => {
		const region = regions.get(model.id);
		if (region === undefined) return [];
		return [
			{
				id: model.id,
				name: region === settings.region ? model.name : `${model.name} (${region})`,
				baseUrl: mantleBaseUrl(region),
				reasoning: model.reasoning,
				thinkingLevelMap: model.thinkingLevelMap,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				// Mantle does not document OpenAI's extended prompt cache retention.
				compat: { supportsStrictMode: true, supportsLongCacheRetention: false },
			},
		];
	});
}

/**
 * Pick each model's Region: the Region pinned in settings, else the first Region in
 * `settings.regions` whose model list has it. A model no list has is left out, except that a
 * Region whose list could not be read counts as serving every model, so a slow or failed list
 * read does not hide models.
 */
export function assignRegions(
	ids: readonly string[],
	settings: Pick<MantleSettings, "regions" | "models">,
	lists: ReadonlyMap<string, ReadonlySet<string> | undefined>,
): ModelRegion[] {
	return ids.flatMap((id) => {
		const pinned = settings.models[id]?.region;
		if (pinned !== undefined) return [{ id, region: pinned }];
		const region = settings.regions.find((candidate) => {
			const list = lists.get(candidate);
			return list === undefined || list.has(id);
		});
		return region === undefined ? [] : [{ id, region }];
	});
}

/** Model ids Mantle lists in a Region, or undefined when the list cannot be read in time. */
async function listRegionModels(region: string, signedFetch: typeof fetch): Promise<Set<string> | undefined> {
	try {
		// The Models API lives under /v1 for every model, not under /openai/v1.
		const response = await signedFetch(`https://bedrock-mantle.${region}.api.aws/v1/models`, {
			signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
		});
		if (!response.ok) return undefined;
		// Wire input from Mantle.
		const body = (await response.json()) as { data?: { id?: string }[] };
		return new Set((body.data ?? []).flatMap((model) => (model.id ? [model.id] : [])));
	} catch {
		// No credentials or no network at startup: treat the Region as serving every model.
		return undefined;
	}
}
