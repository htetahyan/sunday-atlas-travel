import { isLocale, type Locale } from "@/i18n/config";

/** Swap the locale segment and keep a trailing slash. */
export function swapLocale(pathname: string, nextLocale: Locale): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0 || !isLocale(segments[0])) {
    segments.unshift(nextLocale);
  } else {
    segments[0] = nextLocale;
  }
  return `/${segments.join("/")}/`;
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}
