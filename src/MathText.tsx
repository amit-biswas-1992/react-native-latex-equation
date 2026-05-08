import React, { useMemo, useState } from 'react';
import { Platform, Text, type TextStyle } from 'react-native';
import WebView from 'react-native-webview';
import { KATEX_CSS, KATEX_JS, KATEX_AUTO_RENDER_JS } from './katex-bundle';

// Guard against any literal "</script>" appearing inside a JS string in the
// bundles — that would prematurely close our inline <script> tag and break
// the HTML. KaTeX's minified output doesn't normally contain this, but the
// split-join is cheap insurance against future versions.
const sanitizeForInlineScript = (s: string) => s.split('</script>').join('<\\/script>');
const SAFE_KATEX_JS = sanitizeForInlineScript(KATEX_JS);
const SAFE_KATEX_AUTO_RENDER_JS = sanitizeForInlineScript(KATEX_AUTO_RENDER_JS);

export interface MathTextProps {
  /** Text that may contain `$inline$` or `$$display$$` LaTeX math segments. */
  value: string | undefined | null;
  /** Same shape as RN <Text>'s style. fontSize, lineHeight, color, fontWeight, fontFamily are forwarded into the WebView body CSS. */
  style?: TextStyle;
  /**
   * Override color used for inline equations only. Defaults to `style.color`
   * (or `#0f172a` if unset). KaTeX renders math as text, so this keeps math
   * visually consistent with surrounding text.
   */
  mathColor?: string;
}

/**
 * Render a string that may contain inline LaTeX math wrapped in `$...$`
 * (inline) or `$$...$$` (display) delimiters.
 *
 * - Fast path: if the string has no `$`, falls back to a plain RN `<Text>`.
 *   Zero WebView cost for plain content.
 * - Math path: mounts ONE `<WebView>` per node, loaded with KaTeX
 *   auto-render so math inside the body is replaced inline with surrounding
 *   text. HTML's natural flow handles mid-sentence wrapping.
 *
 * Loads KaTeX from `cdn.jsdelivr.net`. Works while the device has network.
 * For full offline support, fork and bundle the KaTeX assets locally
 * via `expo-asset`.
 */
export default function MathText({ value, style, mathColor }: MathTextProps) {
  const text = value ?? '';
  if (!text.includes('$')) {
    return <Text style={style}>{text}</Text>;
  }
  return <WebViewMath text={text} style={style} mathColor={mathColor} />;
}

function WebViewMath({
  text,
  style,
  mathColor,
}: {
  text: string;
  style?: TextStyle;
  mathColor?: string;
}) {
  const [height, setHeight] = useState<number>(24);

  const fontSize = (style?.fontSize as number | undefined) ?? 14;
  const lineHeight =
    (style?.lineHeight as number | undefined) ?? Math.round(fontSize * 1.5);
  const color = mathColor ?? (style?.color as string | undefined) ?? '#0f172a';
  const fontWeight = String(style?.fontWeight ?? '400');
  const fontFamily =
    (style?.fontFamily as string | undefined) ??
    (Platform.OS === 'android' ? 'sans-serif' : 'System');

  const html = useMemo(
    () =>
      buildHtml({ text, fontSize, lineHeight, color, fontWeight, fontFamily }),
    [text, fontSize, lineHeight, color, fontWeight, fontFamily],
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
          const data = JSON.parse(event.nativeEvent.data) as {
            height?: number;
            type?: string;
          };
          if (data.type === 'log') return; // dev-only channel
          if (typeof data.height === 'number' && data.height > 0) {
            setHeight(Math.ceil(data.height) + 2);
          }
        } catch {
          // ignore
        }
      }}
    />
  );
}

interface BuildHtmlOpts {
  text: string;
  fontSize: number;
  lineHeight: number;
  color: string;
  fontWeight: string;
  fontFamily: string;
}

function buildHtml({
  text,
  fontSize,
  lineHeight,
  color,
  fontWeight,
  fontFamily,
}: BuildHtmlOpts): string {
  const escaped = escapeOutsideMath(text);
  // KaTeX CSS (with woff2 fonts inlined as data: URIs) and JS are bundled
  // into the package and embedded directly into the HTML — no network needed.
  // See ./katex-bundle.ts. The body of the HTML is structured as:
  //   <style>KATEX_CSS</style>           ← KaTeX styling + fonts
  //   <style>...layout overrides...</style>
  //   <div id="root">user content</div>
  //   <script>renderAndReport definitions (must come BEFORE katex JS)</script>
  //   <script>KATEX_JS</script>           ← defines window.katex
  //   <script>KATEX_AUTO_RENDER_JS</script>  ← defines renderMathInElement
  //   <script>renderAndReport()</script>  ← fires now that auto-render is loaded
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${KATEX_CSS}</style>
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
  function postHeight() {
    if (window.ReactNativeWebView && document.body) {
      window.ReactNativeWebView.postMessage(JSON.stringify({height: document.body.scrollHeight}));
    }
  }
  function renderAndReport() {
    try {
      if (typeof renderMathInElement !== 'function') {
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
<script>${SAFE_KATEX_JS}</script>
<script>${SAFE_KATEX_AUTO_RENDER_JS}</script>
<script>renderAndReport();</script>
</body></html>`;
}

/**
 * Escape HTML-special characters in non-math segments. Math segments
 * (delimited by $...$ or $$...$$) are left untouched so KaTeX can parse them.
 * Unmatched `$` is treated as literal text. Without this, user content
 * could HTML-inject into the WebView.
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
        if (input[j] === '\\' && input[j + 1] === '$') {
          j += 2;
          continue;
        }
        if (isDisplay) {
          if (input[j] === '$' && input[j + 1] === '$') {
            found = j;
            break;
          }
        } else if (input[j] === '$') {
          found = j;
          break;
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
