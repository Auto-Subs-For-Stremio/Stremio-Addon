// Subtitle Toolbox — core library (MIT). Runs in the browser and in Node.
// Pure functions over a single cue model: { index, start, end, text }
// with times in milliseconds and text as lines joined by "\n".

// ---------------------------------------------------------------- parsing

const SRT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const VTT_TIME = /(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})/;
const ASS_TIME = /(\d+):(\d{2}):(\d{2})\.(\d{2})/;

export function parseTime(str, kind = 'srt') {
  const s = String(str).trim();
  if (kind === 'ass') {
    const m = ASS_TIME.exec(s);
    if (!m) return null;
    return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] * 10;
  }
  if (kind === 'vtt') {
    const m = VTT_TIME.exec(s);
    if (!m) return null;
    return ((+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4];
  }
  const m = SRT_TIME.exec(s);
  if (!m) return null;
  return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4].padEnd(3, '0');
}

export function formatTime(ms, kind = 'srt') {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const f = clamped % 1000;
  const p = (n, w) => String(n).padStart(w, '0');
  if (kind === 'ass') return `${h}:${p(m, 2)}:${p(s, 2)}.${p(Math.floor(f / 10), 2)}`;
  const sep = kind === 'vtt' ? '.' : ',';
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)}${sep}${p(f, 3)}`;
}

export function detectFormat(text) {
  const head = text.slice(0, 2000);
  if (/^\uFEFF?WEBVTT/.test(head)) return 'vtt';
  if (/^\s*\[Script Info\]/m.test(head) || /^\s*\[Events\]/m.test(text) || /^Dialogue:/m.test(head)) return 'ass';
  if (/\d{1,2}:\d{2}:\d{2},\d{1,3}\s*-->/.test(head)) return 'srt';
  if (/\d{2}:\d{2}\.\d{3}\s*-->/.test(head)) return 'vtt';
  if (/^\{\d+\}\{\d+\}/m.test(head)) return 'microdvd';
  return 'unknown';
}

export function parseSrt(text) {
  const cues = [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
    if (!lines.length) continue;
    let i = 0;
    if (/^\s*\d+\s*$/.test(lines[0])) i = 1;
    const timing = lines[i] || '';
    const parts = timing.split('-->');
    if (parts.length !== 2) continue;
    const start = parseTime(parts[0]);
    const end = parseTime(parts[1]);
    if (start == null || end == null) continue;
    cues.push({ start, end, text: lines.slice(i + 1).join('\n').trim() });
  }
  return renumber(cues);
}

export function parseVtt(text) {
  const cues = [];
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = body.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^WEBVTT/.test(lines[0]) || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    let i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = parseTime(a, 'vtt');
    const end = parseTime(b, 'vtt');
    if (start == null || end == null) continue;
    const textLines = lines.slice(i + 1).map((l) => l.replace(/<\/?(?:c|v|b|i|u|ruby|rt|lang)[^>]*>/g, ''));
    cues.push({ start, end, text: textLines.join('\n').trim() });
  }
  return renumber(cues);
}

export function parseAss(text) {
  const cues = [];
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let inEvents = false;
  let format = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[Events\]/i.test(line)) { inEvents = true; continue; }
    if (/^\[/.test(line)) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) {
      format = line.slice(7).split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const fields = format || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const payload = line.slice(9).trim();
    const parts = payload.split(',');
    const textIdx = fields.indexOf('text');
    const rec = {};
    fields.forEach((f, i) => { rec[f] = i === textIdx ? parts.slice(i).join(',') : parts[i]; });
    const start = parseTime(rec.start || '', 'ass');
    const end = parseTime(rec.end || '', 'ass');
    if (start == null || end == null) continue;
    const t = String(rec.text || '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N|\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .trim();
    if (!t) continue;
    cues.push({ start, end, text: t });
  }
  cues.sort((a, b) => a.start - b.start);
  return renumber(cues);
}

export function parseAny(text) {
  const kind = detectFormat(text);
  if (kind === 'vtt') return { kind, cues: parseVtt(text) };
  if (kind === 'ass') return { kind, cues: parseAss(text) };
  if (kind === 'srt') return { kind, cues: parseSrt(text) };
  // Last resort: try SRT anyway.
  const cues = parseSrt(text);
  return { kind: cues.length ? 'srt' : 'unknown', cues };
}

export function renumber(cues) {
  return cues.map((c, i) => ({ ...c, index: i + 1 }));
}

// -------------------------------------------------------------- serializing

export function toSrt(cues) {
  return renumber(cues).map((c) => `${c.index}\n${formatTime(c.start)} --> ${formatTime(c.end)}\n${c.text}`).join('\n\n') + '\n';
}

export function toVtt(cues) {
  return 'WEBVTT\n\n' + renumber(cues).map((c) => `${c.index}\n${formatTime(c.start, 'vtt')} --> ${formatTime(c.end, 'vtt')}\n${c.text}`).join('\n\n') + '\n';
}

export function toAss(cues, { title = 'Subtitle Toolbox export' } = {}) {
  const header = [
    '[Script Info]',
    `Title: ${title}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'PlayResX: 1280',
    'PlayResY: 720',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,40,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = cues.map((c) => `Dialogue: 0,${formatTime(c.start, 'ass')},${formatTime(c.end, 'ass')},Default,,0,0,0,,${c.text.replace(/\n/g, '\\N')}`);
  return header.concat(events).join('\n') + '\n';
}

export function serialize(cues, kind) {
  if (kind === 'vtt') return toVtt(cues);
  if (kind === 'ass') return toAss(cues);
  return toSrt(cues);
}

// ------------------------------------------------------------------ timing

export function shiftCues(cues, deltaMs) {
  return cues.map((c) => ({ ...c, start: c.start + deltaMs, end: c.end + deltaMs }));
}

// Linear re-timing: two anchor pairs (fromA -> toA, fromB -> toB) define the
// map; a single pair is a plain shift. Covers frame-rate mismatches
// (23.976 vs 25 fps) and "different cut" drift alike.
export function retimeCues(cues, fromA, toA, fromB, toB) {
  if (fromB == null || toB == null || fromB === fromA) return shiftCues(cues, toA - fromA);
  const scale = (toB - toA) / (fromB - fromA);
  const map = (t) => toA + (t - fromA) * scale;
  return cues.map((c) => ({ ...c, start: map(c.start), end: map(c.end) }));
}

export function scaleByFps(cues, fromFps, toFps) {
  const scale = fromFps / toFps;
  return cues.map((c) => ({ ...c, start: c.start * scale, end: c.end * scale }));
}

// ---------------------------------------------------------------- encoding

const SCRIPT_RANGES = {
  hebrew: /[\u0590-\u05FF]/g,
  arabic: /[\u0600-\u06FF\u0750-\u077F]/g,
  cyrillic: /[\u0400-\u04FF]/g,
  greek: /[\u0370-\u03FF]/g,
  latin: /[A-Za-z\u00C0-\u024F]/g,
  cjk: /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g,
  thai: /[\u0E00-\u0E7F]/g,
};

export const ENCODINGS = [
  { label: 'UTF-8', value: 'utf-8' },
  { label: 'Hebrew (windows-1255)', value: 'windows-1255' },
  { label: 'Hebrew (ISO-8859-8)', value: 'iso-8859-8' },
  { label: 'Arabic (windows-1256)', value: 'windows-1256' },
  { label: 'Arabic (ISO-8859-6)', value: 'iso-8859-6' },
  { label: 'Cyrillic (windows-1251)', value: 'windows-1251' },
  { label: 'Cyrillic (KOI8-R)', value: 'koi8-r' },
  { label: 'Greek (windows-1253)', value: 'windows-1253' },
  { label: 'Turkish (windows-1254)', value: 'windows-1254' },
  { label: 'Central European (windows-1250)', value: 'windows-1250' },
  { label: 'Western European (windows-1252)', value: 'windows-1252' },
  { label: 'Baltic (windows-1257)', value: 'windows-1257' },
  { label: 'Vietnamese (windows-1258)', value: 'windows-1258' },
  { label: 'Thai (windows-874)', value: 'windows-874' },
  { label: 'Chinese Simplified (GBK)', value: 'gbk' },
  { label: 'Chinese Traditional (Big5)', value: 'big5' },
  { label: 'Japanese (Shift_JIS)', value: 'shift_jis' },
  { label: 'Korean (EUC-KR)', value: 'euc-kr' },
  { label: 'UTF-16 LE', value: 'utf-16le' },
  { label: 'UTF-16 BE', value: 'utf-16be' },
];

function decode(bytes, encoding, fatal = false) {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes);
  } catch (e) {
    return null;
  }
}

// Every legacy code page turns the same high bytes into "letters" of its own
// alphabet, so counting letters cannot tell Hebrew from Cyrillic. Very common
// words can: a real Hebrew file is full of את/של/לא, a Russian one of и/в/не.
const COMMON_WORDS = {
  hebrew: ['את', 'של', 'לא', 'אני', 'זה', 'מה', 'הוא', 'היא', 'על', 'אתה', 'אם', 'כן', 'יש', 'אבל', 'עם', 'טוב', 'רק', 'גם', 'הם', 'אנחנו'],
  arabic: ['في', 'من', 'على', 'أن', 'لا', 'هذا', 'ما', 'أنا', 'هل', 'إلى', 'كان', 'لم', 'نعم', 'هذه', 'أنت', 'ماذا', 'لقد', 'كل', 'عن', 'الذي'],
  cyrillic: ['и', 'в', 'не', 'на', 'что', 'я', 'он', 'это', 'ты', 'как', 'но', 'мы', 'да', 'с', 'а', 'то', 'все', 'так', 'у', 'за'],
  greek: ['και', 'να', 'το', 'είναι', 'δεν', 'που', 'με', 'σε', 'για', 'τι', 'θα', 'μου', 'σου', 'ο', 'η', 'τα', 'της', 'του', 'εγώ', 'εσύ'],
  thai: ['ไม่', 'ที่', 'ฉัน', 'คุณ', 'และ', 'เป็น', 'ได้', 'มี', 'จะ', 'นี้'],
  latin: ['the', 'and', 'you', 'that', 'de', 'que', 'la', 'el', 'und', 'die', 'ist', 'le', 'les', 'est', 'não', 'você', 've', 'bir', 'için', 'nie', 'jest', 'och', 'att', 'är', 'het', 'een'],
};
// Replacement characters and C1 control garbage count heavily against.
function scoreText(text) {
  const bad = (text.match(/[\uFFFD\u0080-\u009F]/g) || []).length;
  let best = 0;
  let script = 'latin';
  for (const [name, re] of Object.entries(SCRIPT_RANGES)) {
    const n = (text.match(re) || []).length;
    if (name !== 'latin' && n > best) { best = n; script = name; }
  }
  const latin = (text.match(SCRIPT_RANGES.latin) || []).length;
  if (best === 0) { best = latin; script = 'latin'; }
  const words = text.toLowerCase().split(/[^\p{L}']+/u);
  const common = new Set(COMMON_WORDS[script] || []);
  let hits = 0;
  for (const w of words) if (common.has(w)) hits += 1;
  return { score: best + hits * 40 - bad * 25, script, bad, hits };
}

// Try every candidate encoding and rank by how much readable script comes
// out. UTF-8 that round-trips byte-exactly wins outright: a real UTF-8 file
// can never look better under a legacy codepage.
export function detectEncoding(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return { encoding: 'utf-16le', confidence: 'bom', candidates: [] };
  if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return { encoding: 'utf-16be', confidence: 'bom', candidates: [] };
  const strictUtf8 = decode(u8, 'utf-8', true);
  if (strictUtf8 !== null) return { encoding: 'utf-8', confidence: 'exact', candidates: [] };
  const candidates = [];
  for (const enc of ENCODINGS) {
    if (enc.value.startsWith('utf-')) continue;
    const text = decode(u8, enc.value);
    if (text === null) continue;
    const s = scoreText(text);
    candidates.push({ encoding: enc.value, label: enc.label, score: s.score, script: s.script, bad: s.bad, text });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  // Two code pages that decode this file to the very same text (windows-1255
  // vs ISO-8859-8 for plain Hebrew, say) are one candidate, not a tie.
  const second = candidates.find((c) => c !== top && c.text !== top.text);
  const confidence = !top ? 'none' : (!second || top.score > second.score * 1.3) ? 'high' : 'low';
  for (const c of candidates) delete c.text;
  return { encoding: top ? top.encoding : 'windows-1252', confidence, candidates: candidates.slice(0, 5) };
}

export function decodeBytes(bytes, encoding) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = decode(u8, encoding) ?? decode(u8, 'utf-8');
  return text.replace(/^\uFEFF/, '');
}

// "Double-encoded" mojibake: UTF-8 bytes that were once decoded as a legacy
// codepage and saved back as UTF-8 (e.g. "×©×œ×•×" for Hebrew). Re-encode the
// text with the legacy codepage and decode as UTF-8; accept only if the
// result is strictly valid UTF-8 and scores better.
const LATIN1_LIKE = ['windows-1252', 'windows-1255', 'windows-1256', 'windows-1251', 'iso-8859-1'];
export function repairDoubleEncoding(text) {
  const before = scoreText(text);
  let best = { text, gain: 0, via: null };
  for (const enc of LATIN1_LIKE) {
    const bytes = encodeLegacy(text, enc);
    if (!bytes) continue;
    const decoded = decode(bytes, 'utf-8', true);
    if (decoded === null) continue;
    const after = scoreText(decoded);
    const gain = after.score - before.score;
    if (gain > best.gain) best = { text: decoded, gain, via: enc };
  }
  return best;
}

// Minimal encoders for the single-byte codepages used above (TextEncoder is
// UTF-8 only). Built lazily by decoding every byte once.
const encoderTables = {};
function encodeLegacy(text, enc) {
  if (!encoderTables[enc]) {
    const table = new Map();
    for (let b = 0; b < 256; b++) {
      const ch = decode(new Uint8Array([b]), enc);
      if (ch && ch.length === 1 && !table.has(ch)) table.set(ch, b);
    }
    encoderTables[enc] = table;
  }
  const table = encoderTables[enc];
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) {
    const b = table.get(ch);
    if (b === undefined) {
      if (ch.charCodeAt(0) < 128) { out[n++] = ch.charCodeAt(0); continue; }
      return null;
    }
    out[n++] = b;
  }
  return out.subarray(0, n);
}

export function encodeUtf8(text, { bom = false } = {}) {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xEF, 0xBB, 0xBF], 0);
  out.set(body, 3);
  return out;
}

// --------------------------------------------------------------------- RTL

const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F]/;
const RLM = '\u200F';

// A line that starts or ends with neutral punctuation renders it on the
// wrong side in most players when the line is RTL. Wrapping each RTL line
// in RIGHT-TO-LEFT MARKs pins the punctuation to the reading direction.
export function fixRtlPunctuation(cues) {
  let touched = 0;
  const out = cues.map((c) => {
    const lines = c.text.split('\n').map((line) => {
      if (!RTL_RE.test(line)) return line;
      const bare = line.replace(new RegExp(`^${RLM}+|${RLM}+$`, 'g'), '');
      if (!/^[\s"'“”‘’(\[\-–—.!?,:;…]|[\s"'“”‘’)\]\-–—.!?,:;…]$/.test(bare)) return line;
      touched += 1;
      return RLM + bare + RLM;
    });
    return { ...c, text: lines.join('\n') };
  });
  return { cues: out, touched };
}

// Text stored in visual order (every word reversed) is a known artifact of
// old Hebrew subtitle tools. Detect by final-form letters at word START.
export function looksReversedHebrew(cues) {
  const text = cues.map((c) => c.text).join(' ');
  const finals = (text.match(/(?:^|\s)[ךםןףץ]/g) || []).length;
  const words = (text.match(/[֐-׿]+/g) || []).length;
  return words >= 20 && finals / words > 0.08;
}

export function reverseHebrewWords(cues) {
  return cues.map((c) => ({
    ...c,
    text: c.text.split('\n').map((line) => (RTL_RE.test(line) ? line.split(/(\s+)/).map((tok) => (/^\s+$/.test(tok) ? tok : [...tok].reverse().join(''))).reverse().join('') : line)).join('\n'),
  }));
}

// -------------------------------------------------------------------- lint

export const LINT_DEFAULTS = { maxCps: 20, maxLineChars: 42, maxLines: 2, minDurationMs: 700, maxDurationMs: 7000, minGapMs: 40 };

export function lintCues(cues, opts = {}) {
  const o = { ...LINT_DEFAULTS, ...opts };
  const issues = [];
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const dur = c.end - c.start;
    const text = c.text.replace(/<[^>]+>/g, '');
    const lines = text.split('\n');
    const chars = text.replace(/\s+/g, ' ').length;
    const push = (level, code, msg) => issues.push({ level, code, cue: c.index, start: c.start, msg });
    if (!text.trim()) push('warn', 'empty', 'Empty cue');
    if (dur <= 0) push('error', 'negative', 'End is not after start');
    else {
      if (dur < o.minDurationMs) push('warn', 'short', `Only ${dur} ms on screen`);
      if (dur > o.maxDurationMs) push('warn', 'long', `${(dur / 1000).toFixed(1)} s on screen`);
      const cps = chars / (dur / 1000);
      if (chars && cps > o.maxCps) push(cps > o.maxCps * 1.3 ? 'error' : 'warn', 'cps', `${cps.toFixed(1)} characters per second`);
    }
    if (lines.length > o.maxLines) push('warn', 'lines', `${lines.length} lines`);
    for (const l of lines) if (l.length > o.maxLineChars) push('warn', 'linelen', `Line has ${l.length} characters`);
    const next = sorted[i + 1];
    if (next) {
      if (next.start < c.end) push('error', 'overlap', `Overlaps cue ${next.index} by ${c.end - next.start} ms`);
      else if (next.start - c.end < o.minGapMs) push('info', 'gap', `Only ${next.start - c.end} ms before cue ${next.index}`);
    }
    if (/\uFFFD/.test(text)) push('error', 'garbage', 'Contains replacement characters (broken encoding)');
  }
  const summary = { errors: issues.filter((i) => i.level === 'error').length, warnings: issues.filter((i) => i.level === 'warn').length, infos: issues.filter((i) => i.level === 'info').length };
  return { issues, summary };
}

export function stats(cues) {
  if (!cues.length) return { count: 0 };
  const scripts = {};
  for (const c of cues) {
    const s = scoreText(c.text).script;
    scripts[s] = (scripts[s] || 0) + 1;
  }
  const dominant = Object.entries(scripts).sort((a, b) => b[1] - a[1])[0][0];
  return { count: cues.length, first: cues[0].start, last: cues[cues.length - 1].end, script: dominant, rtl: dominant === 'hebrew' || dominant === 'arabic' };
}
