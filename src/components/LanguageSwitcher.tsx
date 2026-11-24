"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { FlagDe, FlagEn, FlagEs, FlagFr, FlagJa, FlagZh } from "@/components/flags";
import { localeTags, locales, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/getDictionary";
import { swapLocale } from "@/lib/paths";

const FLAGS: Record<Locale, ComponentType> = {
  en: FlagEn,
  de: FlagDe,
  fr: FlagFr,
  ja: FlagJa,
  es: FlagEs,
  zh: FlagZh,
};

/**
 * Target URL for a locale. A partial locale (zh) only has some tours and destinations; when
 * this page has no zh version the option goes to the zh home page instead of a 404.
 */
function targetHref(pathname: string, code: Locale, partialPaths: Record<string, string[]>): string {
  const href = swapLocale(pathname, code);
  const available = partialPaths[code];
  if (!available) return href;
  const rest = href.slice(code.length + 1);
  return available.includes(rest) ? href : `/${code}/`;
}

export function LanguageSwitcher({
  locale,
  languages,
  variant = "overlay",
  partialPaths = {},
}: {
  partialPaths?: Record<string, string[]>;
  locale: Locale;
  languages: Dictionary["languages"];
  /** `inline` keeps the list in normal flow so a mobile sheet does not clip it. */
  variant?: "overlay" | "inline";
}) {
  const pathname = usePathname() ?? `/${locale}/`;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const listId = useId();
  const inline = variant === "inline";

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const index = locales.indexOf(locale);
    optionRefs.current[index]?.focus();
  }, [open, locale]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function select(code: Locale) {
    setOpen(false);
    const href = targetHref(pathname, code, partialPaths);
    router.push(href === `/${code}/` && swapLocale(pathname, code) !== href ? href : `${href}${window.location.search}`);
  }

  function focusOption(index: number) {
    const count = locales.length;
    const next = ((index % count) + count) % count;
    optionRefs.current[next]?.focus();
  }

  function activeIndex() {
    const found = optionRefs.current.findIndex((node) => node === document.activeElement);
    if (found >= 0) return found;
    return locales.indexOf(locale);
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "ArrowDown" ||
      event.key === "ArrowUp"
    ) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onOptionKeyDown(event: KeyboardEvent<HTMLAnchorElement>, code: Locale) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(activeIndex() + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(activeIndex() - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusOption(locales.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(code);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "Tab") setOpen(false);
  }

  const CurrentFlag = FLAGS[locale];

  return (
    <div
      ref={rootRef}
      className={inline ? "relative w-full" : "relative"}
      onKeyDown={(event) => {
        if (event.key === "Tab" && open) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={
          inline
            ? "flex w-full items-center gap-2 rounded-full border border-line bg-card px-3 py-2 text-sm text-ink"
            : "inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-sm text-ink hover:border-teal"
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={languages.label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKeyDown}
      >
        <CurrentFlag />
        <span className="font-medium">{languages[locale]}</span>
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-muted ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={languages.label}
          className={
            inline
              ? "relative z-20 mt-2 w-full rounded-2xl border border-line bg-card p-1 shadow-card"
              : "absolute right-0 z-50 mt-2 w-max min-w-full rounded-2xl border border-line bg-card p-1 shadow-card"
          }
        >
          {locales.map((code, index) => {
            const Flag = FLAGS[code];
            const selected = code === locale;
            const href = targetHref(pathname, code, partialPaths);
            return (
              <li key={code}>
                <a
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  href={href}
                  role="option"
                  aria-selected={selected}
                  lang={localeTags[code]}
                  hrefLang={localeTags[code]}
                  tabIndex={-1}
                  className={
                    selected
                      ? "flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-ink"
                      : "flex items-center gap-2 rounded-full px-3 py-2 text-sm text-muted hover:bg-cream hover:text-ink"
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    select(code);
                  }}
                  onKeyDown={(event) => onOptionKeyDown(event, code)}
                >
                  <Flag />
                  <span>{languages[code]}</span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
