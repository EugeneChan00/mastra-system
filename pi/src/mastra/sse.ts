export interface SseDataEvent {
	data: string;
	event?: string;
	id?: string;
}

export class SseParseError extends Error {
	constructor(
		message: string,
		readonly data: string,
	) {
		super(message);
		this.name = "SseParseError";
	}
}

export async function* parseSseDataEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseDataEvent> {
	const decoder = new TextDecoder();
	let buffer = "";

	for await (const chunk of stream) {
		buffer += decoder.decode(chunk, { stream: true });
		yield* drainCompleteEvents(buffer, (remaining) => {
			buffer = remaining;
		});
	}

	buffer += decoder.decode();
	if (buffer.trim().length > 0) {
		yield parseSseEvent(buffer);
	}
}

export function parseSseText(input: string): SseDataEvent[] {
	const events: SseDataEvent[] = [];
	let buffer = input;
	for (const event of drainCompleteEvents(buffer, (remaining) => {
		buffer = remaining;
	})) {
		events.push(event);
	}
	if (buffer.trim().length > 0) {
		events.push(parseSseEvent(buffer));
	}
	return events;
}

function* drainCompleteEvents(input: string, setRemaining: (remaining: string) => void): Generator<SseDataEvent> {
	const normalized = input.replace(/\r\n/g, "\n");
	let cursor = 0;

	while (true) {
		const boundary = normalized.indexOf("\n\n", cursor);
		if (boundary === -1) break;

		const block = normalized.slice(cursor, boundary);
		cursor = boundary + 2;
		if (block.trim().length > 0) {
			yield parseSseEvent(block);
		}
	}

	setRemaining(normalized.slice(cursor));
}

function parseSseEvent(block: string): SseDataEvent {
	const data: string[] = [];
	let event: string | undefined;
	let id: string | undefined;

	for (const line of block.split("\n")) {
		if (line.length === 0 || line.startsWith(":")) continue;
		const colon = line.indexOf(":");
		const field = colon === -1 ? line : line.slice(0, colon);
		const rawValue = colon === -1 ? "" : line.slice(colon + 1);
		const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

		if (field === "data") data.push(value);
		if (field === "event") event = value;
		if (field === "id") id = value;
	}

	return { data: data.join("\n"), event, id };
}

export function parseSseJsonData(data: string): unknown {
	if (data === "[DONE]") return data;
	try {
		return JSON.parse(data) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new SseParseError(`Invalid SSE JSON data: ${message}`, data);
	}
}

