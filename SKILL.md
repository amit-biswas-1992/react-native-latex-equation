---
name: react-native-latex-math
description: Use when rendering inline LaTeX math (`$...$` or `$$...$$`) inside React Native / Expo Text components, especially when math is mixed with regular text mid-sentence. Triggers include — math expressions showing as raw text in the app, KaTeX/MathJax integration questions, exam apps with chemistry/physics formulas, "how do I render LaTeX in React Native", inline equations in Bengali/Arabic/Chinese question text, dollar-sign math delimiters appearing literal in mobile UI but rendering correctly on the web frontend.
---

# Rendering LaTeX Math in React Native (KaTeX in a WebView)

## TL;DR — the pattern that actually works

Build a `<MathText>` component that takes `value: string`. Inside:

1. **Fast path**: if the string has no `$`, return a plain RN `<Text>`. Zero WebView cost for plain content.
2. **Slow path**: render the entire string in **one** small `<WebView>` containing `<head>`-loaded KaTeX + `auto-render.min.js`. The body is the original string with HTML-escape applied **outside** the `$...$` math segments. KaTeX auto-render scans the body and replaces `$...$` inline. HTML's natural flow handles mid-sentence wrapping.
3. **Height sync**: WebView body posts `document.body.scrollHeight` back via `postMessage`; RN updates the WebView height from state.
4. **Critical script ordering**: define `renderAndReport()` in an inline `<script>` BEFORE the external `<script src="...auto-render.min.js" onload="renderAndReport()">` tag. Otherwise `onload` fires while `renderAndReport` is still `undefined`, KaTeX never runs, and you get raw `$...$` text in the WebView.

This pattern handles inline math (`Find x where $x^2=4$`), block math (`$$\sum_{i=1}^n i$$`), and Bengali/Arabic/Chinese text mixed with formulas — all with one small dependency surface (just `react-native-webview`, which Expo already ships).

## When to use which approach

| Approach | Pros | Cons | Pick when |
|---|---|---|---|
| **WebView + KaTeX** (this skill) | Pixel-perfect parity with web KaTeX. Inline mid-text wrapping. Handles every LaTeX feature. ~50 LoC. No new packages. | One WebView per node with math. Cold-start ~150–300 ms per equation. CDN load on first equation. | Most cases. The fast-path bypass keeps plain-text questions free. |
| `react-native-mathjax-svg` (or similar SVG-based) | No WebView. Inline-renderable as a View. | Slower first-paint while MathJax JS loads. Some KaTeX features (chem, certain macros) missing. | Math-heavy lists where 30+ WebViews would jank. |
| `react-native-katex` (per-equation WebView component) | Convenient API. | Per-equation only — can't do mid-sentence inline mixing with surrounding text. | Standalone equations as a whole row, never mid-text. |
| Strip `$...$` and replace with Unicode super/subscript | No deps, instant. | Only works for trivial `^{2}` / `_{n}` patterns. Breaks on fractions, integrals, anything else. | Quick fix while you decide. |

## The component (copy-paste reference, validated 2026-05-07)

This is the production version with a dev `console.log` channel (kept dormant in prod). Drop in `src/components/MathText.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { Platform, Text, type TextStyle } from 'react-native';
import WebView from 'react-native-webview';

interface MathTextProps {
  value: string | undefined | null;
  style?: TextStyle;
  /** Defaults to style.color (or #0f172a). KaTeX renders math as text, so this keeps it consistent. */
  mathColor?: string;
}

export default function MathText({ value, style, mathColor }: MathTextProps) {
  const text = value ?? '';
  // Fast path: no math markers → plain RN <Text>. Zero WebView cost.
  if (!text.includes('$')) {
    return <Text style={style}>{text}</Text>;
  }
  return <WebViewMath text={text} style={style} mathColor={mathColor} />;
}

function WebViewMath({
  text, style, mathColor,
}: { text: string; style?: TextStyle; mathColor?: string }) {
  const [height, setHeight] = useState<number>(24);

  const fontSize = (style?.fontSize as number | undefined) ?? 14;
  const lineHeight = (style?.lineHeight as number | undefined) ?? Math.round(fontSize * 1.5);
  const color = mathColor ?? (style?.color as string | undefined) ?? '#0f172a';
  const fontWeight = String(style?.fontWeight ?? '400');
  const fontFamily =
    (style?.fontFamily as string | undefined) ??
    (Platform.OS === 'android' ? 'sans-serif' : 'System');

  const html = useMemo(
    () => buildHtml({ text, fontSize, lineHeight, color, fontWeight, fontFamily }),
    [text, fontSize, lineHeight, color, fontWeight, fontFamily]
  );

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={{ height, backgroundColor: 'transparent', width: '100%' }}
      scrollEnabled={false}
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="always"
      androidLayerType="hardware"
      automaticallyAdjustContentInsets={false}
      setSupportMultipleWindows={false}
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data) as { height?: number; type?: string };
          if (data.type === 'log') return; // dev-only channel
          if (typeof data.height === 'number' && data.height > 0) {
            setHeight(Math.ceil(data.height) + 2);
          }
        } catch {}
      }}
    />
  );
}

function buildHtml({
  text, fontSize, lineHeight, color, fontWeight, fontFamily,
}: { text: string; fontSize: number; lineHeight: number; color: string; fontWeight: string; fontFamily: string }): string {
  const escaped = escapeOutsideMath(text);
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font-size: ${fontSize}px;
    line-height: ${lineHeight}px;
    color: ${color};
    font-weight: ${fontWeight};
    font-family: ${fontFamily}, system-ui, -apple-system, sans-serif;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }
  .katex { font-size: 1em; }
</style></head>
<body>
<div id="root">${escaped}</div>
<script>
  // CRITICAL: this script must come BEFORE the external scripts below,
  // otherwise the onload="renderAndReport()" fires while renderAndReport is undefined.
  function postHeight() {
    if (window.ReactNativeWebView && document.body) {
      window.ReactNativeWebView.postMessage(JSON.stringify({height: document.body.scrollHeight}));
    }
  }
  function renderAndReport() {
    try {
      if (typeof renderMathInElement !== 'function') {
        // auto-render not loaded yet — retry
        setTimeout(renderAndReport, 50);
        return;
      }
      renderMathInElement(document.getElementById('root'), {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$',  right: '$',  display: false}
        ],
        throwOnError: false,
        errorColor: '#ef4444'
      });
    } catch (e) { /* leave raw on failure */ }
    postHeight();
    setTimeout(postHeight, 80);
    setTimeout(postHeight, 250);
  }
</script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" crossorigin="anonymous"
  onload="renderAndReport()"></script>
</body></html>`;
}

/**
 * HTML-escape characters outside `$...$` and `$$...$$` math segments. Math
 * segments must pass through untouched so KaTeX can parse them. Unmatched `$`
 * is treated as literal text. Without this, user content can HTML-inject.
 */
function escapeOutsideMath(input: string): string {
  let i = 0;
  let out = '';
  while (i < input.length) {
    if (input[i] === '$') {
      const isDisplay = input[i + 1] === '$';
      const open = isDisplay ? '$$' : '$';
      const start = i + open.length;
      let j = start;
      let found = -1;
      while (j < input.length) {
        if (input[j] === '\\' && input[j + 1] === '$') { j += 2; continue; }
        if (isDisplay) {
          if (input[j] === '$' && input[j + 1] === '$') { found = j; break; }
        } else {
          if (input[j] === '$') { found = j; break; }
        }
        j++;
      }
      if (found === -1) {
        out += escapeHtml('$');
        i++;
      } else {
        out += input.slice(i, found + open.length);
        i = found + open.length;
      }
    } else {
      const next = input.indexOf('$', i);
      const end = next === -1 ? input.length : next;
      out += escapeHtml(input.slice(i, end));
      i = end;
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

## Wiring it in

```tsx
// QuestionCard.tsx (or any text component that may contain math)
import MathText from './MathText';

// Before:
// <Text style={styles.questionText}>{question.text}</Text>

// After (inside a <View/> wrapper because MathText returns a WebView when math is present):
<View style={styles.questionTextWrap}>
  <MathText
    value={question.text}
    style={{ fontFamily: 'NotoSerifBengali_500Medium', fontSize: 16, lineHeight: 24, color: '#0f172a', fontWeight: '500' }}
  />
</View>
```

Apply at every text node that may contain `$`:
- Question text
- Each answer option
- Explanation/review text
- Any user-generated content with formulas

## The script ordering bug — read this first if math doesn't render

**Symptom**: WebView mounts, doesn't error, KaTeX CSS is loaded, but the body shows raw `$...$` text. The math never renders.

**Cause**: This pattern (broken):

```html
<!-- BROKEN -->
<script src=".../auto-render.min.js" onload="renderAndReport()"></script>
<script>
  function renderAndReport() { ... }
</script>
```

When the browser parses the first `<script src="..." onload>`, the inline definition of `renderAndReport` hasn't executed yet. When `auto-render.min.js` finishes loading and fires `onload`, it tries to call `renderAndReport()` and gets `ReferenceError`. Browsers swallow this in `onload=` attributes silently, so you see no error in logs.

**Fix**: define `renderAndReport` in an inline `<script>` placed **above** the external KaTeX script tags. The `buildHtml` above already does this — preserve that order if you adapt the code.

**How to debug if you're not sure which problem you have**: temporarily add `rnLog` postMessage calls inside the WebView and surface them in `onMessage`:

```js
function rnLog(msg) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({type: 'log', msg: String(msg)}));
  }
}
window.onerror = (m, s, l) => rnLog('onerror: ' + m + ' @ ' + s + ':' + l);
// In renderAndReport:
rnLog('renderAndReport start, autoRender=' + (typeof renderMathInElement));
```

In RN, `onMessage` reads `{type:'log', msg}` and `console.log`s it. You'll see exactly where it bails.

## Other things that bit us

| Symptom | Cause | Fix |
|---|---|---|
| WebView height stays at 24px (initial); content clipped | postMessage from `postHeight()` never fires, or only fires before fonts settle | Call `postHeight()` 3× — immediately, +80ms, +250ms (KaTeX fonts shift line metrics on async load) |
| Math renders but with wrong color/weight/size | WebView body CSS doesn't match RN style props | Pass `fontSize / lineHeight / color / fontWeight / fontFamily` from RN style → CSS body rule |
| RN font (e.g. NotoSerifBengali) doesn't render in WebView | Custom RN fonts aren't installed in the system WebView | Either accept system font fallback (looks fine for most), OR use a custom font loaded via `<style>@font-face` in HTML head |
| `ScrollView` is laggy with many math nodes | Each WebView is heavy on cold-start | Limit visible WebViews via `windowSize` on FlatList; or switch to SVG-based renderer for >20 inline equations per screen |
| HTML injection from question content | Forgetting to HTML-escape outside math | Use `escapeOutsideMath` (in the reference code). Never `innerHTML = userContent` directly |
| `Cannot read property 'postMessage' of undefined` | `window.ReactNativeWebView` doesn't exist in non-WebView contexts (e.g. running HTML in a normal browser for testing) | Always guard: `if (window.ReactNativeWebView) { ... }` |

## CDN vs bundled KaTeX

The reference code loads KaTeX from `cdn.jsdelivr.net`. **Pros**: zero bundle bloat, always current. **Cons**: requires network on first equation render, breaks fully offline.

To bundle:

1. `npx expo install expo-asset` (if not already a dep)
2. Download `katex.min.css`, `katex.min.js`, `auto-render.min.js`, and the `fonts/` directory from `https://github.com/KaTeX/KaTeX/releases` (~280 KB total).
3. Drop into `assets/katex/`.
4. Add to `app.json`:
   ```json
   "extra": { "assetBundlePatterns": ["**/*"] }
   ```
5. In `buildHtml`, replace the CDN URLs with `Asset.fromModule(require('../../assets/katex/katex.min.css')).uri`.

Worth doing for production exam apps where users may be offline. Don't bother for development iteration.

## Performance notes

- Each WebView mount is **30–80 ms** cold-start on a mid-range Android. The fast path keeps this off plain-text content.
- KaTeX render of one equation: **5–15 ms** in WebView.
- Memory: ~3–5 MB per WebView. If you render 50 inline equations concurrently in a long FlatList, that's noticeable. Use FlatList's `windowSize` to keep it bounded; or batch math in fewer larger WebViews (one per question card, not per option).
- `androidLayerType="hardware"` matters — without it, the WebView re-rasterizes every scroll frame.

## What NOT to do

- ❌ Spin up one WebView per `$...$` segment with surrounding `<Text>` for plain segments. Layouts get ugly because WebViews don't naturally inline with `<Text>` flow. Use ONE WebView for the whole string instead.
- ❌ Skip the fast path. Plain-text questions don't need a WebView; mounting one always-on costs you cold-start ms × number-of-cards.
- ❌ Use `react-native-render-html` "with KaTeX" for this. It doesn't actually parse math — you still need a WebView round-trip somewhere.
- ❌ Build a regex-based KaTeX-to-Unicode replacer "as a quick fix". It works for `^2` but immediately breaks on fractions, sums, integrals — and you'll quietly ship wrong-looking formulas to users.

## Drop-in checklist

1. `react-native-webview` is a dep (Expo SDK 49+ ships it; verify with `cat package.json | grep webview`).
2. `MathText.tsx` lives at `src/components/MathText.tsx` (or wherever).
3. Replace `<Text>{userText}</Text>` with `<View><MathText value={userText} style={...} /></View>` at every site that may render `$...$` content.
4. Pass the same style you'd give to `<Text>` — fontSize, lineHeight, color, fontWeight, fontFamily — via the `style` prop. MathText forwards these into the WebView's body CSS.
5. Verify on a question that mixes Bengali (or whatever language) with mid-text math — that's the case that breaks lesser solutions.
