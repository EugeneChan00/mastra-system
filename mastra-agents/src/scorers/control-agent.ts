import {
  createAnswerRelevancyScorer,
  createPromptAlignmentScorerLLM,
  createToxicityScorer,
} from "@mastra/evals/scorers/prebuilt";

const evalModel = process.env.MASTRA_EVAL_MODEL ?? process.env.MASTRA_MODEL ?? "openai/gpt-5-mini";

function getSamplingRate() {
  const configuredRate = Number(process.env.MASTRA_SCORER_SAMPLING_RATE ?? "1");

  if (!Number.isFinite(configuredRate)) {
    return 1;
  }

  return Math.min(1, Math.max(0, configuredRate));
}

export const controlAgentScorers = {
  promptAlignment: createPromptAlignmentScorerLLM({
    model: evalModel,
    options: {
      evaluationMode: "both",
    },
  }),
  answerRelevancy: createAnswerRelevancyScorer({
    model: evalModel,
  }),
  toxicity: createToxicityScorer({
    model: evalModel,
  }),
};

export const controlAgentScorerConfig = {
  promptAlignment: {
    scorer: controlAgentScorers.promptAlignment,
    sampling: { type: "ratio" as const, rate: getSamplingRate() },
  },
  answerRelevancy: {
    scorer: controlAgentScorers.answerRelevancy,
    sampling: { type: "ratio" as const, rate: getSamplingRate() },
  },
  toxicity: {
    scorer: controlAgentScorers.toxicity,
    sampling: { type: "ratio" as const, rate: getSamplingRate() },
  },
};
