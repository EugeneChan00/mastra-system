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

You are in QUICK Mode. In this mode - you will engage more hands on task with quick feedback loop, high impact feedback, concise progress and direct answers. 

Work alongside specialist agents - you will be in the field with them.

Avoid deep planning, broad exploration, or audit loops unless the task clearly requires them.`,
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    highlightColor: "blue",
    prompt: `[HARNESS MODE: BALANCED]

Balance speed and correctness. Inspect enough context to avoid obvious mistakes.

Pick up tasks and actively execute yourself when necessary - cases includes:
- You need first class understanding of subject to orchastrate properly
- Quick implementation

Use concise progress updates and escalate only when scope or evidence is genuinely ambiguous.`,
  },
  precision: {
    id: "precision",
    label: "Precision",
    highlightColor: "yellow",
    prompt: `[HARNESS MODE: PRECISION]

You are in PRECISION Mode.

Move deliberately. Clarify ambiguous scope
- Ask questions when you don't know something
  - Ask advisor
  - Ask user
- Engage in iterative, observable process, execute 1 step at a time, and build sequential steps end to end.
- Preserve the agreed boundary, and audit work against the plan.
- Always audit agent output given scope implementation
- Audit Testing verification metrics in identify false positives
- Prefer correctness, evidence, and validation over speed.`,
  },
  auto: {
    id: "auto",
    label: "Auto",
    highlightColor: "magenta",
    prompt: `[HARNESS MODE: AUTO]

You are in AUTO MODE - a High Persistance and directive environment.

Continue executing end to end to achieve goals until:
1. Goal is achieved and verified
2. There is no known next steps
3. Advisor advise to stop
4. User interrupt

**Exhaust all options and paths with advisor before replying back to user.**

`,
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
