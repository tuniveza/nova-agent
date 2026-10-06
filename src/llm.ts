// A thin wrapper around the Anthropic API.
//
// The agent only ever needs one thing from the AI: a small JSON answer that
// matches a schema we define. The SDK checks the reply against that schema
// for us, so we never have to pick JSON out of free text.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "./config";
import { trace } from "./trace";

const DEFAULT_MODEL = "claude-opus-5-5";

// Created on first use, so the rest of the program still runs (e.g. the
// login check) even before an API key has been added to .env.
let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    // With no key in .env the SDK falls back to ANTHROPIC_API_KEY in the
    // environment or an `ant auth login` profile.
    client = new Anthropic(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {});
  }
  return client;
}

export async function askForJson<Schema extends z.ZodType>(options: {
  system: string;
  prompt: string;
  schema: Schema;
  purpose: string; // short label shown in the visualizer, e.g. "find login.email_field"
}): Promise<z.infer<Schema>> {
  const model = config.novaModel || DEFAULT_MODEL;

  trace("llm", "start", `Asking ${model}: ${options.purpose}`, {
    system: options.system,
    prompt: options.prompt,
  });

  const response = await getClient().beta.messages.parse({
    model,
    max_tokens: 16000,
    system: options.system,
    messages: [{ role: "user", content: options.prompt }],
    output_config: { format: betaZodOutputFormat(options.schema) },
    // If this model declines a request, the API retries it on a suitable
    // fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`The AI declined to answer (${options.purpose}).`);
  }
  if (!response.parsed_output) {
    throw new Error(`The AI's reply didn't match the expected format (${options.purpose}).`);
  }

  trace("llm", "ok", `AI answered: ${options.purpose}`, {
    answer: response.parsed_output,
    tokens: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  });
  return response.parsed_output;
}
