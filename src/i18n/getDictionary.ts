import en from "./dictionaries/en.json";
import de from "./dictionaries/de.json";
import fr from "./dictionaries/fr.json";
import ja from "./dictionaries/ja.json";
import es from "./dictionaries/es.json";
import zh from "./dictionaries/zh.json";
import { defaultLocale, type Locale } from "./config";

export type Dictionary = typeof en;

const dictionaries: Record<Locale, unknown> = { en, de, fr, ja, es, zh };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fill gaps from the English source. Empty strings count as missing so an
 * unfinished translation cannot blank out a label.
 */
function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base)) {
    if (override === undefined) return base;
    return override as T;
  }
  if (!isRecord(base)) {
    if (override === undefined || override === "") return base;
    return override as T;
  }
  const extra = isRecord(override) ? override : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    const next = extra[key];
    if (next === undefined || next === "") {
      out[key] = base[key as keyof typeof base];
    } else if (isRecord(base[key as keyof typeof base]) && isRecord(next)) {
      out[key] = deepMerge(base[key as keyof typeof base], next);
    } else {
      out[key] = next;
    }
  }
  return out as T;
}

export function getDictionarySync(locale: Locale): Dictionary {
  if (locale === defaultLocale) return en;
  return deepMerge(en, dictionaries[locale]);
}

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  return getDictionarySync(locale);
}
