# Chatbot Hardening Notes

## M6: TestChat.tsx — Unsafe Rendering Audit

**File reviewed:** `src/app/(app)/dashboard/chatbot/_components/TestChat.tsx`

---

### Verdict: SAFE (no dangerouslySetInnerHTML or unsanitized HTML injection)

### Analysis

#### Bot text / assistant message content

Line 249 is the primary render path for assistant (bot) output:

```tsx
// TestChat.tsx:249
<div className="whitespace-pre-wrap">{m.content}</div>
```

`m.content` is inserted as a **React child string**, not via `dangerouslySetInnerHTML`. React escapes all HTML entities in text children, so even if the model returns a payload like `<script>alert(1)</script>`, React renders it as the literal characters `&lt;script&gt;...&lt;/script&gt;`. No XSS vector here.

#### Error and delta text

Lines 153–158 (error event handler) and lines 173–178 (catch block) both assign to `assistant` and render via the same `{m.content}` path, so they inherit the same safe treatment.

#### Sources

Lines 268–273 render source titles as React text nodes:

```tsx
// TestChat.tsx:270
<span key={j} className="cb-msg-source">{s}</span>
```

`s` is a plain string from the server event. Safe.

#### Media thumbnails — image `src` and `alt`

Lines 258–260:

```tsx
// TestChat.tsx:259
<img src={thumb.signedUrl} alt={thumb.name} loading="lazy" />
```

`thumb.signedUrl` is controlled by the server (a Supabase signed URL). React does not escape attribute values against JavaScript injection within `src`, **but** a `javascript:` URI in an `<img src>` does not execute in any modern browser (unlike `<a href>`). The `alt` attribute is a text attribute, fully safe.

`thumb.name` is used in `title={thumb.name}` and `alt={thumb.name}` — both text attributes, escaped by React.

#### Markdown rendering

There is **no markdown-to-HTML pipeline** in this component. The `whitespace-pre-wrap` CSS class preserves line breaks visually; the content is never passed through a Markdown parser (e.g. `marked`, `remark`, `react-markdown`) that could produce raw HTML. This is the safest possible treatment: plain text, white-space preserved.

#### `dangerouslySetInnerHTML` usage

Grep result: **zero occurrences** of `dangerouslySetInnerHTML` in TestChat.tsx.

---

### Recommendations

The component is currently safe. The following are hardening suggestions to maintain safety as the component evolves:

1. **Keep bot text as plain text.** If Markdown rendering is added in the future (e.g. for bold, bullets), use a library configured with `allowedElements` whitelisting (e.g. `rehype-sanitize` with `react-markdown`) and never pass raw HTML from the bot through `dangerouslySetInnerHTML`.

2. **Validate `signedUrl` shape server-side.** Although `javascript:` URIs are inert on `<img>`, consider asserting that `signedUrl` starts with `https://` before rendering, to be defensive against unexpected values in the stream payload.

3. **Content-Security-Policy.** A CSP header that includes `img-src 'self' https:` (blocking `data:` and `javascript:`) at the HTTP layer provides defense-in-depth independently of React's escaping.

No code changes to TestChat.tsx are required at this time.
