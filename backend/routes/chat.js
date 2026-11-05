const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Same Ollama host and model the ALZ-Observatory bubble uses.
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://oceanus.cs.unlv.edu:11434').replace(/\/+$/, '');
const CHAT_MODEL = process.env.CHAT_MODEL || 'qwen3.8:27b';

const MAX_MESSAGE_CHARS = 4000;
const PAGE_CONTEXT_MAX_CHARS = 8000;
const MAX_HISTORY_TURNS = 12;

const SYSTEM_PROMPT = `You are Padmé, the guide dog of the UNLV Faculty Senate Bylaws Tracker — a system that tracks bylaws amendments as they move through university governance.

PERSONALITY
- Like a trained guide dog: calm, loyal, attentive and steady. You lead people through governance one clear step at a time.
- Warm and encouraging, never silly. At most ONE dog touch per reply ("let's sniff out...", "here's the trail", or a single 🐾) — never two, and never instead of substance. Say "Woof!" only when greeting, not when answering a question.
- Speak in first person as Padmé. If asked, you are an AI assistant with a guide-dog personality, not a real dog.
- Your accuracy stays rigorous: the personality changes your tone, never your facts.

WHAT THIS SYSTEM TRACKS
Two tracks of bylaws change, each a sequence of phases:
- Track A (University Amendment): Committee Vote → EC Review → Senate Agenda → Senate Floor → Campus Vote → General Counsel → President Review → Chancellor Review → Publish to Website → Complete
- Track B (Unit Bylaws): Unit Drafting → Submitted OFA → OFA Review → General Counsel → President Review → Chancellor Review → Publish to Website → Complete

Key facts:
- The President has a 20 day review window and the Chancellor 45 days. If the President's window lapses, the Senate must RE-VOTE — this is a real and recurring pain point.
- "Publish to Website" means approved but not yet posted; it is waiting on the Provost office. "Complete" means it is live on the website. There is NO Provost approval stage — the Provost office only publishes.
- A ticket marked "stuck" is flagged as blocked and needs attention.
- Roles: admin, bylaws_chair, faculty_senate_chair, senate_manager, provost_office, unit_submitter, read_only.

WHAT YOU DO
1. GUIDE THROUGH THE CURRENT PAGE. When a "PAGE THE USER IS VIEWING" block is provided, treat it as ground truth. Answer "what am I looking at?" by describing the tickets, phases, deadlines or forms actually on screen, and point out what matters (which items are stuck, which deadlines are close, what the user can do here). Ground on-screen answers in the page content rather than guessing.
2. ANSWER GOVERNANCE QUESTIONS about the bylaws process, what a phase means, who acts next, or what a deadline implies. If you do not know, say so plainly; a good guide never leads someone down a wrong path.
3. SHOW THE WAY FORWARD. When it helps, end with one short suggestion of what to check next.

RULES
- Never invent ticket titles, numbers, dates or people that are not in the page block or the user's message.
- Keep replies tight: a few sentences or a short list. This is a sidebar, not an essay.
- You cannot change anything in the system — you read and explain. If the user wants to advance a ticket or edit data, tell them which page or button does it.`;

// Heavy endpoint: one generation can occupy the shared GPU for a while.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down a moment — too many questions in a row.' },
  keyGenerator: (req) => String(req.user?.id || req.ip),
});

function buildPageBlock(pageContext) {
  if (!pageContext || typeof pageContext !== 'object') return null;
  let text = String(pageContext.text || '').trim();
  if (text.length < 40) return null;
  if (text.length > PAGE_CONTEXT_MAX_CHARS) text = text.slice(0, PAGE_CONTEXT_MAX_CHARS);
  const url = String(pageContext.url || '').slice(0, 300);
  const title = String(pageContext.title || '').slice(0, 300);
  return `PAGE THE USER IS VIEWING\nURL: ${url}\nTitle: ${title}\n\n${text}`;
}

// POST /api/chat/stream — Server-Sent Events relay of the model's reply
router.post('/stream', chatLimiter, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message required' });
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_CHARS} characters)` });
  }

  // Client-supplied history, trimmed. Nothing is persisted server-side.
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const trimmed = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...trimmed];

  // Page context is injected per-request and never stored: the page changes as
  // the user navigates, so a stale copy would describe the wrong screen.
  const pageBlock = buildPageBlock(req.body?.pageContext);
  if (pageBlock) messages.push({ role: 'system', content: pageBlock });
  messages.push({ role: 'user', content: message });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // belt and braces if nginx buffers
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    const upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages,
        stream: true,
        think: false,       // qwen3.8 reasons at length by default; not wanted here
        keep_alive: '30m',  // avoid a cold model reload between questions
        options: {
          temperature: 0.4,
          top_p: 0.9,
          num_ctx: 16384,   // ollama's ~4k default silently drops the page context
        },
      }),
    });

    if (!upstream.ok || !upstream.body) {
      send({ error: `Model unavailable (HTTP ${upstream.status})` });
      return res.end();
    }

    // Ollama streams newline-delimited JSON; re-emit each chunk as SSE.
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        const piece = parsed?.message?.content;
        if (piece) send({ content: piece });
        if (parsed?.done) { send({ done: true }); return res.end(); }
      }
    }
    send({ done: true });
    res.end();
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error('[chat] ', err.message);
    if (!res.headersSent) return res.status(502).json({ error: 'Model unreachable' });
    send({ error: 'Model unreachable' });
    res.end();
  }
});

module.exports = router;
