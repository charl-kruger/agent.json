import { generateObject } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

const AI_MODEL = "@cf/meta/llama-3.1-70b-instruct";

const classificationSchema = z.object({
  intent: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string()
});

export type ClassificationResult = {
  intent: string;
  confidence: number;
  reasoning: string;
};

export async function classifyIntent(
  ai: Ai,
  subject: string,
  body: string,
  availableIntents: Array<{ intent: string; description: string }>
): Promise<ClassificationResult> {
  const workersAI = createWorkersAI({ binding: ai });

  const intentList = availableIntents
    .map((i) => `- "${i.intent}": ${i.description}`)
    .join("\n");

  const { object } = await generateObject({
    model: workersAI(AI_MODEL),
    schema: classificationSchema,
    prompt: `You are a message classification system. Classify the following message into one of the available intents.

Available intents:
${intentList}
- "general": Any message that doesn't clearly fit the above categories

Message subject: ${subject}
Message body: ${body}

Classify this message. Pick the single best matching intent. If confidence is below 0.4, use "general".`
  });

  if (object.confidence < 0.4) {
    return {
      intent: "general",
      confidence: object.confidence,
      reasoning: object.reasoning
    };
  }

  return object;
}
