// Pi provider for OpenAI GPT models on Amazon Bedrock Mantle, signed with SigV4, with Mantle's
// server-side web search. See README.md for installation and configuration.
//
// Requests reuse pi-ai's OpenAI Responses implementation. This extension only changes the
// endpoint, signs each request, adds the server tools, and keeps web search calls across turns.

import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Model,
	openAIResponsesApi,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { mantleBaseUrl, mantleModels } from "./models.ts";
import { readMantleSettings } from "./settings.ts";
import { createMantleSigV4Fetch } from "./sigv4-fetch.ts";
import {
	describeWebSearchCall,
	prepareResponsesPayload,
	type RecordedWebSearchCall,
	recordWebSearch,
	type WebSearchCallItem,
	type WebSearchRecord,
} from "./web-search.ts";

const PROVIDER_ID = "bedrock-mantle";
// A custom api id routes this provider's models to streamMantle instead of the built-in
// openai-responses implementation, which other providers keep using.
const PROVIDER_API = "bedrock-mantle-responses";
const ENTRY_TYPE = "bedrock-mantle-web-search";
const REGION_IN_BASE_URL = /^https:\/\/bedrock-mantle\.([a-z0-9-]+)\.api\.aws\//;

export default async function (pi: ExtensionAPI) {
	// Read once per load; /reload picks up changes.
	const settings = readMantleSettings();
	const fetches = new Map<string, typeof fetch>();
	const fetchForRegion = (region: string) => {
		let signedFetch = fetches.get(region);
		if (!signedFetch) {
			signedFetch = createMantleSigV4Fetch(region);
			fetches.set(region, signedFetch);
		}
		return signedFetch;
	};
	const recorded = new Map<string, RecordedWebSearchCall>();
	const pending = new Map<string, WebSearchRecord>();

	const remember = (record: WebSearchRecord) => {
		for (const call of record.calls) recorded.set(call.item.id, call);
	};

	const streamMantle = (
		model: Model<Api>,
		context: TranscriptContext,
		options?: SimpleStreamOptions,
	): AssistantMessageEventStream => {
		const region = REGION_IN_BASE_URL.exec(model.baseUrl)?.[1];
		if (!region) throw new Error(`${model.id}: base URL ${model.baseUrl} is not a Bedrock Mantle endpoint`);
		const responsesModel = { ...model, api: "openai-responses" } as Model<"openai-responses">;
		const inner = openAIResponsesApi().streamSimple(responsesModel, toResponsesContext(context), {
			...options,
			// The OpenAI SDK needs a key; the signed fetch replaces its Authorization header.
			apiKey: "sigv4",
			fetch: fetchForRegion(region),
			onPayload: async (payload, payloadModel) => {
				const prepared = prepareResponsesPayload(payload, settings.serverTools, recorded);
				return (await options?.onPayload?.(prepared, payloadModel)) ?? prepared;
			},
			onProviderStreamEvent: async (data, eventModel) => {
				const record = recordFromStreamEvent(data);
				if (record) pending.set(record.responseId, record);
				await options?.onProviderStreamEvent?.(data, eventModel);
			},
		});
		return relabel(inner);
	};

	pi.registerProvider(PROVIDER_ID, {
		name: "Amazon Bedrock Mantle",
		baseUrl: mantleBaseUrl(settings.region),
		apiKey: "sigv4",
		api: PROVIDER_API,
		models: await mantleModels(settings, fetchForRegion),
		streamSimple: streamMantle,
	});

	pi.on("session_start", (_event, ctx) => {
		recorded.clear();
		pending.clear();
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE) remember(entry.data as WebSearchRecord);
		}
	});

	pi.on("provider_stream_event", (event, ctx) => {
		if (event.provider !== PROVIDER_ID) return;
		const data = event.data as { type?: string; item?: { type?: string } };
		if (data.item?.type !== "web_search_call") return;
		if (data.type === "response.output_item.added") ctx.ui.setWorkingMessage("Searching the web...");
		if (data.type === "response.output_item.done") {
			ctx.ui.setWorkingMessage(`Web: ${describeWebSearchCall(data.item as WebSearchCallItem)}`);
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role === "assistant" && event.message.provider === PROVIDER_ID) ctx.ui.setWorkingMessage();
	});

	pi.on("turn_end", (event) => {
		if (event.message.role !== "assistant" || event.message.provider !== PROVIDER_ID) return;
		const responseId = event.message.responseId;
		const record = responseId ? pending.get(responseId) : undefined;
		if (!responseId || !record) return;
		pending.delete(responseId);
		remember(record);
		pi.appendEntry(ENTRY_TYPE, record);
	});

	pi.registerEntryRenderer<WebSearchRecord>(ENTRY_TYPE, (entry, options, theme) => {
		const { calls, sources } = entry.data ?? { calls: [], sources: [] };
		const lines = [theme.fg("accent", `Web search: ${calls.length} call${calls.length === 1 ? "" : "s"}`)];
		for (const call of calls) lines.push(theme.fg("dim", `  ${describeWebSearchCall(call.item)}`));
		if (options.expanded) {
			for (const source of sources) lines.push(theme.fg("muted", `  ${source.title}: ${source.url}`));
		} else if (sources.length > 0) {
			const hint = options.keyHint("app.tools.expand", "to list");
			lines.push(theme.fg("dim", `  ${sources.length} cited source${sources.length === 1 ? "" : "s"} (${hint})`));
		}
		return new Text(lines.join("\n"), 1, 0);
	});
}

/**
 * Stored assistant messages carry this provider's api id. pi-ai replays reasoning and message ids
 * only for messages of the same provider and api, so map them to the api it actually ran.
 */
function toResponsesContext(context: TranscriptContext): TranscriptContext {
	return {
		...context,
		messages: context.messages.map((message) =>
			message.role === "assistant" && message.provider === PROVIDER_ID && message.api === PROVIDER_API
				? { ...message, api: "openai-responses" }
				: message,
		),
	};
}

/** Forward the inner stream with the assistant message labeled with this provider's api id. */
function relabel(inner: AssistantMessageEventStream): AssistantMessageEventStream {
	const outer = createAssistantMessageEventStream();
	const label = (message: AssistantMessage) => {
		message.api = PROVIDER_API;
	};
	(async () => {
		for await (const event of inner) {
			// Later partials are the same object as the start partial, so labeling it once is enough.
			if (event.type === "start") label(event.partial);
			else if (event.type === "done") label(event.message);
			else if (event.type === "error") label(event.error);
			outer.push(event);
		}
		outer.end();
	})();
	return outer;
}

/** The web search record of a `response.completed` or `response.incomplete` stream event. */
function recordFromStreamEvent(data: unknown): WebSearchRecord | undefined {
	// Wire input: a parsed Responses stream event.
	const event = data as { type?: string; response?: { id?: string; output?: unknown[] } };
	if (event.type !== "response.completed" && event.type !== "response.incomplete") return undefined;
	if (!event.response?.id || !event.response.output) return undefined;
	return recordWebSearch(event.response.id, event.response.output);
}
