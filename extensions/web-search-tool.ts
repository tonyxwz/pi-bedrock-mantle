// The `web_search` tool: lets models of other providers search the web through a Mantle
// GPT model and its server-side web search. Mantle's own GPT models search natively, so their
// requests leave this tool out.

import { type Api, calculateCost, type Model, type Usage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MantleSettings, WebSearchToolSettings } from "./settings.ts";
import { type CitedSource, citedSources, describeWebSearchCall, recordWebSearch } from "./web-search.ts";

/** What a search returned besides the answer text; kept on the tool result. */
export interface WebSearchToolDetails {
	model: string;
	region: string;
	queries: string[];
	sources: CitedSource[];
}

export const WEB_SEARCH_TOOL_NAME = "web_search";

// The searching model answers a query for another model, so it should report facts and sources
// rather than chat.
const INSTRUCTIONS =
	"Search the web to answer the query. Reply with the facts found, concise and specific, and cite the source URL of each fact. If the results do not answer the query, say so.";

/** Register the tool. `findModel` returns the provider's current model for an id, if offered. */
export function registerWebSearchTool(
	pi: ExtensionAPI,
	settings: MantleSettings,
	tool: WebSearchToolSettings,
	findModel: (id: string) => Model<Api> | undefined,
	fetchForModel: (model: Model<Api>) => { region: string; fetch: typeof fetch },
): void {
	pi.registerTool({
		name: WEB_SEARCH_TOOL_NAME,
		label: "Web Search",
		description:
			"Search the web for current information. Returns an answer with the source URLs it is based on. Use it for recent events, current versions and prices, documentation, and facts you are unsure of.",
		parameters: Type.Object({
			query: Type.String({ description: "What to find out, as a question or search request" }),
		}),
		annotations: { readOnlyHint: true, openWorldHint: true },
		async execute(_toolCallId, params, signal) {
			const model = findModel(tool.model);
			if (!model) {
				throw new Error(
					`${tool.model} is not offered by the bedrock-mantle provider; set webSearchTool.model, or pin the model's Region`,
				);
			}
			const { region, fetch: signedFetch } = fetchForModel(model);
			const response = await signedFetch(`${model.baseUrl}/responses`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: model.id,
					instructions: INSTRUCTIONS,
					input: params.query,
					tools: searchTools(settings),
					reasoning: { effort: tool.reasoningEffort },
					store: false,
				}),
				signal,
			});
			if (!response.ok) throw new Error(`Mantle web search failed: ${response.status} ${await response.text()}`);
			// Wire input from Mantle.
			const body = (await response.json()) as ResponsesResult;
			const output = body.output ?? [];
			const answer = output
				.flatMap((item) => (item.type === "message" ? (item.content ?? []) : []))
				.map((part) => part.text ?? "")
				.join("");
			const queries = (recordWebSearch(body.id ?? "", output)?.calls ?? []).map((call) =>
				describeWebSearchCall(call.item),
			);
			const sources = citedSources(output);
			const sourceList = sources.map((source) => `- ${source.title}: ${source.url}`).join("\n");
			return {
				content: [{ type: "text", text: sourceList ? `${answer}\n\nSources:\n${sourceList}` : answer }],
				details: { model: model.id, region, queries, sources } satisfies WebSearchToolDetails,
				usage: toUsage(model, body.usage),
			};
		},
	});
}

/** A Responses request payload without this tool, for Mantle's GPT models, which search natively. */
export function withoutWebSearchTool(payload: unknown): unknown {
	const request = payload as { tools?: { type?: string; name?: string }[] };
	if (!request.tools) return payload;
	const tools = request.tools.filter((tool) => !(tool.type === "function" && tool.name === WEB_SEARCH_TOOL_NAME));
	return { ...request, tools: tools.length > 0 ? tools : undefined };
}

/** The configured web search server tools, or the default one when `serverTools` has none. */
function searchTools(settings: MantleSettings): Record<string, unknown>[] {
	const configured = settings.serverTools.filter((tool) => tool.type === "web_search");
	return configured.length > 0 ? configured : [{ type: "web_search", external_web_access: false }];
}

/** Response fields this tool reads. Wire data: every field may be missing. */
interface ResponsesResult {
	id?: string;
	output?: { type?: string; content?: { type?: string; text?: string }[] }[];
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		total_tokens?: number;
		input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
		output_tokens_details?: { reasoning_tokens?: number };
	};
}

/** The search request's usage in pi's form, priced with the model's catalog prices. */
function toUsage(model: Model<Api>, usage: ResponsesResult["usage"]): Usage {
	const cacheRead = usage?.input_tokens_details?.cached_tokens ?? 0;
	const cacheWrite = usage?.input_tokens_details?.cache_write_tokens ?? 0;
	const result: Usage = {
		// OpenAI includes cached and cache-write tokens in input_tokens.
		input: Math.max(0, (usage?.input_tokens ?? 0) - cacheRead - cacheWrite),
		output: usage?.output_tokens ?? 0,
		cacheRead,
		cacheWrite,
		reasoning: usage?.output_tokens_details?.reasoning_tokens ?? 0,
		totalTokens: usage?.total_tokens ?? 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	result.cost = calculateCost(model, result);
	return result;
}
