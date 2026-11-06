// Ask Padmé — site-wide, page-aware assistant bubble.
// Ported from the ALZ-Observatory React widget to vanilla JS for this app.
// Injected by renderNav(), so it appears on every signed-in page.

(function () {
  const EXCLUDED = ['login.html', 'register.html', 'reset-password.html', 'verify-email.html'];
  const MAX_MESSAGES = 50;
  const PAGE_TEXT_MAX = 8000;

  const QUICK_PROMPTS = [
    'What am I looking at?',
    'Explain this page in simple terms',
    'What needs my attention here?',
    'Who are you, Padmé?',
  ];

  const STYLE = `
.pad-wrap { position:fixed; bottom:24px; right:24px; z-index:400; display:flex; flex-direction:column; align-items:flex-end; gap:12px; }
.pad-launch { display:flex; align-items:center; gap:9px; height:54px; padding:0 20px 0 8px; border:none; border-radius:999px;
  background:var(--scarlet); color:#fff; cursor:pointer; font-family:var(--font); font-size:.9rem; font-weight:600;
  box-shadow:0 8px 24px rgba(0,0,0,.28); transition:transform .15s, box-shadow .15s; }
.pad-launch:hover { transform:scale(1.05); box-shadow:0 10px 28px rgba(0,0,0,.36); }
.pad-launch img { width:40px; height:40px; border-radius:50%; object-fit:cover; background:#b10202; box-shadow:0 0 0 2px #fff; }
.pad-ping { position:absolute; inset:0; border-radius:999px; background:var(--scarlet); opacity:.4; animation:padPing 1.8s cubic-bezier(0,0,.2,1) infinite; z-index:-1; }
@keyframes padPing { 75%,100% { transform:scale(1.5); opacity:0; } }
.pad-hint { position:relative; width:270px; padding:12px 30px 12px 14px; border-radius:12px; background:var(--surface);
  border:1px solid var(--border); box-shadow:0 10px 30px rgba(0,0,0,.28); font-size:.82rem; color:var(--text); cursor:pointer; }
.pad-hint b { display:block; margin-bottom:3px; font-size:.86rem; }
.pad-hint span { color:var(--muted); line-height:1.45; }
.pad-hint-x { position:absolute; top:6px; right:6px; border:none; background:none; color:var(--muted); cursor:pointer; font-size:1rem; line-height:1; padding:2px 5px; border-radius:4px; }
.pad-hint-x:hover { background:var(--panel); color:var(--text); }

.pad-win { position:fixed; bottom:24px; right:24px; width:400px; height:620px; max-width:calc(100vw - 32px); max-height:calc(100vh - 48px);
  z-index:401; display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--border);
  border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.45); overflow:hidden; }
.pad-win.max { inset:24px; width:auto; height:auto; }
.pad-head { display:flex; align-items:center; justify-content:space-between; padding:11px 14px; border-bottom:1px solid var(--border); background:var(--panel); }
.pad-head-l { display:flex; align-items:center; gap:10px; min-width:0; }
.pad-head img { width:36px; height:36px; border-radius:50%; object-fit:cover; background:#b10202; }
.pad-head h3 { margin:0; font-size:.95rem; font-weight:700; }
.pad-head p { margin:1px 0 0; font-size:.7rem; color:var(--muted); }
.pad-head-r { display:flex; gap:3px; flex-shrink:0; }
.pad-ico { border:none; background:none; color:var(--muted); cursor:pointer; padding:5px 7px; border-radius:6px; font-size:.9rem; line-height:1; }
.pad-ico:hover { background:var(--surface); color:var(--text); }

.pad-body { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
.pad-msg { max-width:88%; padding:9px 12px; border-radius:12px; font-size:.86rem; line-height:1.55; white-space:pre-wrap; word-wrap:break-word; }
.pad-msg.user { align-self:flex-end; background:var(--scarlet); color:#fff; border-bottom-right-radius:4px; }
.pad-msg.bot { align-self:flex-start; background:var(--panel); color:var(--text); border:1px solid var(--border); border-bottom-left-radius:4px; }
.pad-msg.err { align-self:flex-start; background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.3); color:#fca5a5; }
.pad-row { display:flex; align-items:flex-start; gap:8px; }
.pad-row img { width:26px; height:26px; border-radius:50%; object-fit:cover; flex-shrink:0; background:#b10202; }
.pad-dots span { display:inline-block; width:5px; height:5px; margin-right:3px; border-radius:50%; background:var(--muted); animation:padBlink 1.4s infinite both; }
.pad-dots span:nth-child(2){animation-delay:.2s} .pad-dots span:nth-child(3){animation-delay:.4s}
@keyframes padBlink { 0%,80%,100%{opacity:.25} 40%{opacity:1} }

.pad-quick { display:flex; flex-wrap:wrap; gap:6px; padding:0 14px 10px; }
.pad-quick button { border:1px solid var(--border); background:var(--panel); color:var(--muted); font-family:var(--font);
  font-size:.74rem; padding:5px 10px; border-radius:999px; cursor:pointer; }
.pad-quick button:hover { border-color:var(--scarlet); color:var(--scarlet); }

.pad-foot { border-top:1px solid var(--border); padding:10px; display:flex; gap:8px; align-items:flex-end; background:var(--panel); }
.pad-foot textarea { flex:1; resize:none; min-height:38px; max-height:120px; padding:9px 11px; border-radius:9px;
  border:1px solid var(--border); background:var(--surface); color:var(--text); font-family:var(--font); font-size:.85rem; }
.pad-foot textarea:focus { outline:none; border-color:var(--scarlet); }
.pad-send { border:none; background:var(--scarlet); color:#fff; border-radius:9px; padding:9px 14px; cursor:pointer; font-weight:600; font-size:.85rem; }
.pad-send:disabled { opacity:.45; cursor:not-allowed; }
/* markdown inside a reply */
.pad-msg.bot { white-space:normal; }
.pad-msg.bot p { margin:0 0 7px; }
.pad-msg.bot p:last-child { margin-bottom:0; }
.pad-msg.bot ul, .pad-msg.bot ol { margin:0 0 7px; padding-left:19px; }
.pad-msg.bot li { margin:2px 0; }
.pad-msg.bot code { font-family:var(--mono); font-size:.8em; background:var(--surface); border:1px solid var(--border); border-radius:4px; padding:1px 4px; }
.pad-msg.bot a { color:var(--scarlet); }
.pad-msg.bot .pad-h { display:block; margin:6px 0 4px; font-size:.9rem; }
.pad-msg.bot strong { font-weight:700; color:var(--text); }
.pad-did { margin-top:8px; padding-top:7px; border-top:1px dashed var(--border); display:flex; flex-wrap:wrap; gap:5px; }
.pad-did span { font-family:var(--mono); font-size:.65rem; color:var(--muted); background:var(--surface);
  border:1px solid var(--border); border-radius:999px; padding:2px 8px; }

/* what Padmé is pointing at */
@keyframes padmeSpot {
  0%,100% { box-shadow:0 0 0 0 rgba(220,38,38,0); }
  12%     { box-shadow:0 0 0 4px rgba(220,38,38,.55); }
  60%     { box-shadow:0 0 0 4px rgba(220,38,38,.28); }
}
.padme-spot { animation:padmeSpot 2.6s ease-out; border-radius:7px; scroll-margin:90px; position:relative; z-index:2; }

@media (max-width:520px) {
  .pad-win { inset:8px; width:auto; height:auto; }
  .pad-launch span { display:none; }
  .pad-launch { padding:0; width:54px; justify-content:center; }
  .pad-hint { width:calc(100vw - 60px); }
}`;

  let state = { open: false, max: false, busy: false, msgs: [] };
  let el = {};

  // ── Page actions ────────────────────────────────────────────────────────────
  // Padmé may point at, click, or type into things on the page. Guardrails are
  // enforced here regardless of what the model says: page text is untrusted and
  // could try to steer it into destructive clicks.
  const ATTR = 'data-padme-id';
  const MAX_ITEMS = 90, MAX_ROWS = 25, MAX_LABEL = 70;

  // Never click anything whose label suggests it changes or destroys state.
  const UNSAFE = /\b(save|submit|delete|remove|approve|reject|assign|release|done|confirm|edit|update|add|create|upload|import|export|download|sync|run|start|stop|clear|reset|log ?out|sign ?out|send|mark|archive|restore|apply|accept|decline|verify|retry|advance|stuck|hold|publish|post|resolve|deny|grant)\b/i;
  const ACTION_WORDS = /\b(sort|order|open|go|take me|bring me|navigate|click|press|tap|switch|filter|search|find|look up|type|enter|select|expand|collapse|next|previous|tab|show me the)\b/i;
  // Admin is user management and backups; never act there.
  const NO_ACT_PAGES = /^(admin|login|profile)\.html$/;

  const wantsAction = (s) => ACTION_WORDS.test(s);
  const pageName = () => location.pathname.split('/').pop() || '';
  const clean = (s) => (s || '').replace(/[↕↑↓⇅▲▼]/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = (s) => (s.length > MAX_LABEL ? s.slice(0, MAX_LABEL - 1) + '…' : s);
  const TAG = /\[\[\s*(show|click|type)\s+(e\d+)\s*(?:\|\s*([^\]]*))?\]\]/gi;

  function stripTags(raw) {
    return String(raw).replace(TAG, '').replace(/\[\[[^\]]*\]?$/, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  }
  function parseActions(raw) {
    const acts = [];
    String(raw).replace(TAG, (_m, verb, id, arg) => {
      acts.push({ verb: verb.toLowerCase(), id, text: arg ? arg.trim() : undefined });
      return '';
    });
    return acts.slice(0, 2);
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function kindOf(el) {
    const t = el.tagName;
    if (t === 'A') return 'link';
    if (t === 'TH') return 'header';
    if (t === 'TR') return 'row';
    if (/^H[1-4]$/.test(t)) return 'section';
    if (t === 'INPUT' || t === 'TEXTAREA') return 'searchbox';
    if (el.getAttribute('role') === 'tab') return 'tab';
    if (el.classList.contains('tab')) return 'tab';
    return 'button';
  }
  function isSearchBox(el) {
    if (el.tagName === 'TEXTAREA' || el.disabled || el.readOnly) return false;
    if (!['text', 'search', ''].includes((el.getAttribute('type') || '').toLowerCase())) return false;
    return /search|filter|find|title|keyword/i.test(`${el.placeholder} ${el.getAttribute('aria-label') || ''} ${el.id}`);
  }
  function labelOf(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return clean(el.getAttribute('aria-label') || el.placeholder || el.id)
           + (el.value ? ` (now: "${clean(el.value).slice(0, 30)}")` : '');
    }
    if (el.tagName === 'TR') {
      return Array.from(el.children).slice(0, 4).map(c => clean(c.innerText)).filter(Boolean).join(' · ');
    }
    return clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title'));
  }
  function shortName(el, kind) {
    const t = kind === 'row' ? labelOf(el).split(' · ')[0] : labelOf(el).replace(/ \(now: .*$/, '');
    return (t.length > 40 ? t.slice(0, 39) + '…' : t) || kind;
  }
  function canClick(el, kind, text) {
    if (NO_ACT_PAGES.test(pageName())) return false;
    if (el.closest('[data-padme="off"]') || el.isContentEditable) return false;
    if (UNSAFE.test(text)) return false;
    if (kind === 'link') {
      const href = el.getAttribute('href') || '';
      if (el.hasAttribute('download')) return false;
      if (!(href.startsWith('/') || href.startsWith('#') || /^[\w.-]+\.html/.test(href))) return false;
      if (href.startsWith('//') || /\/api\//i.test(href)) return false;
      return true;
    }
    if (kind === 'button') {
      const form = el.form;
      if (form && (el.type || 'submit') === 'submit' && form.getAttribute('role') !== 'search') return false;
      return true;
    }
    if (kind === 'row') return getComputedStyle(el).cursor === 'pointer';
    if (kind === 'header') return el.hasAttribute('aria-sort') || !!el.querySelector('button') || getComputedStyle(el).cursor === 'pointer';
    return kind === 'tab';
  }

  // Stamp on-screen items and describe them for the model. Runs while the widget
  // is hidden so Padmé never lists her own controls.
  function inventoryPage(root) {
    document.querySelectorAll(`[${ATTR}]`).forEach(e => e.removeAttribute(ATTR));
    if (!root) return '';
    const widget = document.getElementById('pad-root');
    const sel = 'a[href], button, [role=tab], .tab, th, h1, h2, h3, h4, input, tbody tr';
    const lines = [], seen = new Set();
    let rows = 0, n = 0;
    for (const e of Array.from(root.querySelectorAll(sel))) {
      if (n >= MAX_ITEMS) break;
      if ((widget && widget.contains(e)) || !visible(e)) continue;
      if (e.tagName === 'INPUT' && !isSearchBox(e)) continue;
      if (e.disabled) continue;
      if ((e.tagName === 'BUTTON' || e.tagName === 'A') && e.closest('th')) continue;
      const kind = kindOf(e);
      if (kind === 'row' && ++rows > MAX_ROWS) continue;
      const text = labelOf(e);
      if (!text) continue;
      const key = `${kind}:${text}`;
      if (kind !== 'row' && seen.has(key)) continue;
      seen.add(key);
      const id = `e${++n}`;
      e.setAttribute(ATTR, id);
      const ok = canClick(e, kind, text);
      const suffix = kind === 'row' ? (ok ? ' (opens)' : '')
        : kind === 'header' ? (ok ? ' (click to sort)' : '')
        : (kind === 'section' || kind === 'searchbox') ? ''
        : ok ? '' : ' (show only)';
      const href = kind === 'link' ? (e.getAttribute('href') || '') : '';
      lines.push(`${id} ${kind}: ${cut(text)}${href && !href.startsWith('http') ? ` -> ${href}` : ''}${suffix}`);
    }
    return lines.join('\n');
  }

  function spotlight(e) {
    e.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    e.classList.remove('padme-spot');
    void e.offsetWidth; // restart the animation
    e.classList.add('padme-spot');
    setTimeout(() => e.classList.remove('padme-spot'), 2600);
  }

  function pressEnter(input) {
    if (!input.isConnected) return;
    const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const handled = !input.dispatchEvent(new KeyboardEvent('keydown', o));
    input.dispatchEvent(new KeyboardEvent('keypress', o));
    input.dispatchEvent(new KeyboardEvent('keyup', o));
    const form = input.form;
    if (!handled && form && form.getAttribute('role') === 'search') form.requestSubmit();
  }

  function runAction(a, allowAct) {
    if (!/^e\d{1,3}$/.test(a.id)) return null;
    const e = document.querySelector(`[${ATTR}="${a.id}"]`);
    const widget = document.getElementById('pad-root');
    if (!e || (widget && widget.contains(e))) return null;
    const kind = kindOf(e);
    const name = shortName(e, kind);
    const act = allowAct && !NO_ACT_PAGES.test(pageName()) && !e.closest('[data-padme="off"]');

    if (a.verb === 'type') {
      if (!act || kind !== 'searchbox' || !isSearchBox(e) || a.text == null) { spotlight(e); return `Showing: ${name}`; }
      const value = a.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
      e.value = value;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      spotlight(e);
      e.focus({ preventScroll: true });
      setTimeout(() => pressEnter(e), 500);
      return `Searched "${value.slice(0, 40)}"`;
    }
    if (a.verb === 'click' && act && canClick(e, kind, labelOf(e))) {
      spotlight(e);
      setTimeout(() => e.click(), 350);
      return `Clicked: ${name}`;
    }
    spotlight(e);
    return `Showing: ${name}`;
  }

  // Capture what the user is actually looking at. The widget hides itself first
  // so the captured text is the page, not Padmé's own conversation echoed back.
  function capturePage(withItems) {
    const w = document.getElementById('pad-root');
    const prev = w ? w.style.display : null;
    if (w) w.style.display = 'none';
    let text = (document.body?.innerText || '')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    // Stamp the actionable items while the widget is still hidden.
    const items = withItems ? inventoryPage(document.querySelector('.page-wrap') || document.body) : '';
    if (w) w.style.display = prev || 'contents';
    if (text.length < 40) return null;
    const cap = withItems ? 7000 : PAGE_TEXT_MAX;
    if (text.length > cap) text = text.slice(0, cap);
    return {
      url: location.pathname + location.search + location.hash,
      title: document.title || '',
      text,
      ...(items ? { items } : {}),
    };
  }

  function avatar(cls) { return `<img src="img/padme.webp" alt="" class="${cls || ''}">`; }

  // Minimal markdown → HTML. Escapes first, so model output is never injected raw.
  function md(src) {
    const lines = escHtml(src).split('\n');
    let out = '', list = null;

    const inline = (s) => s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    const closeList = () => { if (list) { out += `</${list}>`; list = null; } };

    for (let raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) { closeList(); continue; }

      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); out += `<b class="pad-h">${inline(h[2])}</b>`; continue; }

      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) {
        if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; }
        out += `<li>${inline(ul[1])}</li>`;
        continue;
      }
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; }
        out += `<li>${inline(ol[1])}</li>`;
        continue;
      }

      closeList();
      out += `<p>${inline(line)}</p>`;
    }
    closeList();
    return out;
  }

  function scrollDown() { if (el.body) el.body.scrollTop = el.body.scrollHeight; }

  function renderMsgs() {
    el.body.innerHTML = state.msgs.map(m => {
      if (m.role === 'user') return `<div class="pad-msg user">${escHtml(m.content)}</div>`;
      const cls = m.error ? 'pad-msg bot err' : 'pad-msg bot';
      // Strip any action tag still mid-stream so "[[cli" never flashes on screen.
      const shown = m.error ? escHtml(m.content) : md(stripTags(m.content));
      const inner = m.content ? shown : '<span class="pad-dots"><span></span><span></span><span></span></span>';
      const note = (m.done && m.done.length)
        ? `<div class="pad-did">${m.done.map(d => `<span>${escHtml(d)}</span>`).join('')}</div>` : '';
      return `<div class="pad-row">${avatar()}<div class="${cls}">${inner}${note}</div></div>`;
    }).join('');
    scrollDown();
  }

  function openWin() {
    state.open = true;
    localStorage.setItem('padme_seen', '1');
    el.wrap.style.display = 'none';
    el.win.style.display = 'flex';
    if (!state.msgs.length) {
      state.msgs.push({ role: 'assistant', content: "Woof! I'm Padmé. I can see the page you're on — ask me what you're looking at, or anything about the bylaws process. 🐾" });
    }
    renderMsgs();
    el.input.focus();
  }

  function closeWin() {
    state.open = false;
    el.win.style.display = 'none';
    el.wrap.style.display = 'flex';
  }

  async function send(text) {
    const msg = (text || el.input.value).trim();
    if (!msg || state.busy) return;
    if (state.msgs.filter(m => m.role === 'user').length >= MAX_MESSAGES) {
      state.msgs.push({ role: 'assistant', content: 'That is a long trail — start a fresh chat with the ⟳ button to keep going.', error: true });
      renderMsgs();
      return;
    }

    el.input.value = '';
    const sentFrom = pageName();
    state.busy = true;
    el.send.disabled = true;
    el.quick.style.display = 'none';

    const history = state.msgs.filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
    state.msgs.push({ role: 'user', content: msg });
    state.msgs.push({ role: 'assistant', content: '' });
    renderMsgs();
    const slot = state.msgs[state.msgs.length - 1];

    try {
      const res = await fetch('/BylawsTracker/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ message: msg, history, pageContext: capturePage(true) }),
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        slot.content = e.error || `Something went wrong (HTTP ${res.status}).`;
        slot.error = true;
        renderMsgs();
        return;
      }

      // Server-Sent Events: lines of `data: {...}`
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          let d;
          try { d = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (d.error) { slot.content = d.error; slot.error = true; }
          if (d.content) slot.content += d.content;
          renderMsgs();
        }
      }
      if (!slot.content) { slot.content = 'I came back empty-pawed — try asking again.'; slot.error = true; renderMsgs(); return; }

      // Act on the page. Clicking and typing only when the user's own words asked
      // for it AND they are still on the page the question was asked from;
      // anything else degrades to a highlight.
      const allowAct = wantsAction(msg) && pageName() === sentFrom;
      const done = parseActions(slot.content).map(a => runAction(a, allowAct)).filter(Boolean);
      if (done.length) { slot.done = done; renderMsgs(); }
    } catch (err) {
      slot.content = 'I could not reach the model just now.';
      slot.error = true;
      renderMsgs();
    } finally {
      state.busy = false;
      el.send.disabled = false;
    }
  }

  function build() {
    if (document.getElementById('pad-root')) return;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'pad-root';
    root.style.display = 'contents';
    const seen = localStorage.getItem('padme_seen');

    root.innerHTML = `
      <div class="pad-wrap" id="pad-wrap">
        ${seen ? '' : `<div class="pad-hint" id="pad-hint">
          <button class="pad-hint-x" id="pad-hint-x" aria-label="Dismiss">&times;</button>
          <b>🐾 Woof! I'm Padmé.</b>
          <span>Your guide through the bylaws process. Ask me anything, or about the page you're on.</span>
        </div>`}
        <button class="pad-launch" id="pad-launch" title="Ask Padmé" aria-label="Ask Padmé">
          ${seen ? '' : '<span class="pad-ping" aria-hidden="true"></span>'}
          ${avatar()}<span>Ask Padmé</span>
        </button>
      </div>

      <div class="pad-win" id="pad-win" style="display:none;" role="dialog" aria-label="Ask Padmé">
        <div class="pad-head">
          <div class="pad-head-l">
            ${avatar()}
            <div><h3>Padmé</h3><p>Bylaws guide · page-aware</p></div>
          </div>
          <div class="pad-head-r">
            <button class="pad-ico" id="pad-reset" title="New chat">&#8635;</button>
            <button class="pad-ico" id="pad-max" title="Maximize">&#9633;</button>
            <button class="pad-ico" id="pad-close" title="Close">&times;</button>
          </div>
        </div>
        <div class="pad-body" id="pad-body"></div>
        <div class="pad-quick" id="pad-quick">
          ${QUICK_PROMPTS.map(q => `<button data-q="${escHtml(q)}">${escHtml(q)}</button>`).join('')}
        </div>
        <div class="pad-foot">
          <textarea id="pad-input" rows="1" placeholder="Ask about this page…"></textarea>
          <button class="pad-send" id="pad-send">Send</button>
        </div>
      </div>`;
    document.body.appendChild(root);

    el = {
      wrap: root.querySelector('#pad-wrap'),
      win: root.querySelector('#pad-win'),
      body: root.querySelector('#pad-body'),
      input: root.querySelector('#pad-input'),
      send: root.querySelector('#pad-send'),
      quick: root.querySelector('#pad-quick'),
    };

    root.querySelector('#pad-launch').addEventListener('click', openWin);
    root.querySelector('#pad-close').addEventListener('click', closeWin);
    root.querySelector('#pad-max').addEventListener('click', () => {
      state.max = !state.max;
      el.win.classList.toggle('max', state.max);
      scrollDown();
    });
    root.querySelector('#pad-reset').addEventListener('click', () => {
      state.msgs = [];
      el.quick.style.display = 'flex';
      openWin();
    });

    const hint = root.querySelector('#pad-hint');
    if (hint) {
      root.querySelector('#pad-hint-x').addEventListener('click', (e) => {
        e.stopPropagation();
        localStorage.setItem('padme_seen', '1');
        hint.remove();
      });
      hint.addEventListener('click', openWin);
    }

    el.quick.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => send(b.dataset.q));
    });
    el.send.addEventListener('click', () => send());
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) closeWin();
    });
  }

  window.initPadme = function () {
    const page = location.pathname.split('/').pop() || '';
    if (EXCLUDED.includes(page)) return;
    if (typeof getToken !== 'function' || !getToken()) return;
    build();
  };
})();
