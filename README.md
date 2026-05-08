# react-native-latex-equation

Render inline LaTeX math (`$...$` and `$$...$$`) inside React Native / Expo `<Text>` content — including **mid-sentence equations mixed with regular text**.

A single tiny `<MathText>` component. One WebView per text node when math is present; plain `<Text>` when it isn't (zero overhead for plain content).

## Why

`<Text>{question}</Text>` won't render `$x^2 + 1 = 0$` as math — it shows the literal dollar signs. The web frontend probably uses [KaTeX](https://katex.org). This package gives you the same rendering on the React Native side, with text wrapping that flows naturally around inline math.

## Install

```bash
npm install react-native-latex-equation react-native-webview
# or
yarn add react-native-latex-equation react-native-webview
```

`react-native-webview` is a peer dependency. Expo SDK 49+ ships it as a transitive dep — verify with:

```bash
npm ls react-native-webview
```

## Use

```tsx
import MathText from 'react-native-latex-equation';

// Drop-in for <Text>:
<MathText
  value="Find x such that $x^2 + 5x - 6 = 0$ has integer roots."
  style={{ fontSize: 16, lineHeight: 24, color: '#0f172a' }}
/>

// Display equation:
<MathText value="$$\sum_{i=1}^n i = \frac{n(n+1)}{2}$$" />

// Bengali / Arabic / Chinese — works the same:
<MathText value="যদি $z^2 = 5+12i$ হয়, তবে z এর মান-" />

// Plain text — no `$` → renders as plain RN <Text>, zero WebView cost:
<MathText value="What is the capital of France?" />
```

### Wrapping notes

- `<MathText>` returns `<Text>` when no `$` is present, and `<WebView>` (wrapped in implicit auto-sized layout) when math is present.
- When putting it inside a flex parent next to other elements, wrap it in a `<View>` if you need flex sizing — same as you'd do with a WebView.

## API

```ts
interface MathTextProps {
  value: string | undefined | null;
  style?: TextStyle;          // forwarded to <Text> AND mirrored into WebView CSS
  mathColor?: string;         // override math color (defaults to style.color)
}
```

The `style` props that propagate into the WebView CSS:
- `fontSize` (defaults to 14)
- `lineHeight` (defaults to `fontSize * 1.5`)
- `color` (defaults to `#0f172a`)
- `fontWeight` (defaults to `'400'`)
- `fontFamily` (defaults to `sans-serif` on Android, `System` on iOS)

Pass the same style you'd give to `<Text>`. Math will inherit the typography.

## How it works

```
"Find x in $x^2 = 4$" 
   ↓
[contains $? → yes]
   ↓
<WebView> with <body>= the string + KaTeX auto-render
   ↓ KaTeX scans body, replaces $...$ inline
"Find x in x²=4"   ← natural HTML text wrapping
```

The WebView posts its `scrollHeight` back via `postMessage` so the React Native side can size the view to fit the rendered content.

**KaTeX is bundled in the package.** Both the renderer (`katex.min.js` ≈ 269 KB) and the stylesheet with all WOFF2 fonts inlined as `data:` URIs (≈ 370 KB) ship inside `dist/katex-bundle.js`. No CDN fetch, no network dependency — works fully offline as long as the user's device has the dev/production app installed.

The trade-off: each WebView body is ~640 KB of HTML. Native parsing handles this in ~10–20 ms; the perf cost is negligible compared to the WebView cold-start itself. Package size on disk is ~700 KB unpacked.

## Performance

- WebView cold-start: ~30–80 ms on a mid-range Android.
- KaTeX render of one equation: ~5–15 ms inside the WebView.
- Memory: ~3–5 MB per WebView.
- The fast-path bypass keeps plain-text content WebView-free, so a 30-question screen with 5 math questions creates 5 WebViews, not 30.

For lists with **many** inline equations (>20 visible at once), consider an SVG-based renderer like `react-native-mathjax-svg` instead.

## Why a single WebView per node (not per equation)

Mid-sentence wrapping. HTML's natural text flow handles `text + math + more text` correctly. A pattern where every `$...$` becomes its own WebView between `<Text>` segments breaks down because WebViews don't inline-flow with `<Text>` children.

## Caveats

- KaTeX needs network on first use (CDN). Cached via WebView storage afterward.
- Custom RN-only fonts (e.g., `NotoSerifBengali_500Medium`) won't be available inside the WebView; the body falls back to the system font of the same family name. For most languages this looks fine.
- `errorColor: '#ef4444'` — invalid LaTeX renders red instead of throwing. Adjust `MathText.tsx` if you want different behaviour.

## Companion AI agent skill

This package ships with a [`SKILL.md`](./SKILL.md) for [skills.sh](https://skills.sh)-compatible AI agents (Claude Code, Cursor, Codex, etc.). It documents the design rationale, the script-ordering bug we hit, performance tradeoffs, and offline-bundling recipe — so an AI agent can adapt the pattern to your project's specific needs without re-deriving the design.

## License

MIT — see [LICENSE](./LICENSE).
