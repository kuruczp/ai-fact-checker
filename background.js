const PROXY_URL = "https://fact-checker-proxy.kuruczpeter.workers.dev";
const EXTENSION_TOKEN = "fc-ext-v1-a9k2m7";

const CONTEXT_MENU_ID = "fact-check-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Fact Check with AI",
    contexts: ["selection"],
  });
});

// ── Context menu: show panel ──────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  chrome.tabs.sendMessage(tab.id, { type: "FACT_CHECK_START", text: selectedText });
  callAI(selectedText).then(result => {
    chrome.tabs.sendMessage(tab.id, { type: "FACT_CHECK_RESULT", result });
  }).catch(err => {
    chrome.tabs.sendMessage(tab.id, { type: "FACT_CHECK_ERROR", error: err.message });
  });
});

// ── Keyboard shortcut: silent quiz autofill ───────────────────────────────────

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "quiz-autofill") return;

  // Get active tab if not passed (older Chrome versions)
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab?.id) return;

  // Grab the selected text from the page
  let selectedText = "";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString()?.trim() ?? "",
    });
    selectedText = result;
  } catch {
    return;
  }

  if (!selectedText) return;

  // Call AI silently
  try {
    const result = await callAI(selectedText);
    chrome.tabs.sendMessage(tab.id, { type: "QUIZ_AUTOFILL_RESULT", result });
  } catch {
    // Fail silently — no UI in autofill mode
  }
});

// ── Shared AI call ────────────────────────────────────────────────────────────

async function callAI(text) {
  const response = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Extension-Token": EXTENSION_TOKEN,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Server error ${response.status}`);
  }

  const data = await response.json();
  return data.result;
}
