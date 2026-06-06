(function () {
  var PROXY = 'https://fact-checker-proxy.kuruczpeter.workers.dev';
  var TOKEN = 'fc-ext-v1-a9k2m7';
  var ID = '_afc_panel';

  var text = (window.getSelection() || {}).toString().trim();
  if (!text) { alert('AI Fact Checker: please select some text first.'); return; }

  var old = document.getElementById(ID);
  if (old) old.remove();

  if (!document.getElementById('_afc_style')) {
    var st = document.createElement('style');
    st.id = '_afc_style';
    st.textContent = '@keyframes _afc_spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }

  var p = document.createElement('div');
  p.id = ID;
  p.style.cssText = 'all:initial;position:fixed;bottom:24px;right:24px;width:380px;max-width:calc(100vw - 48px);max-height:70vh;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;color:#1a1a2e;z-index:2147483647;display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(12px);transition:opacity .2s,transform .2s';

  p.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;padding:12px 14px 10px;background:#f8f9ff;border-bottom:1px solid #f0f0f0;flex-shrink:0">' +
    '<span style="font-weight:600;font-size:14px;color:#2d3561;flex:1">AI Fact Checker</span>' +
    '<button id="_afc_close" style="background:none;border:none;cursor:pointer;font-size:20px;line-height:1;color:#888;padding:0 2px">×</button>' +
    '</div>' +
    '<div style="padding:8px 14px;background:#f4f5fb;border-bottom:1px solid #e8e8f0;font-size:12px;color:#555;font-style:italic;flex-shrink:0">' +
    '"' + esc(text.slice(0, 100)) + (text.length > 100 ? '…' : '') + '"' +
    '</div>' +
    '<div id="_afc_body" style="padding:14px;overflow-y:auto;flex:1">' +
    '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 0;color:#666;font-size:13px">' +
    '<div style="width:28px;height:28px;border:3px solid #e0e4f8;border-top-color:#5c6bc0;border-radius:50%;animation:_afc_spin .8s linear infinite"></div>' +
    '<span>Analyzing…</span></div></div>';

  document.body.appendChild(p);
  p.querySelector('#_afc_close').onclick = function () { p.remove(); };
  requestAnimationFrame(function () { p.style.opacity = '1'; p.style.transform = 'translateY(0)'; });

  fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Extension-Token': TOKEN },
    body: JSON.stringify({ text: text })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var b = document.getElementById('_afc_body');
      if (!b) return;
      if (d.error) { b.innerHTML = err(d.error); return; }
      b.innerHTML = render(d.result || '');
    })
    .catch(function (e) {
      var b = document.getElementById('_afc_body');
      if (b) b.innerHTML = err(e.message);
    });

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function err(msg) {
    return '<div style="display:flex;align-items:flex-start;gap:10px;color:#c62828;background:#fff5f5;border:1px solid #ffcdd2;border-radius:8px;padding:12px;font-size:13px">⚠ ' + esc(msg) + '</div>';
  }

  function sectionTitle(label, green) {
    var col = green ? '#2e7d32' : '#5c6bc0';
    var bdr = green ? '#a5d6a7' : '#e8e8f8';
    return '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:' + col + ';margin:12px 0 6px;padding-bottom:4px;border-bottom:1px solid ' + bdr + '">' + label + '</div>';
  }

  function render(text) {
    var lines = text.split('\n');
    var html = '';
    var inList = false;
    var isQ = lines.some(function (l) { return l.indexOf('TYPE: QUESTION') >= 0; });

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, '');
      if (/^TYPE:/.test(line)) continue;

      if (isQ) {
        if (/^CORRECT ANSWER/i.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += sectionTitle('✓ Correct Answer(s)', true); continue; }
        if (/^CONFIDENCE:/i.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += confLine(line.replace(/^CONFIDENCE:/i, '').trim()); continue; }
        if (/^EXPLANATION:/i.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += sectionTitle('Explanation', false); continue; }
        if (/^[-•] /.test(line)) {
          if (!inList) { html += '<ul style="list-style:none;padding:0;margin:0 0 8px">'; inList = true; }
          html += '<li style="background:#e8f5e9;border:1.5px solid #a5d6a7;border-radius:6px;padding:6px 10px;margin-bottom:5px;color:#1b5e20;font-size:13px;font-weight:500">' + esc(line.slice(2)) + '</li>';
          continue;
        }
      } else {
        if (/^VERDICT:/.test(line)) {
          if (inList) { html += '</ul>'; inList = false; }
          var val = line.replace(/^VERDICT:/, '').trim();
          var styles = { TRUE: ['#e8f5e9','#2e7d32','#a5d6a7'], FALSE: ['#ffebee','#c62828','#ef9a9a'], MISLEADING: ['#fff3e0','#e65100','#ffcc80'], 'PARTIALLY TRUE': ['#fff8e1','#f57f17','#ffe082'] };
          var vs = styles[val] || ['#f3f4f6','#555','#d1d5db'];
          html += '<div style="margin-bottom:10px"><span style="display:inline-block;padding:4px 14px;border-radius:20px;font-weight:700;font-size:13px;letter-spacing:.05em;text-transform:uppercase;background:' + vs[0] + ';color:' + vs[1] + ';border:1.5px solid ' + vs[2] + '">' + esc(val) + '</span></div>';
          continue;
        }
        if (/^CONFIDENCE:/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += confLine(line.replace(/^CONFIDENCE:/, '').trim()); continue; }
        var sm = line.match(/^(SUMMARY|KEY FACTS|SOURCES TO CHECK):?$/);
        if (sm) { if (inList) { html += '</ul>'; inList = false; } html += sectionTitle(sm[1], false); continue; }
        if (/^[-•] /.test(line)) {
          if (!inList) { html += '<ul style="margin:0 0 8px;padding-left:18px;font-size:13px;color:#444">'; inList = true; }
          html += '<li style="margin-bottom:4px">' + esc(line.slice(2)) + '</li>';
          continue;
        }
      }

      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += '<p style="margin:0 0 8px;font-size:13px;color:#444">' + esc(line) + '</p>';
    }
    if (inList) html += '</ul>';
    return html;
  }

  function confLine(conf) {
    var cc = conf === 'HIGH' ? '#2e7d32' : conf === 'MEDIUM' ? '#e65100' : '#c62828';
    return '<div style="font-size:13px;color:#555;margin-bottom:10px"><strong>Confidence:</strong> <span style="color:' + cc + ';font-weight:600">' + esc(conf) + '</span></div>';
  }
})();
