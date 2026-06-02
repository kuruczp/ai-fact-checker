// Cloudflare Worker — AI Fact Checker Proxy
// The API key is stored as a Cloudflare secret (never in source code).
// Set it with: npx wrangler secret put ANTHROPIC_API_KEY

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Basic abuse guard: shared token embedded in the extension.
const EXTENSION_TOKEN = "fc-ext-v1-a9k2m7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Extension-Token",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const token = request.headers.get("X-Extension-Token");
    if (token !== EXTENSION_TOKEN) {
      return json({ error: "Unauthorized" }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (!body?.text || typeof body.text !== "string" || body.text.trim().length === 0) {
      return json({ error: "Missing or empty text field" }, 400);
    }

    const textToCheck = body.text.trim().slice(0, 3000);

    const anthropicResponse = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: buildPrompt(textToCheck) }],
      }),
    });

    if (!anthropicResponse.ok) {
      const err = await anthropicResponse.json().catch(() => ({}));
      return json({ error: err?.error?.message || `Upstream error ${anthropicResponse.status}` }, 502);
    }

    const data = await anthropicResponse.json();
    const result = data.content?.[0]?.text ?? "No response received.";

    return json({ result }, 200);
  },
};

function buildPrompt(text) {
  return `You are a knowledgeable AI assistant that can both answer questions and fact-check statements. The user has selected the following text:

SELECTED TEXT:
"${text}"

First, determine what type of content this is:

- TYPE A — QUESTION WITH ANSWER OPTIONS: The text contains a question followed by a list of possible answers (multiple choice, checkbox, true/false, quiz, exam, etc.). This includes questions in ANY language.
- TYPE B — FACTUAL CLAIM OR STATEMENT: The text is a statement, claim, or assertion that can be verified.

---

If TYPE A (question with options), respond in this exact format:

TYPE: QUESTION

CORRECT ANSWER(S):
[List each correct option exactly as written in the text. If multiple answers are correct, list each on its own line starting with "- ".]

CONFIDENCE: [HIGH / MEDIUM / LOW]

EXPLANATION:
[2–4 sentences explaining WHY these are the correct answers, with the key reasoning or facts behind each one. Respond in the same language as the question.]

---

If TYPE B (factual claim), respond in this exact format:

TYPE: FACT-CHECK

VERDICT: [TRUE / FALSE / MISLEADING / UNVERIFIABLE / PARTIALLY TRUE]

CONFIDENCE: [HIGH / MEDIUM / LOW]

SUMMARY:
[2–3 sentence plain-language explanation of your verdict]

KEY FACTS:
[Bullet-point list of the most important factual points, corrections, or context]

SOURCES TO CHECK:
[Suggest 2–3 types of authoritative sources the user could consult to verify this]

---

Be accurate, concise, and respond in the same language as the selected text.`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
