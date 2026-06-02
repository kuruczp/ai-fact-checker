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
  return `You are a precise and impartial fact-checker. Analyze the following claim or statement and return a structured fact-check report.

TEXT TO FACT-CHECK:
"${text}"

Respond in this exact format:

VERDICT: [TRUE / FALSE / MISLEADING / UNVERIFIABLE / PARTIALLY TRUE]

CONFIDENCE: [HIGH / MEDIUM / LOW]

SUMMARY:
[2–3 sentence plain-language explanation of your verdict]

KEY FACTS:
[Bullet-point list of the most important factual points, corrections, or context]

SOURCES TO CHECK:
[Suggest 2–3 types of authoritative sources the user could consult to verify this]

Keep your response factual, concise, and neutral. Do not editorialize.`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
