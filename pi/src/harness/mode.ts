export type HarnessMode = "quick" | "balanced" | "precision" | "auto";

export interface HarnessModeDefinition {
	id: HarnessMode;
	label: string;
	highlightColor: string;
	prompt: string;
}

export const DEFAULT_HARNESS_MODE: HarnessMode = "balanced";
export const PI_HARNESS_MODE_MESSAGE_TYPE = "pi-harness-mode";

const HARNESS_MODE_ORDER: readonly HarnessMode[] = ["quick", "balanced", "precision", "auto"];

const HARNESS_MODE_DEFINITIONS: Record<HarnessMode, HarnessModeDefinition> = {
	quick: {
		id: "quick",
		label: "Quick",
		highlightColor: "cyan",
		prompt: `[HARNESS MODE: QUICK]

Prioritize fast turnaround, short feedback loops, concise progress, and direct answers. Avoid deep planning, broad exploration, or audit loops unless the task clearly requires them.`,
	},
	balanced: {
		id: "balanced",
		label: "Balanced",
		highlightColor: "blue",
		prompt: `[HARNESS MODE: BALANCED]

Balance speed and correctness. Inspect enough context to avoid obvious mistakes, but do not over-plan. Use concise progress updates and escalate only when scope or evidence is genuinely ambiguous.`,
	},
	precision: {
		id: "precision",
		label: "Precision",
		highlightColor: "yellow",
		prompt: `[HARNESS MODE: PRECISION]

Move deliberately. Clarify ambiguous scope, preserve the agreed boundary, and audit work against the plan. Prefer correctness, evidence, and validation over speed.`,
	},
	auto: {
		id: "auto",
		label: "Auto",
		highlightColor: "magenta",
		prompt: `[HARNESS MODE: AUTO]

Continue toward the user's goal while there is a known next step. Avoid unnecessary user interruption. Ask only when genuinely blocked or when a decision is required.`,
	},
};

export function createHarnessModeState(initialMode: HarnessMode = DEFAULT_HARNESS_MODE): {
	get(): HarnessMode;
	set(mode: HarnessMode): HarnessMode;
	cycle(): HarnessMode;
} {
	let mode = assertHarnessMode(initialMode);
	return {
		get() {
			return mode;
		},
		set(nextMode) {
			mode = assertHarnessMode(nextMode);
			return mode;
		},
		cycle() {
			const index = HARNESS_MODE_ORDER.indexOf(mode);
			mode = HARNESS_MODE_ORDER[(index + 1) % HARNESS_MODE_ORDER.length] ?? DEFAULT_HARNESS_MODE;
			return mode;
		},
	};
}

export function getHarnessModeDefinition(mode: HarnessMode): HarnessModeDefinition {
	return HARNESS_MODE_DEFINITIONS[assertHarnessMode(mode)];
}

export function isHarnessMode(mode: unknown): mode is HarnessMode {
	return typeof mode === "string" && (HARNESS_MODE_ORDER as readonly string[]).includes(mode);
}

export function createHarnessModeMessage(mode: HarnessMode): {
	customType: typeof PI_HARNESS_MODE_MESSAGE_TYPE;
	content: string;
	display: false;
} {
	return {
		customType: PI_HARNESS_MODE_MESSAGE_TYPE,
		content: getHarnessModeDefinition(mode).prompt,
		display: false,
	};
}

export function formatHarnessModeStatus(mode: HarnessMode): string {
	return `Mode: ${getHarnessModeDefinition(mode).id}`;
}

function assertHarnessMode(mode: HarnessMode): HarnessMode {
	if (isHarnessMode(mode)) return mode;
	throw new Error(`Invalid harness mode: ${String(mode)}`);
}
