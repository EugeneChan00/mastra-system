import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MASTRA_AGENT_QUERY_TOOL_NAME, MASTRA_AGENT_RESULT_MESSAGE_TYPE, MASTRA_PI_AGENT_JOB_WORKFLOW_ID, MASTRA_STATUS_KEY } from "../const.js";
import { PI_HARNESS_MODE_MESSAGE_TYPE } from "../harness/mode.js";
import type { MastraAgentAsyncJobSummary } from "../mastra/index.js";
import { PI_AGENT_STARTUP_CONTEXT_MESSAGE_TYPE } from "../prompts/index.js";
import mastraPiExtension, { completionJobIdFromMessageEnd, formatAsyncAgentCompletion, hasCompletionReminder, matchesMastraWidgetShortcut } from "./index.js";

const stubTheme: Record<string, (...args: string[]) => string> = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	dim: (text: string) => text,
};

type TestExtensionHandler = (...args: any[]) => unknown;
type TestExtensionHandlers = Map<string, TestExtensionHandler[]>;

function addTestHandler(handlers: TestExtensionHandlers, event: string, handler: TestExtensionHandler): void {
	const eventHandlers = handlers.get(event) ?? [];
	eventHandlers.push(handler);
	handlers.set(event, eventHandlers);
}

function firstTestHandler(handlers: TestExtensionHandlers, event: string): TestExtensionHandler | undefined {
	return handlers.get(event)?.[0];
}

async function emitBeforeAgentStart(handlers: TestExtensionHandlers): Promise<any[]> {
	const results: any[] = [];
	for (const handler of handlers.get("before_agent_start") ?? []) {
		const result = await handler(
			{ prompt: "visible user prompt", systemPrompt: "base system prompt", systemPromptOptions: {} },
			{},
		);
		if (result) results.push(result);
	}
	return results;
}

function messagesFromBeforeAgentStartResults(results: any[]): any[] {
	return results.flatMap((result) => (result.message ? [result.message] : []));
}

test("formatAsyncAgentCompletion emits a system reminder with queued lifecycle and artifact chaining hint", () => {
	const text = formatAsyncAgentCompletion(fakeSummary({
		jobId: "job-1",
		jobName: "audit",
		agentId: "validator-agent",
		status: "done",
		lifecycleStatus: "agent_response_queued",
		threadId: "thread-1",
		runId: "run-1",
		artifactPath: "/tmp/output.txt",
		toolCalls: 1,
		toolResults: 1,
	}));

	assert.ok(text.startsWith("<system-reminder>\n"));
	assert.ok(text.endsWith("\n</system-reminder>"));
	assert.match(text, /Asynchronous Mastra agent task completed: job-1/);
	assert.match(text, /lifecycleStatus: agent_response_queued/);
	assert.match(text, /threadId: thread-1/);
	assert.match(text, /runId: run-1/);
	assert.match(text, /artifactPath: \/tmp\/output.txt/);
	assert.match(text, /Use agent_read with jobId=job-1/);
	assert.match(text, /artifactPath can be passed as an input_args value/);
});

test("completionJobIdFromMessageEnd only accepts matching custom completion messages", () => {
	assert.equal(
		completionJobIdFromMessageEnd({
			message: {
				role: "custom",
				customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
				details: { jobId: "job-1" },
			},
		}),
		"job-1",
	);
	assert.equal(
		completionJobIdFromMessageEnd({
			message: {
				role: "custom",
				customType: "other",
				details: { jobId: "job-1" },
			},
		}),
		undefined,
	);
	assert.equal(
		completionJobIdFromMessageEnd({
			message: {
				role: "assistant",
				customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
				details: { jobId: "job-1" },
			},
		}),
		undefined,
	);
	assert.equal(completionJobIdFromMessageEnd({ message: { role: "custom", customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE, details: {} } }), undefined);
});

test("hasCompletionReminder matches persisted custom completion entries by job id", () => {
	const entries = [
		{ type: "custom_message", customType: "other", details: { jobId: "job-1" } },
		{ type: "assistant_message", customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE, details: { jobId: "job-1" } },
		{ type: "custom_message", customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE, details: { jobId: "job-2" } },
	];

	assert.equal(hasCompletionReminder(entries, "job-1"), false);
	assert.equal(hasCompletionReminder(entries, "job-2"), true);
});

test("before_agent_start injects startup and changed mode context without mutating system prompt", async () => {
	const handlers: TestExtensionHandlers = new Map();
	const customEntries: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		registerTool() {},
		registerMessageRenderer() {},
		registerCommand() {},
		registerShortcut() {},
		on(event: string, handler: (...args: any[]) => unknown) {
			addTestHandler(handlers, event, handler);
		},
		sendMessage() {},
		appendEntry(customType: string, data: unknown) {
			customEntries.push({ customType, data });
		},
	};
	mastraPiExtension(pi as any);

	const firstResults = await emitBeforeAgentStart(handlers);
	assert.ok(firstResults.length >= 2);
	assert.equal(firstResults.some((result) => result.systemPrompt !== undefined), false);

	const firstMessages = messagesFromBeforeAgentStartResults(firstResults);
	const startupMessage = firstMessages.find((message) => message.customType === PI_AGENT_STARTUP_CONTEXT_MESSAGE_TYPE);
	const modeMessage = firstMessages.find((message) => message.customType === PI_HARNESS_MODE_MESSAGE_TYPE);
	assert.equal(startupMessage.display, false);
	assert.match(startupMessage.content, /Tooling decision matrix/);
	assert.match(startupMessage.content, /Environment execution policy/);
	assert.equal(modeMessage.display, false);
	assert.match(modeMessage.content, /\[HARNESS MODE: BALANCED\]/);
	assert.deepEqual(customEntries, [
		{
			customType: "pi-harness-mode-state",
			data: { version: 1, selectedMode: "balanced", lastSubmittedMode: "balanced" },
		},
	]);

	const secondMessages = messagesFromBeforeAgentStartResults(await emitBeforeAgentStart(handlers));
	assert.deepEqual(secondMessages, []);
	assert.equal(customEntries.length, 1);
});

test("Shift+Tab cycles harness mode and next submitted prompt emits changed mode", async () => {
	const originalFetch = globalThis.fetch;
	const handlers: TestExtensionHandlers = new Map();
	const customEntries: Array<{ customType: string; data: any }> = [];
	const statusCalls: Array<{ key: string; value: string }> = [];
	const notifications: string[] = [];
	let editorFactory: ((tui: any, theme: any, keybindings: any) => any) | undefined;

	globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
		const requestUrl = String(url);
		if (requestUrl.endsWith("/agents?partial=true")) {
			return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
		}
		if (requestUrl.endsWith("/workflows?partial=true")) {
			return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
		}
		if (requestUrl.includes(`/workflows/${encodeURIComponent(MASTRA_PI_AGENT_JOB_WORKFLOW_ID)}/runs?`)) {
			return new Response(JSON.stringify({ runs: [] }), { status: 200, headers: { "content-type": "application/json" } });
		}
		return new Response("not found", { status: 404, statusText: "Not Found" });
	}) as typeof fetch;

	try {
		const pi = {
			registerTool() {},
			registerMessageRenderer() {},
			registerCommand() {},
			registerShortcut() {},
			on(event: string, handler: (...args: any[]) => unknown) {
				addTestHandler(handlers, event, handler);
			},
			sendMessage() {},
			appendEntry(customType: string, data: unknown) {
				customEntries.push({ customType, data });
			},
		};
		mastraPiExtension(pi as any);

		const sessionStart = firstTestHandler(handlers, "session_start");
		assert.equal(typeof sessionStart, "function");
		await sessionStart?.(
			{},
			{
				cwd: "/workspace/project",
				hasUI: true,
				sessionManager: {
					getSessionId: () => "session-harness",
					getEntries: () => [],
				},
				ui: {
					theme: stubTheme,
					notify(message: string) {
						notifications.push(message);
					},
					onTerminalInput() {
						return () => undefined;
					},
					setEditorComponent(factory: typeof editorFactory) {
						editorFactory = factory;
					},
					setWidget() {},
					setStatus(key: string, value: string) {
						statusCalls.push({ key, value });
					},
				},
			},
		);

		assert.equal(typeof editorFactory, "function");
		assert.ok(statusCalls.some((call) => call.key === "harness-mode" && call.value === "Mode: balanced"));
		const initialMessages = messagesFromBeforeAgentStartResults(await emitBeforeAgentStart(handlers));
		assert.ok(initialMessages.some((message) => message.customType === PI_HARNESS_MODE_MESSAGE_TYPE && /\[HARNESS MODE: BALANCED\]/.test(message.content)));
		assert.deepEqual(customEntries.at(-1), {
			customType: "pi-harness-mode-state",
			data: { version: 1, selectedMode: "balanced", lastSubmittedMode: "balanced" },
		});

		let renderRequests = 0;
		const editor = editorFactory!(
			{ requestRender: () => renderRequests++, terminal: { rows: 30 } },
			{ borderColor: (text: string) => text, selectList: {} },
			{ matches: (data: string, key: string) => data === "shift+tab" && key === "app.thinking.cycle" },
		);

		editor.handleInput("shift+tab");

		assert.equal(renderRequests, 1);
		assert.ok(notifications.includes("Mode: precision"));
		assert.ok(statusCalls.some((call) => call.key === "harness-mode" && call.value === "Mode: precision"));
		assert.ok(editor.render(40).some((line: string) => line.includes("Mode: precision")));
		assert.deepEqual(customEntries.at(-1), {
			customType: "pi-harness-mode-state",
			data: { version: 1, selectedMode: "precision", lastSubmittedMode: "balanced" },
		});
		const changedModeMessages = messagesFromBeforeAgentStartResults(await emitBeforeAgentStart(handlers));
		assert.equal(changedModeMessages.length, 1);
		assert.equal(changedModeMessages[0].customType, PI_HARNESS_MODE_MESSAGE_TYPE);
		assert.match(changedModeMessages[0].content, /\[HARNESS MODE: PRECISION\]/);
		assert.deepEqual(customEntries.at(-1), {
			customType: "pi-harness-mode-state",
			data: { version: 1, selectedMode: "precision", lastSubmittedMode: "precision" },
		});
		assert.deepEqual(messagesFromBeforeAgentStartResults(await emitBeforeAgentStart(handlers)), []);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("session_start restores submitted harness mode state for continue and resume", async () => {
	const originalFetch = globalThis.fetch;
	const handlers: TestExtensionHandlers = new Map();
	const customEntries: Array<{ customType: string; data: unknown }> = [];

	globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
		const requestUrl = String(url);
		if (requestUrl.endsWith("/agents?partial=true") || requestUrl.endsWith("/workflows?partial=true")) {
			return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
		}
		if (requestUrl.includes(`/workflows/${encodeURIComponent(MASTRA_PI_AGENT_JOB_WORKFLOW_ID)}/runs?`)) {
			return new Response(JSON.stringify({ runs: [] }), { status: 200, headers: { "content-type": "application/json" } });
		}
		return new Response("not found", { status: 404, statusText: "Not Found" });
	}) as typeof fetch;

	try {
		const pi = {
			registerTool() {},
			registerMessageRenderer() {},
			registerCommand() {},
			registerShortcut() {},
			on(event: string, handler: (...args: any[]) => unknown) {
				addTestHandler(handlers, event, handler);
			},
			sendMessage() {},
			appendEntry(customType: string, data: unknown) {
				customEntries.push({ customType, data });
			},
		};
		mastraPiExtension(pi as any);

		const sessionStart = firstTestHandler(handlers, "session_start");
		assert.equal(typeof sessionStart, "function");
		await sessionStart?.(
			{},
			{
				cwd: "/workspace/project",
				hasUI: false,
				sessionManager: {
					getSessionId: () => "session-resumed",
					getEntries: () => [
						{
							type: "custom",
							customType: "pi-harness-mode-state",
							data: { version: 1, selectedMode: "precision", lastSubmittedMode: "balanced" },
						},
					],
				},
				ui: {
					theme: stubTheme,
					notify() {},
					setEditorComponent() {},
					setWidget() {},
					setStatus() {},
				},
			},
		);

		const resumedMessages = messagesFromBeforeAgentStartResults(await emitBeforeAgentStart(handlers));
		assert.ok(resumedMessages.some((message) => message.customType === PI_HARNESS_MODE_MESSAGE_TYPE && /\[HARNESS MODE: PRECISION\]/.test(message.content)));
		assert.deepEqual(customEntries.at(-1), {
			customType: "pi-harness-mode-state",
			data: { version: 1, selectedMode: "precision", lastSubmittedMode: "precision" },
		});
		assert.deepEqual(messagesFromBeforeAgentStartResults(await emitBeforeAgentStart(handlers)), []);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("matchesMastraWidgetShortcut avoids raw editor-key ambiguities", () => {
	assert.equal(matchesMastraWidgetShortcut("\b", "ctrl+h"), false, "raw backspace must not cycle the widget");
	assert.equal(matchesMastraWidgetShortcut("\n", "ctrl+j"), false, "raw line feed must not scroll the widget");
	assert.equal(matchesMastraWidgetShortcut("\x1b[104;5u", "ctrl+h"), true, "disambiguated ctrl+h should still work");
	assert.equal(matchesMastraWidgetShortcut("\x1b[106;5u", "ctrl+j"), true, "disambiguated ctrl+j should still work");
	assert.equal(matchesMastraWidgetShortcut("\x0b", "ctrl+k"), true);
	assert.equal(matchesMastraWidgetShortcut("\x1bh", "alt+h"), true);
	assert.equal(matchesMastraWidgetShortcut("\x1bj", "alt+j"), true);
	assert.equal(matchesMastraWidgetShortcut("\x1bk", "alt+k"), true);
	assert.equal(matchesMastraWidgetShortcut("\x1bs", "alt+s"), true);
});

test("extension queues async agent completion as steer reminder and message_end collapses activity", async () => {
	const originalFetch = globalThis.fetch;
	const cwd = await mkdtemp(join(tmpdir(), "mastra-extension-session-"));
	await writeFile(
		join(cwd, "config.yaml"),
		[
			"mastra-agent-extension:",
			"  defaultViewMode: list",
			"  viewModeShortcut: alt+h",
			"  nextAgentShortcut: n",
			"  previousAgentShortcut: p",
			"  detailScrollDownShortcut: alt+j",
			"  detailScrollUpShortcut: alt+k",
			"  detailStreamOnlyShortcut: alt+s",
		].join("\n"),
		"utf8",
	);
	const registeredTools: any[] = [];
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const shortcuts = new Map<string, { handler: (ctx: any) => unknown }>();
	const terminalInputHandlers: Array<(data: string) => { consume?: boolean; data?: string } | undefined> = [];
	const sentMessages: Array<{ message: any; options: any }> = [];
	const statusCalls: Array<{ key: string; value: string }> = [];
	const widgetFactories = new Map<string, (tui: any, theme: any) => any>();
	const clearedWidgetIds: string[] = [];
	const widgetCalls: Array<{ id: string; hasFactory: boolean; placement?: string }> = [];
	let workflowStreamCalls = 0;
	let agentStreamCalls = 0;
	let releaseAgentFinish: (() => void) | undefined;

	globalThis.fetch = (async (url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
		const requestUrl = String(url);
		if (requestUrl.endsWith("/agents?partial=true")) {
			return new Response(JSON.stringify({ "validator-agent": { id: "validator-agent", name: "Validator" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (requestUrl.endsWith("/workflows?partial=true")) {
			return new Response(JSON.stringify({ [MASTRA_PI_AGENT_JOB_WORKFLOW_ID]: { steps: {}, allSteps: {}, stepGraph: [] } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (requestUrl.includes(`/workflows/${encodeURIComponent(MASTRA_PI_AGENT_JOB_WORKFLOW_ID)}/runs?`)) {
			return new Response(JSON.stringify({ runs: [] }), { status: 200, headers: { "content-type": "application/json" } });
		}
		if (requestUrl.includes(`/workflows/${encodeURIComponent(MASTRA_PI_AGENT_JOB_WORKFLOW_ID)}/stream?`)) {
			workflowStreamCalls += 1;
			return new Response(
				`data: ${JSON.stringify({ type: "pi-agent-stream-chunk", payload: { chunk: { type: "finish" } } })}\n\ndata: [DONE]\n\n`,
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			);
		}
		if (requestUrl.endsWith("/agents/validator-agent/stream")) {
			agentStreamCalls += 1;
			const encoder = new TextEncoder();
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encoder.encode([
							`data: ${JSON.stringify({ type: "tool-call", toolCallId: "tool-1", toolName: "read_file", args: { path: "src/index.ts" } })}\n\n`,
							`data: ${JSON.stringify({ type: "tool-result", toolCallId: "tool-1", toolName: "read_file", result: "ok" })}\n\n`,
							`data: ${JSON.stringify({ type: "text-delta", text: Array.from({ length: 80 }, (_, index) => `- extension result ${index + 1}`).join("\n") })}\n\n`,
						].join("")));
						releaseAgentFinish = () => {
							controller.enqueue(encoder.encode([`data: ${JSON.stringify({ type: "finish" })}\n\n`, "data: [DONE]\n\n"].join("")));
							controller.close();
						};
					},
				}),
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			);
		}
		if (requestUrl.includes(`/workflows/${encodeURIComponent(MASTRA_PI_AGENT_JOB_WORKFLOW_ID)}/runs/`)) {
			return new Response(
				JSON.stringify({
					workflowName: MASTRA_PI_AGENT_JOB_WORKFLOW_ID,
					runId: requestUrl.split("/runs/")[1]?.split("?")[0] ?? "run",
					status: "success",
					result: { text: "extension result" },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return new Response("not found", { status: 404, statusText: "Not Found" });
	}) as typeof fetch;

	try {
		const pi = {
			registerTool(tool: any) {
				registeredTools.push(tool);
			},
			registerMessageRenderer() {},
			registerCommand() {},
			registerShortcut(shortcut: string, options: { handler: (ctx: any) => unknown }) {
				shortcuts.set(shortcut, options);
			},
			on(event: string, handler: (...args: any[]) => unknown) {
				handlers.set(event, handler);
			},
			sendMessage(message: any, options: any) {
				sentMessages.push({ message, options });
			},
			appendEntry() {},
		};
		mastraPiExtension(pi as any);

		const sessionStart = handlers.get("session_start");
		assert.equal(typeof sessionStart, "function");
		await sessionStart?.(
			{},
			{
				cwd,
				hasUI: true,
				sessionManager: {
					getSessionId: () => "session-extension",
					getEntries: () => [],
				},
				ui: {
					theme: stubTheme,
					notify() {},
					setEditorComponent() {},
					onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined) {
						terminalInputHandlers.push(handler);
						return () => {
							const index = terminalInputHandlers.indexOf(handler);
							if (index >= 0) terminalInputHandlers.splice(index, 1);
						};
					},
					setWidget(id: string, factory: ((tui: any, theme: any) => any) | undefined, options?: { placement?: string }) {
						widgetCalls.push({ id, hasFactory: typeof factory === "function", placement: options?.placement });
						if (factory) widgetFactories.set(id, factory);
						else {
							clearedWidgetIds.push(id);
							widgetFactories.delete(id);
						}
					},
					setStatus(key: string, value: string) {
						statusCalls.push({ key, value });
					},
				},
			},
		);
		assert.deepEqual(clearedWidgetIds.slice(0, 3), ["mastra-agents", "mastra-agents-list", "mastra-agents-region"]);
		assert.equal(widgetFactories.has("mastra-agents-list"), false);
		assert.equal(widgetFactories.has("mastra-agents-region"), false);
		assert.equal(widgetFactories.has("mastra-agents"), false, "single widget should stay unmounted until active work starts");

		const queryTool = registeredTools.find((tool) => tool.name === MASTRA_AGENT_QUERY_TOOL_NAME);
		assert.ok(queryTool, "agent_query tool should be registered by the extension");
		const queryPromise = queryTool.execute("call", { agentId: "validator-agent", message: "prompt", jobName: "extension job" });
		await waitFor(() => widgetFactories.has("mastra-agents"));
		let renderRequests = 0;
		const widget = widgetFactories.get("mastra-agents")!({ requestRender() { renderRequests += 1; }, terminal: { rows: 30 } }, stubTheme as any);
		assert.ok(widget.render(100).some((line: string) => line.includes("validator-agent")), "running job should mount the compact list surface");
		assert.equal(widget.render(100).some((line: string) => line.includes("Mastra: validator-agent")), false, "default list mode should not render a card");
		assert.equal(shortcuts.size, 0, "widget hotkeys should be session-scoped terminal listeners, not global extension shortcuts");
		assert.equal(terminalInputHandlers.length, 1, "session should install one terminal shortcut listener");
		assert.equal(terminalInputHandlers[0]?.("\x0b"), undefined, "detail scroll-up shortcut should not be consumed outside detail mode");
		assert.equal(renderRequests, 0);
		assert.equal(terminalInputHandlers[0]?.("\b"), undefined, "raw backspace should not be consumed as the view-mode shortcut");
		assert.equal(terminalInputHandlers[0]?.("\x1bh")?.consume, true, "alt+h view-mode shortcut should be consumed");
		assert.ok(renderRequests > 0, "view-mode shortcut should request a widget render");
		assert.ok(widget.render(100).some((line: string) => line.includes("Mastra: validator-agent")), "card mode should render running work in fixed region");
		await waitFor(() => widget.render(100).some((line: string) => line.includes("extension result 80")));
		const renderRequestsBeforeStreamOnly = renderRequests;
		assert.equal(terminalInputHandlers[0]?.("\x1bs")?.consume, true, "alt+s stream-only shortcut should be consumed");
		assert.ok(renderRequests > renderRequestsBeforeStreamOnly, "stream-only shortcut should request a widget render");
		assert.ok(widget.render(100).some((line: string) => line.includes("stream-only")), "stream-only shortcut should affect detail view state");
		const renderRequestsBeforeScrollUp = renderRequests;
		assert.equal(terminalInputHandlers[0]?.("\x1bk")?.consume, true, "alt+k scroll-up shortcut should be consumed in detail mode");
		assert.ok(renderRequests > renderRequestsBeforeScrollUp, "scroll-up shortcut should request a widget render");
		assert.ok(widget.render(100).some((line: string) => line.includes("scroll +")), "scroll-up shortcut should move away from live tail");
		const renderRequestsBeforeScrollDown = renderRequests;
		assert.equal(terminalInputHandlers[0]?.("\n"), undefined, "raw newline should not be consumed as the scroll-down shortcut");
		assert.equal(terminalInputHandlers[0]?.("\x1bj")?.consume, true, "alt+j scroll-down shortcut should be consumed in detail mode");
		assert.ok(renderRequests > renderRequestsBeforeScrollDown, "scroll-down shortcut should request a widget render");
		assert.equal(widget.render(100).some((line: string) => line.includes("scroll +")), false, "scroll-down shortcut should return toward live tail");

		await waitFor(() => typeof releaseAgentFinish === "function");
		releaseAgentFinish?.();
		await queryPromise;

		await waitFor(() => sentMessages.length === 1);
		const sent = sentMessages[0];
		assert.deepEqual(sent.options, { deliverAs: "steer", triggerTurn: true });
		assert.equal(sent.message.customType, MASTRA_AGENT_RESULT_MESSAGE_TYPE);
		assert.equal(sent.message.display, true);
		assert.match(sent.message.content, /^<system-reminder>\nAsynchronous Mastra agent task completed:/);
		assert.equal(sent.message.details.lifecycleStatus, "agent_response_queued");
		assert.equal(sent.message.details.status, "done");
		assert.equal(agentStreamCalls, 1);
		assert.equal(workflowStreamCalls, 0, "agent_query should use direct agent stream, not workflow stream");
		assert.ok(statusCalls.some((call) => call.key === MASTRA_STATUS_KEY && call.value === "mastra: 1 running"));
		await waitFor(() => !widgetFactories.has("mastra-agents"));
		const legacyMounts = widgetCalls.filter((call) => (call.id === "mastra-agents-list" || call.id === "mastra-agents-region") && call.hasFactory);
		const activeMounts = widgetCalls.filter((call) => call.id === "mastra-agents" && call.hasFactory);
		const activeMountIndex = widgetCalls.findIndex((call) => call.id === "mastra-agents" && call.hasFactory);
		const activeUnmountsAfterMount = widgetCalls.slice(activeMountIndex + 1).filter((call) => call.id === "mastra-agents" && !call.hasFactory);
		assert.deepEqual(legacyMounts, []);
		assert.equal(activeMounts.length, 1, "active updates should not repeatedly remount the same widget");
		assert.equal(activeMounts[0]?.placement, "aboveEditor");
		assert.equal(activeUnmountsAfterMount.length, 1, "completion should unmount the active widget once");
		assert.deepEqual(widget.render(100), [], "queued completion should no longer occupy widget rows");
		assert.equal(terminalInputHandlers[0]?.("\x0b"), undefined, "detail scroll-up shortcut should not be consumed after active work ends");

		const messageEnd = handlers.get("message_end");
		assert.equal(typeof messageEnd, "function");
		await messageEnd?.({
			message: {
				role: "custom",
				customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
				details: { jobId: "other-job" },
			},
		});
		assert.equal(widgetFactories.has("mastra-agents"), false, "unmatched message_end should not remount completed work");

		await messageEnd?.({
			message: {
				role: "custom",
				customType: MASTRA_AGENT_RESULT_MESSAGE_TYPE,
				details: { jobId: sent.message.details.jobId },
			},
		});

		assert.equal(statusCalls.at(-1)?.key, MASTRA_STATUS_KEY);
		assert.equal(statusCalls.at(-1)?.value, "mastra: 1 agents, 1 workflows");
		assert.deepEqual(widget.render(100), []);
		widget.dispose();
	} finally {
		globalThis.fetch = originalFetch;
		await rm(cwd, { recursive: true, force: true });
	}
});

function fakeSummary(overrides: Partial<MastraAgentAsyncJobSummary> = {}): MastraAgentAsyncJobSummary {
	return {
		jobId: "job",
		jobName: "job",
		agentId: "agent",
		threadId: "thread",
		resourceId: "resource",
		status: "done",
		lifecycleStatus: "agent_response_queued",
		textPreview: "",
		toolCalls: 0,
		toolResults: 0,
		rawChunkCount: 0,
		chunksTruncated: false,
		errors: [],
		...overrides,
	};
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for predicate");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
