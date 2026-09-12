/**
 * Service worker. It exists for one reason: the content script must not make the
 * network call itself.
 *
 * A page on uscis.gov can read anything the content script puts in the DOM and can
 * see its fetches. Routing through the worker means the page never learns the
 * console's address, never sees the response, and cannot forge a request from the
 * extension's origin. The worker is also where the API base URL and the client's
 * chosen language live, in chrome.storage.sync.
 *
 * No cookies are ever sent (`credentials: "omit"`): the client is anonymous by
 * design (spec §4) and /api/jargon/* takes no session.
 */

const DEFAULTS = {
  apiBaseUrl: "http://localhost:3000",
  language: "en",
  phone: "",
};

const REQUEST_TIMEOUT_MS = 20000;

async function settings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function callApi(path, body) {
  const { apiBaseUrl } = await settings();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) return { ok: false, status: res.status, error: json.error ?? `HTTP ${res.status}`, body: json };
    return { ok: true, status: res.status, body: json };
  } catch (err) {
    return { ok: false, status: 0, error: err.name === "AbortError" ? "timeout" : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const { language, phone } = await settings();
    if (message?.type === "explain") {
      sendResponse(await callApi("/api/jargon/explain", { text: message.text, pageUrl: message.pageUrl, language }));
      return;
    }
    if (message?.type === "escalate") {
      sendResponse(
        await callApi("/api/jargon/escalate", {
          text: message.text,
          pageUrl: message.pageUrl,
          language,
          question: message.question || undefined,
          phone: phone || undefined,
        }),
      );
      return;
    }
    if (message?.type === "settings") {
      sendResponse({ ok: true, body: await settings() });
      return;
    }
    sendResponse({ ok: false, error: "unknown_message" });
  })();
  return true; // keep the message channel open for the async reply
});
