import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseSrt, parseVtt, parseAss, parseAny, toSrt, toVtt, toAss, formatTime, parseTime,
  shiftCues, retimeCues, scaleByFps, detectEncoding, decodeBytes, repairDoubleEncoding, encodeUtf8,
  fixRtlPunctuation, looksReversedHebrew, reverseHebrewWords, lintCues, stats,
} from '../toolbox-core.js';

const SRT = `1\n00:00:01,000 --> 00:00:02,500\nHello there.\n\n2\n00:00:03,000 --> 00:00:04,000\n- Yes.\n- No.\n`;

test('parse + serialize SRT round-trips', () => {
  const cues = parseSrt(SRT);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1000);
  assert.equal(cues[0].end, 2500);
  assert.equal(cues[1].text, '- Yes.\n- No.');
  assert.equal(toSrt(cues), SRT);
});

test('SRT with CRLF, missing indices and 2-digit millis still parses', () => {
  const cues = parseSrt('00:00:01,50 --> 00:00:02,000\r\nA\r\n\r\n7\r\n00:00:03,000 --> 00:00:04,000\r\nB\r\n');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1500);
  assert.equal(cues[1].index, 2);
});

test('VTT parses with hours optional and tags stripped', () => {
  const cues = parseVtt('WEBVTT\n\nNOTE x\n\n00:01.000 --> 00:02.000\n<v Bob>Hi <b>there</b>\n\n01:00:00.000 --> 01:00:01.000 line:0\nLate\n');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Hi there');
  assert.equal(cues[1].start, 3600000);
  assert.ok(toVtt(cues).startsWith('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n'));
});

test('ASS parses Dialogue lines, strips override tags, exports back', () => {
  const ass = '[Script Info]\nTitle: t\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\an8}Hello,\\Nworld\nDialogue: 0,0:00:00.10,0:00:00.90,Default,,0,0,0,,First\n';
  const cues = parseAss(ass);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'First');
  assert.equal(cues[1].text, 'Hello,\nworld');
  assert.equal(cues[1].start, 1000);
  const out = toAss(cues);
  assert.ok(out.includes('Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Hello,\\Nworld'));
  assert.equal(parseAny(ass).kind, 'ass');
});

test('time formatting', () => {
  assert.equal(formatTime(3723456), '01:02:03,456');
  assert.equal(formatTime(3723456, 'vtt'), '01:02:03.456');
  assert.equal(formatTime(3723456, 'ass'), '1:02:03.45');
  assert.equal(parseTime('01:02:03,456'), 3723456);
  assert.equal(formatTime(-500), '00:00:00,000');
});

test('shift, two-point retime and fps scale', () => {
  const cues = parseSrt(SRT);
  assert.equal(shiftCues(cues, -400)[0].start, 600);
  const re = retimeCues(cues, 1000, 2000, 3000, 6000);
  assert.equal(re[0].start, 2000);
  assert.equal(re[1].start, 6000);
  assert.equal(re[1].end, 8000);
  const sc = scaleByFps(cues, 25, 23.976);
  assert.ok(Math.abs(sc[0].start - 1042.7) < 1);
});

test('encoding: strict UTF-8 wins, Hebrew cp1255 detected, double-encoding repaired', () => {
  const heb = 'שלום עולם, זה מבחן של כתוביות בעברית עם הרבה מילים כדי שהזיהוי יעבוד';
  assert.equal(detectEncoding(new TextEncoder().encode(heb)).encoding, 'utf-8');
  // Build windows-1255 bytes by hand: Hebrew letters are 0xE0-0xFA.
  const cp1255 = new Uint8Array([...heb].map((ch) => (ch >= 'א' && ch <= 'ת' ? 0xE0 + (ch.charCodeAt(0) - 0x5D0) : ch.charCodeAt(0))));
  const det = detectEncoding(cp1255);
  assert.equal(det.encoding, 'windows-1255');
  assert.equal(decodeBytes(cp1255, det.encoding), heb);
  const mojibake = new TextDecoder('windows-1252').decode(new TextEncoder().encode(heb));
  const fixed = repairDoubleEncoding(mojibake);
  assert.equal(fixed.text, heb);
  assert.equal(fixed.via, 'windows-1252');
  assert.deepEqual([...encodeUtf8('a', { bom: true }).slice(0, 3)], [0xEF, 0xBB, 0xBF]);
});

test('RTL punctuation fix wraps only RTL lines with edge punctuation', () => {
  const cues = [{ index: 1, start: 0, end: 1000, text: 'מה קורה?\nHello?' }];
  const { cues: out, touched } = fixRtlPunctuation(cues);
  assert.equal(touched, 1);
  assert.equal(out[0].text, '‏מה קורה?‏\nHello?');
  assert.equal(fixRtlPunctuation(out).touched, 1); // idempotent: re-wrapping strips first
  assert.equal(fixRtlPunctuation(out).cues[0].text, out[0].text);
});

test('reversed Hebrew detection and repair', () => {
  const good = Array.from({ length: 25 }, (_, i) => ({ index: i + 1, start: i * 1000, end: i * 1000 + 900, text: 'שלום לכולם היום' }));
  assert.equal(looksReversedHebrew(good), false);
  const bad = reverseHebrewWords(good);
  assert.equal(bad[0].text, 'םויה םלוכל םולש');
  assert.equal(looksReversedHebrew(bad), true);
  assert.equal(reverseHebrewWords(bad)[0].text, 'שלום לכולם היום');
});

test('lint finds overlap, cps, long lines, empty and garbage', () => {
  const cues = [
    { index: 1, start: 0, end: 500, text: 'This is a very long line that definitely exceeds forty two characters' },
    { index: 2, start: 400, end: 1200, text: '' },
    { index: 3, start: 2000, end: 1000, text: '���' },
  ];
  const { issues, summary } = lintCues(cues);
  const codes = issues.map((i) => i.code);
  for (const c of ['overlap', 'cps', 'linelen', 'empty', 'negative', 'garbage', 'short']) assert.ok(codes.includes(c), c);
  assert.ok(summary.errors >= 3);
});
