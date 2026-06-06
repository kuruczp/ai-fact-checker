const PROXY_URL = 'https://fact-checker-proxy.kuruczpeter.workers.dev';
const EXTENSION_TOKEN = 'fc-ext-v1-a9k2m7';
const CONTEXT_MENU_ID = 'fact-check-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Fact Check with AI',
    contexts: ['selection'],
  });
});

// ── Context menu ──────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const text = info.selectionText?.trim();
  if (!text) return;
  chrome.tabs.sendMessage(tab.id, { type: 'FACT_CHECK_START', text });
  callAI(text, tab.id, 'factcheck');
});

// ── Keyboard shortcut: silent autofill ───────────────────────────────────────

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'quiz-autofill') return;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const [{ result: text }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.getSelection()?.toString()?.trim() ?? '',
  }).catch(() => [{ result: '' }]);

  if (!text) return;

  callAI(text, tab.id, 'autofill');
});

// ── Shared AI caller ──────────────────────────────────────────────────────────

async function callAI(text, tabId, mode) {
  const { sessionToken } = await chrome.storage.local.get('sessionToken');

  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-Extension-Token': EXTENSION_TOKEN,
    };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, source: 'extension' }),
    });

    if (response.status === 401) {
      const err = await response.json().catch(() => ({}));
      chrome.tabs.sendMessage(tabId, {
        type: 'FACT_CHECK_ERROR',
        error: err.error || 'Please log in via the extension icon.',
      });
      return;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error || `Server error ${response.status}`);
    }

    const data = await response.json();

    if (mode === 'autofill') {
      chrome.tabs.sendMessage(tabId, { type: 'QUIZ_AUTOFILL_RESULT', result: data.result });
    } else {
      chrome.tabs.sendMessage(tabId, { type: 'FACT_CHECK_RESULT', result: data.result });
    }
  } catch (err) {
    chrome.tabs.sendMessage(tabId, {
      type: 'FACT_CHECK_ERROR',
      error: err.message || 'Could not reach the fact-checker server.',
    });
  }
}
