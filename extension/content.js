/**
 * The overlay (spec §3.2).
 *
 * Select text on a USCIS page → a floating card appears next to the selection with
 * a plain-language explanation in the client's language, the USCIS passage it came
 * from, and a "still confused — ask the clinic" button.
 *
 * Three rules this file exists to keep:
 *
 * 1. NEVER GUESS. The card renders exactly what the server returned. When the server
 *    says `grounded: false`, the card shows the server's message and the escalate
 *    button, and there is no code path that writes an explanation of its own.
 * 2. STAY OUT OF THE PAGE. Everything lives in a closed shadow root with its own
 *    styles, so a government form's CSS cannot restyle the card and the card cannot
 *    restyle the form. The page cannot read the shadow root either.
 * 3. NEVER PARSE HTML. Text from the server is inserted with textContent. A citation
 *    quote containing markup is a quote, not markup.
 */

const HOST_ID = "rossai-overlay-host";
const MIN_CHARS = 3;
const MAX_CHARS = 400;

let host = null;
let shadow = null;
let lastText = "";

// ---------------------------------------------------------------------------
// mount
// ---------------------------------------------------------------------------

function ensureHost() {
  if (host && document.documentElement.contains(host)) return;
  host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, { position: "absolute", top: "0", left: "0", zIndex: "2147483647" });
  shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS_TEXT;
  shadow.append(style);
  document.documentElement.append(host);
}

function hide() {
  if (host) host.style.display = "none";
  lastText = "";
}

function showAt(rect) {
  ensureHost();
  host.style.display = "block";
  const margin = 10;
  const width = 340;
  const left = Math.max(margin, Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - width - margin));
  host.style.left = `${left}px`;
  host.style.top = `${window.scrollY + rect.bottom + 8}px`;
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

function clearCard() {
  for (const node of [...shadow.childNodes]) {
    if (node.nodeName !== "STYLE") node.remove();
  }
}

function card() {
  clearCard();
  const el = document.createElement("div");
  el.className = "card";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "RossAI explanation");
  shadow.append(el);
  return el;
}

function header(parent, selected) {
  const row = document.createElement("div");
  row.className = "head";
  const title = document.createElement("span");
  title.className = "term";
  title.textContent = selected.length > 60 ? `${selected.slice(0, 60)}…` : selected;
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", hide);
  row.append(title, close);
  parent.append(row);
}

function renderLoading(selected) {
  const el = card();
  header(el, selected);
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = "Looking this up in the official USCIS material…";
  el.append(p);
}

function renderExplanation(selected, data) {
  const el = card();
  header(el, selected);

  const body = document.createElement("p");
  body.className = "body";
  body.textContent = data.explanation;
  el.append(body);

  if (data.citation) {
    const figure = document.createElement("figure");
    figure.className = "cite";
    const quote = document.createElement("blockquote");
    quote.textContent = `“${data.citation.quote}”`;
    const link = document.createElement("a");
    link.href = data.citation.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = data.citation.title;
    figure.append(quote, link);
    el.append(figure);
  }

  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "This explains what the words mean. It is not legal advice and it does not say what you should do.";
  el.append(note);

  el.append(escalateButton(selected, "Still confused — ask the clinic"));
}

function renderUngrounded(selected, data) {
  const el = card();
  header(el, selected);
  const p = document.createElement("p");
  p.className = "body";
  p.textContent = data.message;
  el.append(p);
  el.append(escalateButton(selected, "Ask the clinic"));
}

function renderError(selected, message) {
  const el = card();
  header(el, selected);
  const p = document.createElement("p");
  p.className = "body";
  p.textContent = message;
  el.append(p);
}

function escalateButton(selected, label) {
  const wrap = document.createElement("div");
  wrap.className = "actions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Sending…";
    const res = await chrome.runtime.sendMessage({ type: "escalate", text: selected, pageUrl: location.href });
    const done = document.createElement("p");
    done.className = res?.ok ? "ok" : "err";
    done.textContent = res?.ok
      ? "Sent. Someone from the clinic will look at this and reply to you."
      : "We could not reach the clinic. Please try again in a moment.";
    wrap.replaceChildren(done);
  });
  wrap.append(button);
  return wrap;
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

async function onSelection() {
  const selection = window.getSelection();
  const text = (selection?.toString() ?? "").trim().replace(/\s+/g, " ");
  if (text.length < MIN_CHARS) {
    hide();
    return;
  }
  if (text.length > MAX_CHARS) {
    ensureHost();
    showAt(selection.getRangeAt(0).getBoundingClientRect());
    renderError(text, "That is a lot of text at once. Select a sentence or a single term and try again.");
    return;
  }
  if (text === lastText) return;
  lastText = text;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  ensureHost();
  showAt(rect);
  renderLoading(text);

  const res = await chrome.runtime.sendMessage({ type: "explain", text, pageUrl: location.href });
  if (text !== lastText) return; // the selection moved on while we waited

  if (!res?.ok) {
    renderError(text, res?.error === "rate_limited" ? "Too many lookups in a row. Please wait a moment." : "We could not reach the clinic's server.");
    return;
  }
  if (res.body.grounded) renderExplanation(text, res.body);
  else renderUngrounded(text, res.body);
}

document.addEventListener("mouseup", () => setTimeout(onSelection, 0));
document.addEventListener("keyup", (e) => {
  if (e.key === "Escape") hide();
  else if (e.shiftKey || e.key.startsWith("Arrow")) setTimeout(onSelection, 0);
});
document.addEventListener("mousedown", (e) => {
  if (host && !e.composedPath().includes(host)) hide();
});
window.addEventListener("scroll", hide, { passive: true });

// ---------------------------------------------------------------------------

const CSS_TEXT = `
:host { all: initial; }
.card {
  width: 340px; max-width: calc(100vw - 24px);
  box-sizing: border-box;
  background: #F6F3ED; color: #2A2724;
  font: 14px/1.55 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  border-radius: 22px;
  padding: 18px 20px;
  box-shadow: 0 10px 30px -12px rgba(42,39,36,.35), 0 2px 6px -2px rgba(42,39,36,.14);
}
.head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.term {
  flex: 1; min-width: 0;
  font-size: .72rem; letter-spacing: .08em; text-transform: uppercase;
  color: #6B6560; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.close {
  all: unset; cursor: pointer; color: #6B6560; font-size: 18px; line-height: 1; padding: 0 2px;
}
.close:hover { color: #2A2724; }
.body { margin: 0 0 12px; font-size: 14px; }
.muted { margin: 0; color: #6B6560; font-size: 13px; }
.cite {
  margin: 0 0 12px; padding: 12px; background: #FFFFFF; border-radius: 12px;
}
.cite blockquote {
  margin: 0 0 8px; padding-left: 10px; border-left: 2px solid #D9D3C9;
  font-size: 12px; line-height: 1.5; color: #6B6560;
}
.cite a { font-size: 12px; color: #3F5B4C; text-decoration: none; font-weight: 500; }
.cite a:hover { text-decoration: underline; }
.note { margin: 0 0 12px; font-size: 11px; line-height: 1.5; color: #6B6560; }
.actions { display: flex; }
.primary {
  all: unset; cursor: pointer;
  background: #3F5B4C; color: #FFFFFF;
  padding: 8px 16px; border-radius: 999px;
  font-size: 13px; font-weight: 500;
}
.primary:hover { opacity: .9; }
.primary:disabled { opacity: .5; cursor: default; }
.ok { margin: 0; font-size: 12px; color: #4F7355; }
.err { margin: 0; font-size: 12px; color: #A6453B; }
`;
