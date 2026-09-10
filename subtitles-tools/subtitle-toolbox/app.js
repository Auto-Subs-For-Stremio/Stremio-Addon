// Subtitle Toolbox — page logic. All work happens in this tab; no network.
import {
  ENCODINGS, detectEncoding, decodeBytes, repairDoubleEncoding, encodeUtf8,
  parseAny, serialize, toSrt, formatTime, parseTime,
  shiftCues, retimeCues, scaleByFps,
  fixRtlPunctuation, looksReversedHebrew, reverseHebrewWords,
  lintCues, stats,
} from './toolbox-core.js';

const $ = (id) => document.getElementById(id);
const state = { name: '', bytes: null, encoding: 'utf-8', text: '', kind: 'srt', cues: [], timed: [], rtl: [] };

// ---------- file intake ----------
const drop = $('drop');
const fileInput = $('file');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

async function loadFile(file) {
  state.name = file.name;
  state.bytes = new Uint8Array(await file.arrayBuffer());
  const det = detectEncoding(state.bytes);
  state.encoding = det.encoding;
  state.detection = det;
  applyEncoding(det.encoding);
  const enable = state.cues.length > 0;
  document.querySelectorAll('#tabs button').forEach((b) => { b.disabled = !enable; });
  renderMeta();
  renderEncodingPanel();
  if (enable) activate(state.detection.confidence === 'exact' ? (stats(state.cues).rtl ? 'rtl' : 'timing') : 'encoding');
}

function applyEncoding(enc) {
  state.encoding = enc;
  state.text = decodeBytes(state.bytes, enc);
  const parsed = parseAny(state.text);
  state.kind = parsed.kind;
  state.cues = parsed.cues;
  state.timed = parsed.cues;
    state.rtl = parsed.cues;
}

function renderMeta() {
  const s = stats(state.cues);
  const m = $('meta');
  m.hidden = false;
  const conf = state.detection.confidence;
  const encLabel = (ENCODINGS.find((e) => e.value === state.encoding) || {}).label || state.encoding;
  m.innerHTML = `<span>file <b>${esc(state.name)}</b></span><span>format <b>${state.kind.toUpperCase()}</b></span><span>cues <b>${s.count || 0}</b></span>` +
    (s.count ? `<span>runs <b>${formatTime(s.first).slice(0, 8)} → ${formatTime(s.last).slice(0, 8)}</b></span><span>script <b>${s.script}</b></span>` : '') +
    `<span>encoding <b>${esc(encLabel)}</b> <span class="note">(${conf === 'exact' ? 'valid UTF-8' : conf === 'bom' ? 'byte-order mark' : conf + ' confidence guess'})</span></span>`;
  if (!s.count) setStatus('encStatus', 'No cues could be parsed from this file. Is it SRT, VTT or ASS?', 'err');
}

// ---------- tabs ----------
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));
function activate(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tab));
  if (tab === 'encoding') renderEncodingPanel();
  if (tab === 'timing') { state.timed = state.cues; showPreview('timePreview', state.timed); setStatus('timeStatus', ''); }
  if (tab === 'convert') renderConvert();
  if (tab === 'rtl') renderRtl();
  if (tab === 'check') renderCheck();
}

// ---------- encoding panel ----------
const encSel = $('encSel');
for (const e of ENCODINGS) { const o = document.createElement('option'); o.value = e.value; o.textContent = e.label; encSel.appendChild(o); }
encSel.addEventListener('change', () => { applyEncoding(encSel.value); renderMeta(); renderEncodingPanel(false); });

function renderEncodingPanel(rebuildCandidates = true) {
  encSel.value = state.encoding;
  if (rebuildCandidates) {
    const box = $('cands');
    box.innerHTML = '';
    const det = state.detection;
    const list = det.confidence === 'exact' || det.confidence === 'bom' ? [{ encoding: det.encoding, label: det.encoding === 'utf-8' ? 'UTF-8 (file is already valid)' : det.encoding }] : det.candidates;
    for (const c of list) {
      const d = document.createElement('div');
      d.className = 'cand' + (c.encoding === state.encoding ? ' sel' : '');
      const sample = sampleText(decodeBytes(state.bytes, c.encoding));
      d.innerHTML = `<div class="n">${esc(c.label || c.encoding)}</div><div class="s${/[֐-ۿ]/.test(sample) ? ' rtl' : ''}">${esc(sample)}</div>`;
      d.addEventListener('click', () => { applyEncoding(c.encoding); renderMeta(); renderEncodingPanel(); });
      box.appendChild(d);
    }
  }
  showPreview('encPreview', state.cues);
  const det = state.detection;
  setStatus('encStatus', det.confidence === 'exact' ? 'This file is valid UTF-8 already. If it still looks wrong, try the double-encoding repair.' : det.confidence === 'high' ? `Detected ${state.encoding} with high confidence.` : 'Several encodings look plausible. Pick the one that reads correctly.', det.confidence === 'low' ? 'warn' : 'ok');
}

$('btnRepairDouble').addEventListener('click', () => {
  const r = repairDoubleEncoding(state.text);
  if (!r.via) { setStatus('encStatus', 'No double-encoding pattern found in this text.', 'warn'); return; }
  state.text = r.text;
  const parsed = parseAny(state.text);
  state.cues = parsed.cues; state.timed = parsed.cues; state.rtl = parsed.cues; state.kind = parsed.kind;
  renderMeta();
  showPreview('encPreview', state.cues);
  setStatus('encStatus', `Repaired: the text had been decoded as ${r.via} and re-saved. Now genuine UTF-8.`, 'ok');
});
$('dlEnc').addEventListener('click', () => download(serialize(state.cues, state.kind), state.kind, { bom: $('bom').checked }));

// ---------- timing ----------
$('btnShift').addEventListener('click', () => {
  const ms = Number($('shiftMs').value) || 0;
  state.timed = shiftCues(state.timed, ms);
  showPreview('timePreview', state.timed);
  setStatus('timeStatus', `Shifted by ${ms > 0 ? '+' : ''}${ms} ms (cumulative from original: ${state.timed[0].start - state.cues[0].start} ms on the first cue).`, 'ok');
});
$('btnRetime').addEventListener('click', () => {
  const fa = parseTime($('fromA').value), ta = parseTime($('toA').value), fb = parseTime($('fromB').value), tb = parseTime($('toB').value);
  if (fa == null || ta == null) { setStatus('timeStatus', 'Enter at least the first pair as hh:mm:ss,ms.', 'err'); return; }
  state.timed = retimeCues(state.timed, fa, ta, fb, tb);
  showPreview('timePreview', state.timed);
  setStatus('timeStatus', fb == null || tb == null ? 'Applied as a plain shift (one anchor).' : `Applied linear retime, scale ${(((tb - ta) / (fb - fa))).toFixed(5)}.`, 'ok');
});
$('btnFps').addEventListener('click', () => {
  const from = Number($('fpsFrom').value), to = Number($('fpsTo').value);
  state.timed = scaleByFps(state.timed, from, to);
  showPreview('timePreview', state.timed);
  setStatus('timeStatus', `Scaled ${from} → ${to} fps (factor ${(from / to).toFixed(5)}).`, 'ok');
});
$('btnResetTiming').addEventListener('click', () => { state.timed = state.cues; showPreview('timePreview', state.timed); setStatus('timeStatus', 'Back to the original timing.', 'ok'); });
$('dlTime').addEventListener('click', () => download(serialize(state.timed, state.kind), state.kind));

// ---------- convert ----------
$('fmtSel').addEventListener('change', renderConvert);
function renderConvert() {
  const kind = $('fmtSel').value;
  const out = serialize(state.cues, kind);
  $('convPreview').textContent = out.slice(0, 4000);
  setStatus('convStatus', `${state.kind.toUpperCase()} → ${kind.toUpperCase()}, ${state.cues.length} cues.` + (state.kind === 'ass' && kind !== 'ass' ? ' Styling, positions and karaoke tags are dropped; text and timing are kept.' : ''), 'ok');
}
$('dlConv').addEventListener('click', () => { const kind = $('fmtSel').value; download(serialize(state.cues, kind), kind); });

// ---------- rtl ----------
function renderRtl() {
  state.rtl = state.cues;
  showPreview('rtlPreview', state.rtl);
  const s = stats(state.cues);
  if (!s.rtl) setStatus('rtlStatus', `This file reads as ${s.script}; these fixes only touch Hebrew and Arabic lines.`, 'warn');
  else if (looksReversedHebrew(state.cues)) setStatus('rtlStatus', 'Words look reversed (final-form letters at word start). Try "Un-reverse words".', 'warn');
  else setStatus('rtlStatus', '', 'ok');
}
$('btnRtlPunct').addEventListener('click', () => {
  const r = fixRtlPunctuation(state.rtl);
  state.rtl = r.cues;
  showPreview('rtlPreview', state.rtl);
  setStatus('rtlStatus', `${r.touched} line(s) pinned with right-to-left marks.`, 'ok');
});
$('btnReverse').addEventListener('click', () => {
  state.rtl = reverseHebrewWords(state.rtl);
  showPreview('rtlPreview', state.rtl);
  setStatus('rtlStatus', looksReversedHebrew(state.rtl) ? 'Still looks reversed — the file may mix orders; check the preview.' : 'Words flipped back to logical order.', 'ok');
});
$('dlRtl').addEventListener('click', () => download(serialize(state.rtl, state.kind), state.kind));

// ---------- check ----------
function renderCheck() {
  const { issues, summary } = lintCues(state.cues);
  $('checkChips').innerHTML = `<span class="chip">${state.cues.length} cues</span><span class="chip lvl-error">${summary.errors} errors</span><span class="chip lvl-warn">${summary.warnings} warnings</span><span class="chip lvl-info">${summary.infos} notes</span>`;
  if (!issues.length) { $('lintTable').innerHTML = '<p class="note">No issues found.</p>'; return; }
  const rows = issues.slice(0, 400).map((i) => `<tr><td class="lvl-${i.level}">${i.level}</td><td>${i.cue}</td><td>${formatTime(i.start)}</td><td>${esc(i.msg)}</td></tr>`).join('');
  $('lintTable').innerHTML = `<table class="lint"><thead><tr><th>Level</th><th>Cue</th><th>At</th><th>Issue</th></tr></thead><tbody>${rows}</tbody></table>` + (issues.length > 400 ? `<p class="note">Showing the first 400 of ${issues.length}.</p>` : '');
}

// ---------- helpers ----------
function showPreview(id, cues) {
  const el = $(id);
  el.classList.toggle('rtl', stats(cues).rtl === true);
  el.textContent = toSrt(cues.slice(0, 12)) + (cues.length > 12 ? `\n… ${cues.length - 12} more cues` : '');
}
function sampleText(text) {
  const parsed = parseAny(text);
  const lines = parsed.cues.slice(0, 6).map((c) => c.text.replace(/\n/g, ' ')).join(' | ');
  return lines || text.slice(0, 120);
}
function setStatus(id, msg, level) { const el = $(id); el.textContent = msg; el.className = 'status ' + (level || ''); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function download(text, kind, { bom = false } = {}) {
  const base = state.name.replace(/\.[^.]+$/, '') || 'subtitle';
  const bytes = encodeUtf8(text, { bom });
  const blob = new Blob([bytes], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${base}.fixed.${kind}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
