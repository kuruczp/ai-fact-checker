// ==UserScript==
// @name         AI Fact Checker
// @namespace    https://kuruczp.github.io/ai-fact-checker/
// @version      1.0.0
// @description  Fact-check any selected text or auto-fill quiz answers with Alt+Shift+F
// @author       kuruczp
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      fact-checker-proxy.kuruczpeter.workers.dev
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  var PROXY = 'https://fact-checker-proxy.kuruczpeter.workers.dev';
  var TOKEN = 'fc-ext-v1-a9k2m7';

  // ── Styles ──────────────────────────────────────────────────────────────────

  GM_addStyle([
    '#afc-panel{position:fixed;bottom:24px;right:24px;width:380px;max-width:calc(100vw - 48px);max-height:70vh;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;color:#1a1a2e;z-index:2147483647;display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(16px) scale(.97);transition:opacity .22s,transform .22s}',
    '#afc-panel.afc-on{opacity:1;transform:none}',
    '.afc-hdr{display:flex;align-items:center;gap:8px;padding:12px 14px 10px;background:#f8f9ff;border-bottom:1px solid #f0f0f0;flex-shrink:0}',
    '.afc-ttl{font-weight:600;font-size:14px;color:#2d3561;flex:1}',
    '.afc-x{background:none;border:none;cursor:pointer;font-size:20px;line-height:1;color:#888;padding:0 2px;border-radius:4px}',
    '.afc-x:hover{color:#333;background:#e8e8f0}',
    '.afc-claim{padding:8px 14px;background:#f4f5fb;border-bottom:1px solid #e8e8f0;font-size:12px;color:#555;font-style:italic;flex-shrink:0}',
    '.afc-claim b{font-style:normal;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-right:4px}',
    '.afc-body{padding:14px;overflow-y:auto;flex:1}',
    '.afc-load{display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 0;color:#666;font-size:13px}',
    '.afc-spin{width:28px;height:28px;border:3px solid #e0e4f8;border-top-color:#5c6bc0;border-radius:50%;animation:afc-spin .8s linear infinite}',
    '@keyframes afc-spin{to{transform:rotate(360deg)}}',
    '.afc-err{display:flex;align-items:flex-start;gap:10px;color:#c62828;background:#fff5f5;border:1px solid #ffcdd2;border-radius:8px;padding:12px;font-size:13px}',
    '.afc-verdict{margin-bottom:10px}',
    '.afc-vbadge{display:inline-block;padding:4px 14px;border-radius:20px;font-weight:700;font-size:13px;letter-spacing:.05em;text-transform:uppercase}',
    '.afc-true .afc-vbadge{background:#e8f5e9;color:#2e7d32;border:1.5px solid #a5d6a7}',
    '.afc-false .afc-vbadge{background:#ffebee;color:#c62828;border:1.5px solid #ef9a9a}',
    '.afc-misleading .afc-vbadge{background:#fff3e0;color:#e65100;border:1.5px solid #ffcc80}',
    '.afc-partial .afc-vbadge{background:#fff8e1;color:#f57f17;border:1.5px solid #ffe082}',
    '.afc-unknown .afc-vbadge{background:#f3f4f6;color:#555;border:1.5px solid #d1d5db}',
    '.afc-conf{font-size:13px;color:#555;margin-bottom:10px}',
    '.afc-ch{color:#2e7d32;font-weight:600} .afc-cm{color:#e65100;font-weight:600} .afc-cl{color:#c62828;font-weight:600}',
    '.afc-sec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5c6bc0;margin:12px 0 6px;padding-bottom:4px;border-bottom:1px solid #e8e8f8}',
    '.afc-sec.g{color:#2e7d32;border-color:#a5d6a7}',
    '.afc-body p{margin:0 0 8px;font-size:13px;color:#444}',
    '.afc-list{margin:0 0 8px;padding-left:18px;font-size:13px;color:#444}',
    '.afc-list li{margin-bottom:4px}',
    '.afc-alist{list-style:none;padding:0;margin:0 0 8px}',
    '.afc-alist li{background:#e8f5e9;border:1.5px solid #a5d6a7;border-radius:6px;padding:6px 10px;margin-bottom:5px;color:#1b5e20;font-size:13px;font-weight:500}',
    '.afc-body::-webkit-scrollbar{width:4px}',
    '.afc-body::-webkit-scrollbar-thumb{background:#d0d0e0;border-radius:4px}'
  ].join(''));

  // ── Panel ────────────────────────────────────────────────────────────────────

  var panel = null;

  function showPanel(text) {
    removePanel();
    panel = document.createElement('div');
    panel.id = 'afc-panel';
    panel.innerHTML =
      '<div class="afc-hdr">' +
      '<span class="afc-ttl">AI Fact Checker</span>' +
      '<button class="afc-x" title="Close">×</button>' +
      '</div>' +
      '<div class="afc-claim"><b>Checking:</b>' + esc(trunc(text, 120)) + '</div>' +
      '<div class="afc-body"><div class="afc-load"><div class="afc-spin"></div><span>Analyzing…</span></div></div>';
    document.body.appendChild(panel);
    panel.querySelector('.afc-x').addEventListener('click', removePanel);
    requestAnimationFrame(function () { panel.classList.add('afc-on'); });
  }

  function updatePanel(html) {
    if (!panel) return;
    panel.querySelector('.afc-body').innerHTML = html;
  }

  function removePanel() {
    if (!panel) return;
    panel.classList.remove('afc-on');
    panel.addEventListener('transitionend', function () { if (panel) { panel.remove(); panel = null; } }, { once: true });
  }

  // ── AI call ──────────────────────────────────────────────────────────────────

  function callAI(text, onResult, onError) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: PROXY,
      headers: { 'Content-Type': 'application/json', 'X-Extension-Token': TOKEN },
      data: JSON.stringify({ text: text }),
      onload: function (r) {
        try {
          var d = JSON.parse(r.responseText);
          if (d.error) { onError(d.error); } else { onResult(d.result || ''); }
        } catch (e) { onError('Invalid response'); }
      },
      onerror: function () { onError('Could not reach server'); }
    });
  }

  // ── Fact-check via menu ───────────────────────────────────────────────────────

  GM_registerMenuCommand('Fact Check selected text', function () {
    var text = (window.getSelection() || {}).toString().trim();
    if (!text) { alert('Please select some text first.'); return; }
    showPanel(text);
    callAI(text,
      function (result) { updatePanel('<div class="afc-result">' + render(result) + '</div>'); },
      function (msg)    { updatePanel('<div class="afc-err">⚠ ' + esc(msg) + '</div>'); }
    );
  });

  // ── Auto-fill via Alt+Shift+F ────────────────────────────────────────────────

  var lastRoot = null;
  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection();
    if (!sel || !sel.toString().trim() || !sel.rangeCount) return;
    var el = sel.getRangeAt(0).commonAncestorContainer;
    lastRoot = el.nodeType === Node.TEXT_NODE ? el.parentElement : el;
  });

  document.addEventListener('keydown', function (e) {
    if (e.altKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      var text = (window.getSelection() || {}).toString().trim();
      if (!text) return;
      callAI(text, function (result) { autofill(result); }, function () {});
    }
  });

  function autofill(resultText) {
    var answers = parseAnswers(resultText);
    if (!answers.length) return;
    var root = findRoot();
    var inputs = root.querySelectorAll('input[type="checkbox"],input[type="radio"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var label = getLabel(input);
      if (label && answers.some(function (a) { return match(a, label); })) {
        if (!input.checked) {
          input.click();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  }

  function parseAnswers(text) {
    var answers = [], inA = false;
    text.split('\n').forEach(function (raw) {
      var line = raw.trim();
      if (/^CORRECT ANSWER/i.test(line)) { inA = true; return; }
      if (inA) {
        if (/^(CONFIDENCE|EXPLANATION|TYPE|VERDICT|SUMMARY):/i.test(line)) { inA = false; return; }
        var m = line.match(/^[-•]\s*(.+)/);
        if (m) answers.push(m[1].trim());
        else if (line) answers.push(line);
      }
    });
    return answers.filter(Boolean);
  }

  function findRoot() {
    if (!lastRoot) return document.body;
    var el = lastRoot;
    for (var i = 0; i < 10; i++) {
      if (el.querySelectorAll('input[type="checkbox"],input[type="radio"]').length > 0) return el;
      if (!el.parentElement || el === document.body) break;
      el = el.parentElement;
    }
    return document.body;
  }

  function getLabel(input) {
    if (input.id) {
      try {
        var l = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
        if (l) return l.textContent.trim();
      } catch (e) {}
    }
    var w = input.closest('label');
    if (w) return w.textContent.trim();
    if (input.getAttribute('aria-label')) return input.getAttribute('aria-label').trim();
    var lb = input.getAttribute('aria-labelledby');
    if (lb) { var e2 = document.getElementById(lb); if (e2) return e2.textContent.trim(); }
    var s = input.nextSibling;
    while (s) { var t = s.textContent && s.textContent.trim(); if (t) return t; s = s.nextSibling; }
    return null;
  }

  function match(a, b) {
    var na = norm(a), nb = norm(b);
    return na === nb || nb.includes(na) || na.includes(nb);
  }

  function norm(s) { return s.toLowerCase().replace(/\s+/g, ' ').trim(); }

  // ── Renderer ─────────────────────────────────────────────────────────────────

  function render(text) {
    var lines = text.split('\n'), html = '', inList = false;
    var isQ = lines.some(function (l) { return l.indexOf('TYPE: QUESTION') >= 0; });

    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (/^TYPE:/.test(line)) return;

      if (isQ) {
        if (/^CORRECT ANSWER/i.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += '<div class="afc-sec g">✓ Correct Answer(s)</div>'; return; }
        if (/^CONFIDENCE:/i.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += confHtml(line.replace(/^CONFIDENCE:/i, '').trim()); return; }
        if (/^EXPLANATION:/i.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += '<div class="afc-sec">Explanation</div>'; return; }
        if (/^[-•] /.test(line)) { if (!inList) { html += '<ul class="afc-alist">'; inList = true; } html += '<li>' + esc(line.slice(2)) + '</li>'; return; }
      } else {
        if (/^VERDICT:/.test(line)) {
          if (inList) { html += '</ul>'; inList = false; }
          var val = line.replace(/^VERDICT:/, '').trim();
          var cls = { TRUE: 'afc-true', FALSE: 'afc-false', MISLEADING: 'afc-misleading', 'PARTIALLY TRUE': 'afc-partial' }[val] || 'afc-unknown';
          html += '<div class="afc-verdict ' + cls + '"><span class="afc-vbadge">' + esc(val) + '</span></div>';
          return;
        }
        if (/^CONFIDENCE:/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += confHtml(line.replace(/^CONFIDENCE:/, '').trim()); return; }
        var sm = line.match(/^(SUMMARY|KEY FACTS|SOURCES TO CHECK):?$/);
        if (sm) { if (inList) { html += '</ul>'; inList = false; } html += '<div class="afc-sec">' + esc(sm[1]) + '</div>'; return; }
        if (/^[-•] /.test(line)) { if (!inList) { html += '<ul class="afc-list">'; inList = true; } html += '<li>' + esc(line.slice(2)) + '</li>'; return; }
      }

      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += '<p>' + esc(line) + '</p>';
    });

    if (inList) html += '</ul>';
    return html;
  }

  function confHtml(c) {
    var cls = c === 'HIGH' ? 'afc-ch' : c === 'MEDIUM' ? 'afc-cm' : 'afc-cl';
    return '<div class="afc-conf"><strong>Confidence:</strong> <span class="' + cls + '">' + esc(c) + '</span></div>';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trunc(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

})();
