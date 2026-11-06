const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://oceanus.cs.unlv.edu:11434').replace(/\/+$/, '');
const CHAT_MODEL = process.env.CHAT_MODEL || 'qwen3.8:27b';
const BASE = 'https://www.unlv.edu/facultysenate/committees/';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // chairs change at most once a term

// Names and slugs are stable; the charge and chair are scraped live so a chair
// election never leaves this page stating something false.
const COMMITTEES = [
  { slug: 'academic-standards',          name: 'Academic Standards',                group: 'Curriculum & Academic Policy' },
  { slug: 'admissions',                  name: 'Admissions',                        group: 'Curriculum & Academic Policy' },
  { slug: 'gen-ed',                      name: 'General Education',                 group: 'Curriculum & Academic Policy' },
  { slug: 'pnpr',                        name: 'Priority & New Program Review',     group: 'Curriculum & Academic Policy' },
  { slug: 'program-review',              name: 'Program Review',                    group: 'Curriculum & Academic Policy' },
  { slug: 'curriculum',                  name: 'Undergraduate Curriculum',          group: 'Curriculum & Academic Policy' },
  { slug: 'athletic-council',            name: 'Intercollegiate Athletic Council',  group: 'Curriculum & Academic Policy' },
  { slug: 'academic-freedom',            name: 'Academic Freedom and Ethics',       group: 'University Governance' },
  { slug: 'campus',                      name: 'Campus and Fiscal Affairs',         group: 'University Governance' },
  { slug: 'diversity',                   name: 'Diversity, Equity and Inclusion',   group: 'University Governance' },
  { slug: 'university-bylaws',           name: 'University Bylaws',                 group: 'University Governance' },
  { slug: 'university-technology',       name: 'University Technology',             group: 'University Governance' },
  { slug: 'research-infrastructure',     name: 'Research Infrastructure',           group: 'University Governance' },
  { slug: 'instructional-infrastructure',name: 'Instructional Infrastructure',      group: 'University Governance' },
  { slug: 'grievance',                   name: 'Grievance',                         group: 'Personnel and Development' },
  { slug: 'tenure-promotion',            name: 'University Tenure & Promotion',     group: 'Personnel and Development' },
  { slug: 'special-hearing',             name: 'Special Hearing',                   group: 'Personnel and Development' },
];

const cache = new Map(); // slug -> { at, charge, chair }

function stripHtml(h) {
  h = h.replace(/<(script|style|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  h = h.replace(/<[^>]+>/g, '\n');
  h = h.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
       .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return h.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

function unescapeHtml(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Placeholders that occupy the chair slot but are not a person.
const NOT_A_PERSON = /^\s*(vacant|tbd|tba|n\/?a|none|pending\b.*|to be (determined|announced|elected))\s*$/i;
const NAME_RE = /^[A-Z][A-Za-z.'()-]+(?: [A-Z(][A-Za-z.'()-]*){1,3}$/;

// Committee pages mark the chair three different ways, so all three are tried:
//   <dt>COMMITTEE CHAIR …</dt><dd><em>Name</em><br><a href="mailto:…"></dd>
//   <h5>COMMITTEE CHAIR …</h5><p><em>Name</em><br>Term expires …</p>
//   <dt>College of Education</dt><dd><p>Name (Chair)<br><a href="mailto:…"></dd>
function extractChair(doc) {
  const blocks = [];
  for (const m of doc.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    blocks.push({ label: m[1], body: m[2] });
  }
  for (const m of doc.matchAll(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>([\s\S]*?)(?=<h[2-6][\s>]|$)/gi)) {
    blocks.push({ label: m[1], body: m[2] });
  }

  const clean = (raw) => unescapeHtml(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

  const readName = (body) => {
    const em = body.match(/<em[^>]*>([\s\S]*?)<\/em>/i);
    let name = em ? clean(em[1]) : null;
    if (!name) {
      const lines = unescapeHtml(body.replace(/<[^>]+>/g, '\n')).split('\n').map(s => s.trim());
      name = lines.find(l => NAME_RE.test(l) && !/^term expires/i.test(l)) || null;
    }
    if (!name) return null;
    name = name.replace(/\s*\((?:co-)?chair\)\s*/i, '').trim();
    return (!name || NOT_A_PERSON.test(name)) ? null : name;
  };

  const emailOf = (body) => {
    const m = body.match(/mailto:([^"'>?]+)/i);
    return m ? unescapeHtml(m[1]).trim() : null;
  };

  // Labelled chair seats. Keep scanning past vacant ones: some committees list
  // several chair-labelled seats and only a later one is filled.
  for (const b of blocks) {
    const label = clean(b.label);
    if (/vice\s+chair/i.test(label)) continue;
    if (!(/\bCOMMITTEE\s+CHAIR\b/i.test(label) || /^CHAIR\b/i.test(label))) continue;
    const name = readName(b.body);
    if (name) return { chair: name, chairEmail: emailOf(b.body) };
  }

  // Chair flagged inside the member's own line instead of the seat label.
  for (const b of blocks) {
    const txt = clean(b.body);
    if (!/\((?:co-)?chair\)/i.test(txt) || /vice\s+chair/i.test(txt)) continue;
    const name = readName(b.body);
    if (name) return { chair: name, chairEmail: emailOf(b.body) };
  }

  return { chair: null, chairEmail: null };
}

async function scrape(slug) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const rec = { at: Date.now(), charge: null, chair: null, chairEmail: null };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(BASE + slug, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'UNLV-BylawsTracker/1.0' },
    });
    clearTimeout(t);
    if (res.ok) {
      const doc = await res.text();
      const lines = stripHtml(doc).split('\n').map(s => s.trim()).filter(Boolean);
      for (const l of lines) {
        if (l.length > 70 && /responsib|shall|review|committee/i.test(l)
            && !/cookie|navigation|skip to|copyright/i.test(l)) { rec.charge = l.slice(0, 400); break; }
      }
      Object.assign(rec, extractChair(doc));
    }
  } catch { /* leave nulls; the UI shows the link so the user can check directly */ }

  cache.set(slug, rec);
  return rec;
}

async function allCommittees() {
  const details = await Promise.all(COMMITTEES.map(c => scrape(c.slug)));
  return COMMITTEES.map((c, i) => ({
    ...c,
    url: BASE + c.slug,
    charge: details[i].charge,
    chair: details[i].chair,
    chairEmail: details[i].chairEmail,
  }));
}

// GET /api/committees — full directory with live charge + chair
router.get('/', async (req, res) => {
  try {
    res.json(await allCommittees());
  } catch {
    res.status(502).json({ error: 'Could not reach the Faculty Senate site' });
  }
});

// GET /api/committees/:slug — one committee, forced refresh with ?fresh=1
router.get('/:slug', async (req, res) => {
  const c = COMMITTEES.find(x => x.slug === req.params.slug);
  if (!c) return res.status(404).json({ error: 'Unknown committee' });
  if (req.query.fresh) cache.delete(c.slug);
  const d = await scrape(c.slug);
  res.json({ ...c, url: BASE + c.slug, charge: d.charge, chair: d.chair, chairEmail: d.chairEmail });
});

const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many questions in a row — give it a moment.' },
  keyGenerator: (req) => String(req.user?.id || req.ip),
});

// POST /api/committees/ask — route a question to the right committee
router.post('/ask', askLimiter, async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'Question required' });
  if (question.length > 1000) return res.status(400).json({ error: 'Question too long (max 1000 characters)' });

  const list = await allCommittees();
  const directory = list.map(c =>
    `- ${c.name} [slug: ${c.slug}] (${c.group})\n  Chair: ${c.chair || 'not listed'}${c.chairEmail ? ` <${c.chairEmail}>` : ''}\n  Charge: ${c.charge || 'not published'}`
  ).join('\n');

  const system = `You are Padmé, the guide dog of the UNLV Faculty Senate Bylaws Tracker. Right now you are helping someone find the RIGHT FACULTY SENATE COMMITTEE for their question.

Below is the live committee directory, scraped from the Faculty Senate website. It is your only source of truth about which committees exist, what they do, and who chairs them.

${directory}

RULES
- Recommend ONE primary committee. Add at most one alternative only if the question genuinely spans two.
- Name the committee exactly as written above, and give its slug in the form [[slug]] on its own line at the very end so the interface can link it. Example final line: [[university-bylaws]]
- Explain in 2-4 sentences WHY that committee owns this, grounded in its charge.
- If a chair is listed, name them. If the chair shows as "not listed" or looks like a placeholder such as "Pending Committee Election", say the chair is not currently published and tell them to contact the Faculty Senate office at Faculty.Senate@unlv.edu.

WHEN NOTHING FITS
- Only recommend a committee when the question genuinely falls under its charge. A vague, off-topic, personal or unanswerable question does NOT belong to a committee.
- **University Bylaws is NOT a catch-all.** Pick it only when the question is specifically about the wording, amendment or review of bylaws. Never fall back to it because nothing else matched.
- When no committee is a genuine fit, say so in one or two sentences, point the person to the Faculty Senate office at Faculty.Senate@unlv.edu, and end with exactly [[none]] instead of a slug.

- Never invent a committee, a chair, or a charge that is not in the directory above.
- Be warm and brief. At most one dog touch (a single 🐾 or "let's sniff this out"), never more.`;

  const ctl = new AbortController();
  req.on('close', () => ctl.abort());
  try {
    const up = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: question }],
        stream: false,
        think: false,
        keep_alive: '30m',
        options: { temperature: 0.3, top_p: 0.9, num_ctx: 16384 },
      }),
    });
    if (!up.ok) return res.status(502).json({ error: `Model unavailable (HTTP ${up.status})` });

    const data = await up.json();
    const answer = (data?.message?.content || '').trim();

    // The model tags its pick as [[slug]], or [[none]] when nothing genuinely
    // fits. An unrecognised tag resolves to null rather than guessing, so a bad
    // slug can never surface the wrong committee as an answer.
    const m = answer.match(/\[\[([a-z-]+)\]\]/i);
    const tag = m ? m[1].toLowerCase() : null;
    const picked = (tag && tag !== 'none') ? list.find(c => c.slug === tag) || null : null;
    res.json({
      answer: answer.replace(/\[\[[a-z-]+\]\]/gi, '').trim(),
      committee: picked,
      noMatch: !picked,
    });
  } catch (err) {
    if (ctl.signal.aborted) return;
    console.error('[committees/ask]', err.message);
    res.status(502).json({ error: 'Model unreachable' });
  }
});

module.exports = router;
