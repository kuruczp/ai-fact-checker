// UPDATE THIS after deploying your Cloudflare Worker:
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  chrome.tabs.sendMessage(tab.id, { type: "FACT_CHECK_START", text: selectedText });
  runFactCheck(selectedText, tab.id);
});

async function runFactCheck(text, tabId) {
  try {
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
    chrome.tabs.sendMessage(tabId, { type: "FACT_CHECK_RESULT", result: data.result });
  } catch (err) {
    chrome.tabs.sendMessage(tabId, {
      type: "FACT_CHECK_ERROR",
      error: err.message || "Could not reach the fact-checker server.",
    });
  }
}
