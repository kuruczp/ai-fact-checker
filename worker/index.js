// Cloudflare Worker — AI Fact Checker Proxy
// Set your API key as a secret: npx wrangler secret put AI_API_KEY
//
// Supported key formats (auto-detected):
//   sk-ant-...   → Anthropic Claude (claude-sonnet-4-6)
//   sk-or-...    → OpenRouter       (free models available)
//   sk-...       → OpenAI           (gpt-4o-mini)

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

    const apiKey = env.AI_API_KEY;
    if (!apiKey) {
      return json({ error: "No API key configured on the server." }, 500);
    }

    const provider = detectProvider(apiKey);
    if (!provider) {
      return json({ error: "Unrecognised API key format." }, 500);
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

    const text = body.text.trim().slice(0, 3000);
    const prompt = buildPrompt(text);

    try {
      const result = await callProvider(provider, apiKey, prompt);
      return json({ result, provider });
    } catch (err) {
      return json({ error: err.message || "Upstream error" }, 502);
    }
  },
};

// ── Provider detection ────────────────────────────────────────────────────────

function detectProvider(key) {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-or-"))  return "openrouter";
  if (key.startsWith("sk-"))     return "openai";
  return null;
}

// ── Provider calls ────────────────────────────────────────────────────────────

async function callProvider(provider, apiKey, prompt) {
  switch (provider) {
    case "anthropic":  return callAnthropic(apiKey, prompt);
    case "openrouter": return callOpenAICompat("https://openrouter.ai/api/v1/chat/completions", apiKey, prompt, "openrouter/free");
    case "openai":     return callOpenAICompat("https://api.openai.com/v1/chat/completions",    apiKey, prompt, "gpt-4o-mini");
  }
}

async function callAnthropic(apiKey, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Anthropic error ${res.status}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? "No response received.";
}

async function callOpenAICompat(endpoint, apiKey, prompt, model) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  // Some reasoning models return null content with text in the reasoning field
  return msg?.content || msg?.reasoning || "No response received.";
}

// ── Prompt ────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
