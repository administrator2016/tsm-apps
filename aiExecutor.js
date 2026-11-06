
const { externalLlmFetch } = require('./server/external-llm-policy');
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../");

export async function runAI({ agent, input }) {
  const promptPath = path.join(root, "ai/prompts", `${agent}.md`);
  const workflowPath = path.join(root, "ai/workflows", `${agent}.json`);

  if (!fs.existsSync(promptPath)) throw new Error(`Prompt not found: ${agent}.md`);
  if (!fs.existsSync(workflowPath)) throw new Error(`Workflow not found: ${agent}.json`);

  const prompt = fs.readFileSync(promptPath, "utf8");
  const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));

  const body = {
    model: workflow.model || "openai/gpt-oss-120b",
    max_tokens: workflow.max_tokens || 1000,
    temperature: workflow.temperature ?? 0.1,
    messages: [
      {
        role: "user",
        content: `${prompt}\n\n## Input Data\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
      }
    ]
  };

  const response = await externalLlmFetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";

  // Strip markdown fences if model added them
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Return raw string if not valid JSON
    return { raw, parse_error: true };
  }
}