// Mantle server-side tools in pi: adds them to Responses requests, records the `web_search_call`
// items pi-ai drops from the response, and puts them back into later requests so the model keeps
// its searches across turns.
//
// pi-ai only keeps reasoning, message and function-call items. A turn with searches looks like
//   [rs_1, ws_1, rs_2, ws_2, msg_1]
// and pi replays it as [rs_1, rs_2, msg_1]. Mantle accepts that, but the model no longer knows
// what it searched. Each recorded call keeps the id of the item after it (or before it, when it is
// last), so the replay can put it back in place: [rs_1, ws_1, rs_2, ws_2, msg_1].

/** A `web_search_call` output item, as Mantle returns it and accepts it back as input. */
export interface WebSearchCallItem {
	type: "web_search_call";
	id: string;
	status?: string;
	action?: { type?: string; query?: string; queries?: string[]; url?: string };
}

/** A recorded search call and where it sat between the items pi replays. */
export interface RecordedWebSearchCall {
	item: WebSearchCallItem;
	/** Id of the next replayed item (reasoning, message or function call). */
	before?: string;
	/** Id of the previous replayed item, used when no item follows. */
	after?: string;
}

/** A source the answer cited. */
export interface CitedSource {
	title: string;
	url: string;
}

/** What one response did with web search; persisted as a custom session entry. */
export interface WebSearchRecord {
	responseId: string;
	calls: RecordedWebSearchCall[];
	sources: CitedSource[];
}

/** Responses request fields this module reads and changes. */
interface ResponsesPayload {
	input?: unknown[];
	tools?: unknown[];
}

/** Response output item fields this module reads. Wire data: every field may be missing. */
interface OutputItem {
	type?: string;
	id?: string;
	content?: { type?: string; annotations?: { type?: string; title?: string; url?: string }[] }[];
}

/** Add the configured server tools and the recorded search calls to a Responses request. */
export function prepareResponsesPayload(
	payload: unknown,
	serverTools: readonly Record<string, unknown>[],
	calls: ReadonlyMap<string, RecordedWebSearchCall>,
): unknown {
	const request = payload as ResponsesPayload;
	const tools = serverTools.length > 0 ? [...(request.tools ?? []), ...serverTools] : request.tools;
	const input = request.input && calls.size > 0 ? replayWebSearchCalls(request.input, calls) : request.input;
	return { ...request, tools, input };
}

/** Insert recorded search calls next to the replayed items they were anchored to. */
function replayWebSearchCalls(input: readonly unknown[], calls: ReadonlyMap<string, RecordedWebSearchCall>): unknown[] {
	const result = [...input];
	const present = new Set(result.map((item) => (item as OutputItem).id).filter((id) => id !== undefined));
	for (const call of calls.values()) {
		if (present.has(call.item.id)) continue;
		const index = insertionIndex(result, call);
		if (index === undefined) continue;
		result.splice(index, 0, call.item);
		present.add(call.item.id);
	}
	return result;
}

/**
 * Where a recorded call goes, or undefined when its anchor is not in this request (the turn was
 * compacted away or belongs to another branch). Calls arrive in response order, so a call anchored
 * before an item lands after the calls already inserted there, and a call anchored after an item
 * skips the calls already inserted after it.
 */
function insertionIndex(input: readonly unknown[], call: RecordedWebSearchCall): number | undefined {
	const ids = input.map((item) => (item as OutputItem).id);
	if (call.before !== undefined) {
		const index = ids.indexOf(call.before);
		if (index !== -1) return index;
	}
	if (call.after !== undefined) {
		let index = ids.indexOf(call.after);
		if (index === -1) return undefined;
		index++;
		while (index < input.length && (input[index] as OutputItem).type === "web_search_call") index++;
		return index;
	}
	return undefined;
}

/** Record the search calls and cited sources of a finished response; undefined if it did not search. */
export function recordWebSearch(responseId: string, output: readonly unknown[]): WebSearchRecord | undefined {
	const items = output as readonly OutputItem[];
	const calls: RecordedWebSearchCall[] = [];
	items.forEach((item, index) => {
		if (item.type !== "web_search_call" || item.id === undefined) return;
		calls.push({
			item: item as WebSearchCallItem,
			before: neighbourId(items, index, 1),
			after: neighbourId(items, index, -1),
		});
	});
	if (calls.length === 0) return undefined;
	return { responseId, calls, sources: citedSources(items) };
}

/** Id of the nearest item in `direction` that pi replays, skipping other search calls. */
function neighbourId(items: readonly OutputItem[], index: number, direction: 1 | -1): string | undefined {
	for (let i = index + direction; i >= 0 && i < items.length; i += direction) {
		if (items[i].type !== "web_search_call") return items[i].id;
	}
	return undefined;
}

/** The `url_citation` annotations of the response's messages, one per URL. */
export function citedSources(items: readonly unknown[]): CitedSource[] {
	const sources = new Map<string, CitedSource>();
	for (const item of items as readonly OutputItem[]) {
		if (item.type !== "message") continue;
		for (const part of item.content ?? []) {
			for (const annotation of part.annotations ?? []) {
				if (annotation.type !== "url_citation" || !annotation.url) continue;
				sources.set(annotation.url, { title: annotation.title || annotation.url, url: annotation.url });
			}
		}
	}
	return [...sources.values()];
}

/** A one-line description of a search call for status lines and the transcript. */
export function describeWebSearchCall(item: WebSearchCallItem): string {
	const action = item.action;
	if (action?.type === "open_page" && action.url) return `open ${action.url}`;
	if (action?.type === "find_in_page" && action.url) return `find in ${action.url}`;
	const query = action?.queries?.length ? action.queries.join("; ") : action?.query;
	return query ? `search "${query}"` : "search";
}
