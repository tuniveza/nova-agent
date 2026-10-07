// A thin wrapper around the Anthropic API.
//
// The agent mostly needs one thing from the AI: a JSON answer that matches a
// schema we define. The SDK checks the reply against that schema for us, so we
// never have to pick JSON out of free text. askWithResearch lets the answer
// look things up on the web first (mission plans do).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "./config";
import { trace } from "./trace";
import { sourcesIn, webTools, type Source } from "./web";

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_CONTINUATIONS = 5;

// Created on first use, so the rest of the program still runs (e.g. the
// login check) even before an API key has been added to .env.
let client: Anthropic | undefined;

export function getClient(): Anthropic {
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
  // Big answers (a whole mission plan): streamed, with room for the model to
  // think and write at length, at the effort given
  long?: { effort: "low" | "medium" | "high" | "xhigh" | "max" };
}): Promise<z.infer<Schema>> {
  const model = config.novaModel || DEFAULT_MODEL;
  if (options.long) return askForLongJson(model, options, options.long.effort);

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

// The streamed version: the reply is checked against the schema here, once it's complete
async function askForLongJson<Schema extends z.ZodType>(
  model: string,
  options: { system: string; prompt: string; schema: Schema; purpose: string },
  effort: "low" | "medium" | "high" | "xhigh" | "max",
): Promise<z.infer<Schema>> {
  return (await askWithResearch({ ...options, long: { effort }, web: { search: 0, fetch: 0 } }, model)).answer;
}

// A big JSON answer that may look things up on the web first (web search and
// web fetch, up to the number of uses given). Also says which pages it found or
// read, so what it cites can be checked against what it really saw.
export async function askWithResearch<Schema extends z.ZodType>(
  options: { system: string; prompt: string; schema: Schema; purpose: string; long: { effort: "low" | "medium" | "high" | "xhigh" | "max" }; web: { search: number; fetch: number } },
  model = config.novaModel || DEFAULT_MODEL,
): Promise<{ answer: z.infer<Schema>; sources: Source[] }> {
  const { purpose } = options;
  const researching = options.web.search > 0 || options.web.fetch > 0;
  trace("llm", "start", `Asking ${model}: ${purpose}${researching ? " (with web research)" : ""}`, { system: options.system, prompt: options.prompt });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: options.prompt }];
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  let response: Anthropic.Beta.BetaMessage | undefined;
  // Long research can pause part-way (the server's own step limit): carry on where it stopped
  for (let turn = 0; turn < MAX_CONTINUATIONS; turn++) {
    response = await getClient()
      .beta.messages.stream({
        model,
        max_tokens: 64000,
        system: options.system,
        messages,
        ...(researching ? { tools: webTools(options.web) } : {}),
        output_config: { format: betaZodOutputFormat(options.schema), effort: options.long.effort },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      })
      .finalMessage();
    content.push(...response.content);
    if (response.stop_reason !== "pause_turn") break;
    trace("llm", "info", `Still researching: ${purpose}`);
    messages.push({ role: "assistant", content: response.content });
  }
  if (!response) throw new Error(`No answer from the AI (${purpose}).`);
  if (response.stop_reason === "refusal") throw new Error(`The AI declined to answer (${purpose}).`);
  if (response.stop_reason === "max_tokens") throw new Error(`The AI's answer was too long to finish (${purpose}).`);
  if (response.stop_reason === "pause_turn") throw new Error(`The research took too many steps to finish (${purpose}).`);
  // The answer is the text after the last search or fetch
  let lastTool = response.content.length - 1;
  while (lastTool >= 0 && response.content[lastTool].type === "text") lastTool--;
  const text = response.content
    .slice(lastTool + 1)
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let answer: z.infer<Schema>;
  try {
    answer = options.schema.parse(JSON.parse(text));
  } catch {
    throw new Error(`The AI's reply didn't match the expected format (${purpose}).`);
  }
  const sources = sourcesIn(content);
  trace("llm", "ok", `AI answered: ${purpose}`, { answer, sources: sources.length, tokens: { input: response.usage.input_tokens, output: response.usage.output_tokens } });
  return { answer, sources };
}
