let panel = null;

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "FACT_CHECK_START":
      showPanel("loading", msg.text);
      break;
    case "FACT_CHECK_RESULT":
      updatePanel("result", msg.result);
      break;
    case "FACT_CHECK_ERROR":
      updatePanel("error", msg.error);
      break;
  }
});

function showPanel(state, text) {
  removePanel();

  panel = document.createElement("div");
  panel.id = "ai-fact-checker-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "AI Fact Checker");

  panel.innerHTML = `
    <div class="afc-header">
      <span class="afc-logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="afc-title">AI Fact Checker</span>
      <button class="afc-close" aria-label="Close" title="Close">×</button>
    </div>
    <div class="afc-claim">
      <span class="afc-claim-label">Checking:</span>
      <span class="afc-claim-text">${escapeHtml(truncate(text, 120))}</span>
    </div>
    <div class="afc-body">
      <div class="afc-loading">
        <div class="afc-spinner"></div>
        <span>Analyzing with Claude AI…</span>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  panel.querySelector(".afc-close").addEventListener("click", removePanel);

  requestAnimationFrame(() => panel.classList.add("afc-visible"));
}

function updatePanel(state, content) {
  if (!panel) return;
  const body = panel.querySelector(".afc-body");

  if (state === "error") {
    body.innerHTML = `
      <div class="afc-error">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>${escapeHtml(content)}</span>
      </div>
    `;
    return;
  }

  body.innerHTML = `<div class="afc-result">${renderResult(content)}</div>`;
}

function renderResult(text) {
  const lines = text.split("\n");
  let html = "";
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("VERDICT:")) {
      if (inList) { html += "</ul>"; inList = false; }
      const value = line.replace("VERDICT:", "").trim();
      const cls = verdictClass(value);
      html += `<div class="afc-verdict ${cls}"><span class="afc-verdict-badge">${escapeHtml(value)}</span></div>`;
      continue;
    }

    if (line.startsWith("CONFIDENCE:")) {
      if (inList) { html += "</ul>"; inList = false; }
      const value = line.replace("CONFIDENCE:", "").trim();
      html += `<div class="afc-confidence"><strong>Confidence:</strong> <span class="afc-conf-${value.toLowerCase()}">${escapeHtml(value)}</span></div>`;
      continue;
    }

    const sectionMatch = line.match(/^(SUMMARY|KEY FACTS|SOURCES TO CHECK):?$/);
    if (sectionMatch) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<div class="afc-section-title">${escapeHtml(sectionMatch[1])}</div>`;
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("• ")) {
      if (!inList) { html += "<ul class='afc-list'>"; inList = true; }
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
      continue;
    }

    if (inList) { html += "</ul>"; inList = false; }
    if (line.trim()) {
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }

  if (inList) html += "</ul>";
  return html;
}

function verdictClass(verdict) {
  const v = verdict.toUpperCase();
  if (v === "TRUE") return "afc-verdict-true";
  if (v === "FALSE") return "afc-verdict-false";
  if (v === "MISLEADING") return "afc-verdict-misleading";
  if (v === "PARTIALLY TRUE") return "afc-verdict-partial";
  return "afc-verdict-unknown";
}

function removePanel() {
  if (!panel) return;
  panel.classList.remove("afc-visible");
  panel.addEventListener("transitionend", () => panel?.remove(), { once: true });
  panel = null;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}
