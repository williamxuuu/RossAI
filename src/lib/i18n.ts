/** Language helpers shared by pipeline, console, and extension API. */
export const SUPPORTED_LANGUAGES: Record<string, string> = {
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

export function languageName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return SUPPORTED_LANGUAGES[code] ?? code;
}

export function normalizeLanguage(code: string | null | undefined): string {
  const c = (code ?? "en").toLowerCase().split(/[-_]/)[0];
  return c in SUPPORTED_LANGUAGES ? c : "en";
}
