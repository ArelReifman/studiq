import { z } from "zod";
import { callClaude } from "./claude.js";
import { buildDifficultyTaggingPrompt } from "./prompts.js";

const TagSchema = z.object({
  topic_tags: z.array(z.string()),
  confidence: z.number(),
});

export async function tagDifficulty(
  reportId: string,
  taskTitle: string,
  taskDescription: string
): Promise<string[]> {
  try {
    const prompt = buildDifficultyTaggingPrompt(taskTitle, taskDescription);
    const result = await callClaude(prompt, (text) => {
      const parsed = JSON.parse(text);
      return TagSchema.parse(parsed);
    });
    return result.topic_tags;
  } catch (err) {
    console.error(`Failed to tag difficulty ${reportId}:`, err);
    return []; // Non-critical — return empty tags on failure
  }
}
