"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import type { Dictionary } from "@/i18n/getDictionary";

type Copy = Dictionary["subscribe"];
type Status = "idle" | "sending" | "success" | "error";

/**
 * Email sign-up. Posts to the Pages Function /api/subscribe, which validates, rate-limits,
 * dedupes and stores the address. Nothing is emailed from here.
 */
export function SubscribeForm({
  locale,
  copy,
  tone = "light",
  compact = false,
  autoFocus = false,
  source,
}: {
  locale: string;
  copy: Copy;
  tone?: "light" | "dark";
  compact?: boolean;
  autoFocus?: boolean;
  /** Short tag for where the form sits, e.g. "header", "footer", "blog". */
  source: string;
}) {
  const id = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setStatus("error");
      setMessage(copy.errorInvalid);
      return;
    }
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          locale,
          sourcePage: window.location.pathname.slice(0, 200),
          source,
          website: String(data.get("website") || ""),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (response.ok && body.ok) {
        setStatus("success");
        setMessage(copy.success);
        form.reset();
        return;
      }
      setStatus("error");
      setMessage(
        body.reason === "invalid"
          ? copy.errorInvalid
          : body.reason === "rate_limited"
            ? copy.errorRateLimited
            : copy.errorGeneric,
      );
    } catch {
      setStatus("error");
      setMessage(copy.errorGeneric);
    }
  }

  const dark = tone === "dark";
  const muted = dark ? "text-white/80" : "text-muted";

  if (status === "success") {
    return (
      <p
        role="status"
        className={`subscribe-success flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${
          dark ? "bg-white/15 text-white" : "bg-teal-soft text-teal-dark"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="w-full">
      <div className={`flex gap-2 ${compact ? "flex-col" : "flex-col sm:flex-row"}`}>
        <label htmlFor={`${id}-email`} className="sr-only">
          {copy.emailLabel}
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          autoFocus={autoFocus}
          placeholder={copy.placeholder}
          aria-invalid={status === "error" ? true : undefined}
          aria-describedby={`${id}-note`}
          className={`field min-w-0 flex-1 ${dark ? "!border-white/30" : ""}`}
        />
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor={`${id}-website`}>{copy.honeypotLabel}</label>
          <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <button
          type="submit"
          disabled={status === "sending"}
          className={`btn-pop inline-flex min-h-[2.75rem] shrink-0 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold disabled:opacity-70 ${
            dark ? "bg-cream text-ink hover:bg-white" : "bg-teal text-white hover:bg-teal-dark"
          }`}
        >
          {status === "sending" ? copy.sending : copy.submit}
          {status === "sending" ? null : (
            <svg viewBox="0 0 24 24" className="btn-arrow h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </div>
      <p
        role={status === "error" ? "alert" : undefined}
        aria-live="polite"
        className={`mt-2 min-h-[1.25rem] text-sm font-medium ${dark ? "text-sand-soft" : "text-danger"}`}
      >
        {status === "error" ? message : ""}
      </p>
      <p id={`${id}-note`} className={`text-xs leading-relaxed ${muted}`}>
        {copy.privacyNote}{" "}
        <Link href={`/${locale}/privacy/`} className="underline underline-offset-2 hover:no-underline">
          {copy.privacyLink}
        </Link>
      </p>
    </form>
  );
}
