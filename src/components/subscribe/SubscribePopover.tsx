"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Dictionary } from "@/i18n/getDictionary";
import { SubscribeForm } from "./SubscribeForm";

/** Header "Subscribe" button with a small anchored popover (desktop). */
export function SubscribePopover({ locale, copy }: { locale: string; copy: Dictionary["subscribe"] }) {
  // French and Spanish nav labels are longer: show the text label only on very wide screens there.
  const labelClass = locale === "fr" || locale === "es" ? "sr-only 2xl:not-sr-only" : "sr-only xl:not-sr-only";
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative ml-3 hidden lg:block">
      <button
        ref={buttonRef}
        type="button"
        data-subscribe-open
        aria-expanded={open}
        aria-controls={panelId}
        title={copy.button}
        onClick={() => setOpen((value) => !value)}
        className="btn-pop inline-flex items-center gap-1.5 rounded-full border border-line bg-card whitespace-nowrap px-2.5 py-2 text-sm font-semibold text-ink hover:border-teal hover:text-teal xl:px-3.5"
      >
        <svg viewBox="0 0 24 24" className="bell h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M6 9a6 6 0 1112 0c0 5 2 6.5 2 6.5H4S6 14 6 9z" />
          <path d="M10 19a2 2 0 004 0" />
        </svg>
        <span className={labelClass}>{copy.button}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={copy.title}
          className="pop-in absolute right-0 top-[calc(100%+0.75rem)] z-50 w-[22rem] rounded-2xl border border-line bg-card p-5 shadow-card"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">{copy.eyebrow}</p>
              <p className="mt-1 font-serif text-xl leading-snug text-ink">{copy.title}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
              className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-cream hover:text-ink"
            >
              <span className="sr-only">{copy.close}</span>
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{copy.body}</p>
          <div className="mt-4">
            <SubscribeForm locale={locale} copy={copy} compact autoFocus source="header" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
