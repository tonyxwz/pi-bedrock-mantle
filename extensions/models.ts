// The provider's models: the GPT models from pi's amazon-bedrock catalog, each assigned to the
// Mantle Region that serves it, and the per-Region model lists that decide it.

import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { MantleSettings } from "./settings.ts";

/** Model ids Mantle lists per Region; undefined for a Region whose list is unknown. */
export type RegionModelLists = ReadonlyMap<string, ReadonlySet<string> | undefined>;

/** A catalog model id and the Region its requests go to. */
export interface ModelRegion {
	id: string;
	region: string;
}

// Bedrock serves web search for GPT-5.4 and later on Mantle; gpt-oss models have no web search.
const WEB_SEARCH_MODEL = /^openai\.gpt-\d/;
const REGION_IN_BASE_URL = /^https:\/\/bedrock-mantle\.([a-z0-9-]+)\.api\.aws\//;

/** The Mantle Responses base URL of a Region. */
export function mantleBaseUrl(region: string): string {
	return `https://bedrock-mantle.${region}.api.aws/openai/v1`;
}

/** The Region of a Mantle base URL, or undefined for any other URL. */
export function regionOfBaseUrl(baseUrl: string): string | undefined {
	return REGION_IN_BASE_URL.exec(baseUrl)?.[1];
}

/** The GPT models, each with the base URL of its Region, labeled with `provider` and `api`. */
export function mantleModels(
	settings: MantleSettings,
	lists: RegionModelLists,
	provider: string,
	api: Api,
): Model<Api>[] {
	const catalog = getBuiltinModels("amazon-bedrock").filter(
		(model) => WEB_SEARCH_MODEL.test(model.id) && !model.id.includes(":"),
	);
	const regions = new Map(assignRegions(catalog.map((model) => model.id), settings, lists).map((m) => [m.id, m.region]));
	return catalog.flatMap((model) => {
		const region = regions.get(model.id);
		if (region === undefined) return [];
		return [
			{
				type: "chat",
				id: model.id,
				// The selector shows "<id> (<name>)", so a Region is enough for models outside the home Region.
				name: region === settings.region ? model.name : region,
				provider,
				api,
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
 * Region whose list is unknown counts as serving every model, so a failed list read hides nothing.
 */
export function assignRegions(
	ids: readonly string[],
	settings: Pick<MantleSettings, "regions" | "models">,
	lists: RegionModelLists,
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

/**
 * Model lists rebuilt from the models saved by the last refresh: each Region serves the models
 * that were assigned to it. Regions added to the settings since then have no saved models and
 * stay empty until the next refresh reads their lists.
 */
export function savedModelLists(saved: readonly Pick<Model<Api>, "id" | "baseUrl">[], regions: readonly string[]): RegionModelLists {
	const lists = new Map<string, Set<string>>(regions.map((region) => [region, new Set()]));
	for (const model of saved) {
		const region = regionOfBaseUrl(model.baseUrl);
		if (region !== undefined) lists.get(region)?.add(model.id);
	}
	return lists;
}

/** Read every Region's model list at once. A Region whose list cannot be read keeps `fallback`. */
export async function readModelLists(
	regions: readonly string[],
	fetchForRegion: (region: string) => typeof fetch,
	fallback: RegionModelLists,
	signal: AbortSignal,
): Promise<RegionModelLists> {
	const read = await Promise.all(
		regions.map(async (region) => [region, await readRegionModels(region, fetchForRegion(region), signal)] as const),
	);
	return new Map(read.map(([region, list]) => [region, list ?? fallback.get(region)]));
}

// Lists are read in the background, so a slow Region delays nothing; the limit only bounds the wait.
const MODEL_LIST_TIMEOUT_MS = 10_000;

/** Model ids Mantle lists in a Region, or undefined when the list cannot be read. */
async function readRegionModels(
	region: string,
	signedFetch: typeof fetch,
	signal: AbortSignal,
): Promise<Set<string> | undefined> {
	try {
		// The Models API lives under /v1 for every model, not under /openai/v1.
		const response = await signedFetch(`https://bedrock-mantle.${region}.api.aws/v1/models`, {
			signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)]),
		});
		if (!response.ok) return undefined;
		// Wire input from Mantle.
		const body = (await response.json()) as { data?: { id?: string }[] };
		return new Set((body.data ?? []).flatMap((model) => (model.id ? [model.id] : [])));
	} catch {
		// No credentials, no network, or cancelled.
		return undefined;
	}
}
