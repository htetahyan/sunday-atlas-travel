"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { hasBlog, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/getDictionary";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Logo } from "./Logo";
import { SubscribeForm } from "./subscribe/SubscribeForm";
import { SubscribePopover } from "./subscribe/SubscribePopover";

function isCurrent(pathname: string, href: string, locale: Locale): boolean {
  const home = `/${locale}/`;
  if (href === home) return pathname === home || pathname === `/${locale}`;
  return pathname === href || pathname.startsWith(href);
}

export function Header({
  locale,
  nav,
  languages,
  siteName,
  subscribe,
  partialPaths = {},
}: {
  /** Locale-agnostic paths that exist in partial locales (zh). Other zh paths link to /zh/. */
  partialPaths?: Record<string, string[]>;
  locale: Locale;
  nav: Dictionary["nav"];
  subscribe: Dictionary["subscribe"];
  languages: Dictionary["languages"];
  siteName: string;
}) {
  const pathname = usePathname() ?? `/${locale}/`;
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const homeHref = `/${locale}/`;
  const contactHref = `/${locale}/contact/`;

  const links = [
    { href: `/${locale}/destinations/`, label: nav.destinations },
    { href: `/${locale}/packages/`, label: nav.packages },
    ...(hasBlog(locale) ? [{ href: `/${locale}/blog/`, label: nav.blog }] : []),
    { href: `/${locale}/how-it-works/`, label: nav.howItWorks, wide: true },
    { href: `/${locale}/about/`, label: nav.about, wide: true },
    { href: `/${locale}/faq/`, label: nav.faq, wide: true },
  ] as Array<{ href: string; label: string; wide?: boolean }>;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 8);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([tabindex='-1'])"),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      menuButtonRef.current?.focus();
    };
  }, [open]);

  return (
    <header
      data-scrolled={scrolled ? "true" : undefined}
      className="site-header sticky top-0 z-40 border-b border-line bg-cream/95 backdrop-blur"
    >
      <div className="mx-auto flex h-16 max-w-page items-center gap-3 px-4 sm:px-5">
        <Logo href={homeHref} label={`${siteName}, ${nav.home}`} />
        <nav className="ml-4 hidden items-center gap-4 lg:flex xl:ml-6 xl:gap-6" aria-label={nav.mainNav}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isCurrent(pathname, link.href, locale) ? "page" : undefined}
              className={`nav-link relative whitespace-nowrap text-sm text-muted hover:text-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink ${link.wide ? "hidden xl:inline" : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden lg:block">
          <LanguageSwitcher locale={locale} languages={languages} partialPaths={partialPaths} variant="overlay" />
        </div>
        <SubscribePopover locale={locale} copy={subscribe} />
        <Link
          href={contactHref}
          className="btn-pop ml-2 hidden shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-dark lg:inline-flex"
        >
          {nav.planTrip}
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card text-ink lg:ml-2 lg:hidden"
          aria-expanded={open}
          aria-controls={panelId}
          data-menu-toggle
          onClick={() => setOpen(true)}
        >
          <span className="sr-only">{nav.openMenu}</span>
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>
      {open ? (
        <div className="fixed inset-x-0 top-0 z-50 h-[100dvh] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            aria-label={nav.closeMenu}
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={nav.mobileNav}
            className="absolute inset-y-0 right-0 flex w-[min(100%,22rem)] flex-col bg-cream shadow-card"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
              <p className="font-serif text-lg">{siteName}</p>
              <button
                ref={closeRef}
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line"
                onClick={() => setOpen(false)}
              >
                <span className="sr-only">{nav.closeMenu}</span>
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <nav className="flex flex-col px-4 py-4" aria-label={nav.mainNav}>
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={isCurrent(pathname, link.href, locale) ? "page" : undefined}
                    className="border-b border-line py-3 text-lg text-ink"
                  >
                    {link.label}
                  </Link>
                ))}
                <Link href={contactHref} className="mt-4 inline-flex items-center justify-center rounded-full bg-teal px-4 py-3 font-semibold text-white">
                  {nav.planTrip}
                </Link>
              </nav>
              <div id="menu-subscribe" className="mx-4 mb-4 rounded-2xl border border-line bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">{subscribe.eyebrow}</p>
                <p className="mt-1 font-serif text-lg leading-snug text-ink">{subscribe.title}</p>
                <p className="mt-1 text-sm text-muted">{subscribe.body}</p>
                <div className="mt-3">
                  <SubscribeForm locale={locale} copy={subscribe} compact source="menu" />
                </div>
              </div>
              <div className="mt-auto border-t border-line px-4 py-4">
                <LanguageSwitcher locale={locale} languages={languages} partialPaths={partialPaths} variant="inline" />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
