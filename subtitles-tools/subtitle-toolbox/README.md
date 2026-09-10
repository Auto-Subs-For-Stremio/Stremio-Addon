# Subtitle Toolbox

Fix, retime, convert and check subtitle files — entirely in your browser. Nothing is uploaded; every tool runs on your own machine.

Part of [Auto-Subs](https://auto-subs.com/)' contribution back to the subtitle and translation community: the everyday fixes we built for ourselves, free for everyone.

**Open it: https://auto-subs-for-stremio.github.io/Stremio-Addon/subtitles-tools/subtitle-toolbox/**

Drop an `.srt`, `.vtt` or `.ass`/`.ssa` file and pick a tab.

## What it does

| Tab | What you get |
|---|---|
| **Fix encoding** | Subtitles that show as boxes, question marks or `×©×œ×•×` were saved in a legacy code page (windows-1255 Hebrew, windows-1256 Arabic, windows-1251 Cyrillic, windows-1253 Greek, and more) or decoded twice. The toolbox detects the code page using script and common-word statistics, shows you the candidates side by side, repairs double-encoded text, and saves clean UTF-8 (BOM optional for older players). |
| **Shift / retime** | Subtitles that are early or late by a fixed amount: shift by milliseconds. Subtitles that drift more and more through the film (different cut or frame rate): give two anchor points, or convert 23.976 ↔ 25 ↔ 29.97 fps. |
| **Convert** | SRT ↔ WebVTT ↔ ASS/SSA. Anime `.ass` files become plain SRT that every player and Stremio read; styling and positioning tags are dropped, text and timing are kept. |
| **Hebrew / Arabic** | Punctuation showing at the wrong end of right-to-left lines (`?מה קורה`) is fixed by pinning each RTL line with direction marks that players honor. Files stored in visual order (every word spelled backwards, a legacy of old tools) can be flipped back. |
| **Check quality** | Overlapping cues, cues too short to read, reading speed above 20 characters per second, lines over 42 characters, more than two lines, empty cues, and leftover encoding garbage. |

## Files

```
subtitle-toolbox/
├── index.html        the page (static, no build step)
├── app.js            page logic
├── toolbox-core.js   the library: parsers, encoding detection, timing, RTL, lint
├── test/             node --test
└── package.json
```

`toolbox-core.js` is a dependency-free ES module you can use on its own, in the browser or in Node 18+:

```js
import { parseAny, detectEncoding, decodeBytes, shiftCues, toSrt, lintCues } from './toolbox-core.js';

const bytes = new Uint8Array(await file.arrayBuffer());
const { encoding } = detectEncoding(bytes);           // 'windows-1255', 'utf-8', …
const { cues } = parseAny(decodeBytes(bytes, encoding));
const fixed = shiftCues(cues, -1500);                  // 1.5 s earlier
console.log(lintCues(fixed).summary);                  // { errors, warnings, infos }
download(toSrt(fixed));
```

## Run locally

```sh
cd subtitles-tools/subtitle-toolbox
npm test                      # unit tests
python3 -m http.server 8000   # then open http://localhost:8000/
```

Any static file server works; the page loads `app.js` as an ES module, so it has to be served over HTTP rather than opened from `file://`.

## Contributing

Bug reports and pull requests are welcome in this repository's issues. Useful contributions: more code pages and common-word lists for encoding detection, additional subtitle formats, and real-world files that the tools get wrong.

MIT licensed, by [Auto-Subs](https://auto-subs.com/).
