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
@media (max-width:520px) {
  .pad-win { inset:8px; width:auto; height:auto; }
  .pad-launch span { display:none; }
  .pad-launch { padding:0; width:54px; justify-content:center; }
  .pad-hint { width:calc(100vw - 60px); }
}`;

  let state = { open: false, max: false, busy: false, msgs: [] };
  let el = {};

  // Capture what the user is actually looking at. The widget hides itself first
  // so the captured text is the page, not Padmé's own conversation echoed back.
  function capturePage() {
    const w = document.getElementById('pad-root');
    const prev = w ? w.style.display : null;
    if (w) w.style.display = 'none';
    let text = (document.body?.innerText || '')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (w) w.style.display = prev || 'contents';
    if (text.length < 40) return null;
    if (text.length > PAGE_TEXT_MAX) text = text.slice(0, PAGE_TEXT_MAX);
    return { url: location.pathname + location.search + location.hash, title: document.title || '', text };
  }

  function avatar(cls) { return `<img src="img/padme.webp" alt="" class="${cls || ''}">`; }

  function scrollDown() { if (el.body) el.body.scrollTop = el.body.scrollHeight; }

  function renderMsgs() {
    el.body.innerHTML = state.msgs.map(m => {
      if (m.role === 'user') return `<div class="pad-msg user">${escHtml(m.content)}</div>`;
      const cls = m.error ? 'pad-msg bot err' : 'pad-msg bot';
      return `<div class="pad-row">${avatar()}<div class="${cls}">${escHtml(m.content) || '<span class="pad-dots"><span></span><span></span><span></span></span>'}</div></div>`;
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
        body: JSON.stringify({ message: msg, history, pageContext: capturePage() }),
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
      if (!slot.content) { slot.content = 'I came back empty-pawed — try asking again.'; slot.error = true; renderMsgs(); }
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
