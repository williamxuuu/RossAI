/**
 * Popup: language, optional phone number, and which clinic server to talk to.
 *
 * Everything is written to chrome.storage.sync as it changes — there is no Save
 * button, because a client who closes the popup expecting their language to stick
 * should be right.
 *
 * The language list is fetched from the clinic's server so it always matches
 * SUPPORTED_LANGUAGES in src/lib/i18n.ts; if the server cannot be reached the
 * built-in list below is used instead.
 */

const DEFAULTS = { apiBaseUrl: "http://localhost:3000", language: "en", phone: "" };

const FALLBACK_LANGUAGES = {
  en: "English",
  es: "Español",
  fr: "Français",
  ht: "Kreyòl Ayisyen",
  pt: "Português",
  zh: "中文",
  ar: "العربية",
  vi: "Tiếng Việt",
  ru: "Русский",
  uk: "Українська",
  tl: "Tagalog",
  ko: "한국어",
  fa: "فارسی",
  am: "አማርኛ",
  so: "Soomaali",
};

const $ = (id) => document.getElementById(id);
const status = (text) => {
  $("status").textContent = text;
  if (text) setTimeout(() => ($("status").textContent = ""), 1600);
};

function fillLanguages(languages, selected) {
  const select = $("language");
  select.replaceChildren();
  for (const [code, name] of Object.entries(languages)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = name;
    if (code === selected) option.selected = true;
    select.append(option);
  }
}

async function loadLanguages(apiBaseUrl) {
  try {
    const res = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/api/jargon/languages`, { credentials: "omit" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.languages && Object.keys(json.languages).length ? json.languages : null;
  } catch {
    return null;
  }
}

async function init() {
  const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  $("phone").value = settings.phone;
  $("apiBaseUrl").value = settings.apiBaseUrl;
  fillLanguages(FALLBACK_LANGUAGES, settings.language);

  const live = await loadLanguages(settings.apiBaseUrl);
  if (live) fillLanguages(live, settings.language);

  $("language").addEventListener("change", async (e) => {
    await chrome.storage.sync.set({ language: e.target.value });
    status("Language saved.");
  });

  $("phone").addEventListener("change", async (e) => {
    const phone = e.target.value.trim();
    // The server requires E.164; saying so here beats a silent failure later.
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone.replace(/[\s().-]/g, ""))) {
      $("status").textContent = "Use the international format, e.g. +15551234567.";
      return;
    }
    await chrome.storage.sync.set({ phone });
    status(phone ? "Phone number saved." : "Phone number cleared.");
  });

  $("apiBaseUrl").addEventListener("change", async (e) => {
    const apiBaseUrl = e.target.value.trim() || DEFAULTS.apiBaseUrl;
    await chrome.storage.sync.set({ apiBaseUrl });
    const refreshed = await loadLanguages(apiBaseUrl);
    if (refreshed) fillLanguages(refreshed, (await chrome.storage.sync.get(DEFAULTS)).language);
    status("Server saved.");
  });
}

init();
