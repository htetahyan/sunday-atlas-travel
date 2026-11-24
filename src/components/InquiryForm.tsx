"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import type { Dictionary } from "@/i18n/getDictionary";
import { submitInquiry } from "@/lib/inquiry";
import { fill } from "@/lib/paths";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import turnstileSettings from "../../content/settings/turnstile.json";

const TURNSTILE_SITE_KEY = (turnstileSettings as { site_key?: string }).site_key ?? "";

type DestinationOption = { slug: string; name: string };
type PackageOption = { slug: string; title: string; destination: string };

type FieldName =
  | "name"
  | "email"
  | "passport"
  | "destination"
  | "dates"
  | "groupSize"
  | "message"
  | "consent";

const emptyErrors: Record<FieldName, string> = {
  name: "",
  email: "",
  passport: "",
  destination: "",
  dates: "",
  groupSize: "",
  message: "",
  consent: "",
};

const FALLBACK_CONTACT_EMAIL = "contact@sundayatlastravel.com";

/** Render a message whose {email} placeholder becomes a mailto link. */
function withEmailLink(template: string, address: string) {
  const [before, after] = template.split("{email}");
  if (after === undefined) return template;
  return (
    <>
      {before}
      <a href={`mailto:${address}`} className="text-teal underline underline-offset-4 hover:text-teal-dark">
        {address}
      </a>
      {after}
    </>
  );
}

export function InquiryForm({
  locale,
  dict,
  destinations,
  packages,
  contactEmail,
}: {
  locale: string;
  dict: Dictionary;
  destinations: DestinationOption[];
  packages: PackageOption[];
  /** Public contact address from content/settings/seo.json (contact_email). */
  contactEmail?: string;
}) {
  const baseId = useId();
  const copy = dict.contact;
  const fallbackEmail = contactEmail || FALLBACK_CONTACT_EMAIL;
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [passport, setPassport] = useState("");
  const [destination, setDestination] = useState("");
  const [dates, setDates] = useState("");
  const [groupSize, setGroupSize] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [packageSlug, setPackageSlug] = useState<string | null>(null);
  const [errors, setErrors] = useState(emptyErrors);
  const [submitting, setSubmitting] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [submitError, setSubmitError] = useState<"invalid" | "rate_limited" | "challenge" | "error" | null>(null);

  const matched = packages.find((item) => item.slug === packageSlug);

  useEffect(() => {
    // Resolve the requested tour from ?package= (legacy links), #package=
    // (fallback) or sessionStorage, in that order.
    const fromQuery = new URLSearchParams(window.location.search).get("package");
    const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("package");
    let fromStorage: string | null = null;
    try {
      fromStorage = window.sessionStorage.getItem("sunday_atlas_quote_package");
      if (fromStorage) window.sessionStorage.removeItem("sunday_atlas_quote_package");
    } catch {
      // sessionStorage can be unavailable (privacy mode); ignore.
    }
    const slug = fromQuery || fromHash || fromStorage;
    if (fromQuery && /\/contact\/$/.test(window.location.pathname)) {
      // Keep ?package= but show /contact?package=… (no slash before "?").
      window.history.replaceState(
        null,
        "",
        window.location.pathname.slice(0, -1) + window.location.search,
      );
    }
    if (!slug) return;
    setPackageSlug(slug);
    const found = packages.find((item) => item.slug === slug);
    if (found) {
      setDestination(found.destination);
      // Pre-fill a ready-to-edit quote request unless the visitor already typed.
      setMessage((current) =>
        current.trim() ? current : fill(copy.packageMessageTemplate, { title: found.title }),
      );
    }
  }, [packages, copy.packageMessageTemplate]);

  function validate(): Record<FieldName, string> {
    const next = { ...emptyErrors };
    if (name.trim().length < 2) next.name = copy.errors.name;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = copy.errors.email;
    if (passport.trim().length < 2) next.passport = copy.errors.passport;
    if (!destination) next.destination = copy.errors.destination;
    if (dates.trim().length < 2) next.dates = copy.errors.dates;
    if (groupSize.trim().length < 1) next.groupSize = copy.errors.groupSize;
    if (message.trim().length < 10) next.message = copy.errors.message;
    if (!consent) next.consent = copy.errors.consent;
    return next;
  }

  function resetFields() {
    setName("");
    setEmail("");
    setPassport("");
    setDestination("");
    setDates("");
    setGroupSize("");
    setMessage("");
    setConsent(false);
    setWebsite("");
    setErrors(emptyErrors);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotConfigured(false);
    setSucceeded(false);
    setSubmitError(null);
    const next = validate();
    setErrors(next);
    const firstInvalid = (Object.keys(next) as FieldName[]).find((key) => next[key]);
    if (firstInvalid) {
      const node = document.getElementById(`${baseId}-${firstInvalid}`);
      node?.focus();
      return;
    }
    if (!turnstileToken) {
      setSubmitError("challenge");
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitInquiry({
        name: name.trim(),
        email: email.trim(),
        passport: passport.trim(),
        destination,
        dates: dates.trim(),
        groupSize: groupSize.trim(),
        message: message.trim(),
        consent,
        packageSlug: matched ? matched.slug : packageSlug,
        locale,
        website,
        turnstileToken,
      });
      if (result.ok) {
        resetFields();
        setSucceeded(true);
        return;
      }
      if (result.reason === "not_configured") {
        setNotConfigured(true);
        return;
      }
      if (result.reason === "invalid") {
        setSubmitError("invalid");
        return;
      }
      if (result.reason === "rate_limited") {
        setSubmitError("rate_limited");
        return;
      }
      if (result.reason === "challenge") {
        setSubmitError("challenge");
        return;
      }
      setSubmitError("error");
    } finally {
      setSubmitting(false);
      // A Turnstile token is single-use: get a fresh one after every attempt.
      setTurnstileToken(null);
      setTurnstileReset((n) => n + 1);
    }
  }

  function fieldProps(field: FieldName) {
    return {
      id: `${baseId}-${field}`,
      "aria-invalid": errors[field] ? true : undefined,
      "aria-describedby": errors[field] ? `${baseId}-${field}-error` : undefined,
    } as const;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative space-y-5">
      <div className="absolute left-0 top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
        <label className="absolute -left-[10000px] top-0">
          {copy.honeypotLabel}
          <input
            name="website"
            type="text"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
        </label>
      </div>
      {packageSlug && !matched ? (
        <p className="rounded-2xl border border-line bg-teal-soft px-4 py-3 text-sm text-ink">
          {copy.packageUnknown}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          {copy.fields.name}
          <input
            {...fieldProps("name")}
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={copy.placeholders.name}
            maxLength={120}
            className="field mt-1.5"
          />
          {errors.name ? (
            <span id={`${baseId}-name-error`} className="mt-1 block text-sm text-danger">
              {errors.name}
            </span>
          ) : null}
        </label>
        <label className="block text-sm font-medium text-ink">
          {copy.fields.email}
          <input
            {...fieldProps("email")}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={copy.placeholders.email}
            maxLength={200}
            className="field mt-1.5"
          />
          {errors.email ? (
            <span id={`${baseId}-email-error`} className="mt-1 block text-sm text-danger">
              {errors.email}
            </span>
          ) : null}
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          {copy.fields.passport}
          <input
            {...fieldProps("passport")}
            name="passport"
            autoComplete="country-name"
            value={passport}
            onChange={(event) => setPassport(event.target.value)}
            placeholder={copy.placeholders.passport}
            maxLength={80}
            className="field mt-1.5"
          />
          {errors.passport ? (
            <span id={`${baseId}-passport-error`} className="mt-1 block text-sm text-danger">
              {errors.passport}
            </span>
          ) : null}
        </label>
        <label className="block text-sm font-medium text-ink">
          {copy.fields.destination}
          <select
            {...fieldProps("destination")}
            name="destination"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            className="field mt-1.5"
          >
            <option value="">{copy.destinationPlaceholder}</option>
            <option value="undecided">{copy.destinationUndecided}</option>
            {destinations.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
          {errors.destination ? (
            <span id={`${baseId}-destination-error`} className="mt-1 block text-sm text-danger">
              {errors.destination}
            </span>
          ) : null}
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          {copy.fields.dates}
          <input
            {...fieldProps("dates")}
            name="dates"
            value={dates}
            onChange={(event) => setDates(event.target.value)}
            placeholder={copy.placeholders.dates}
            maxLength={120}
            className="field mt-1.5"
          />
          {errors.dates ? (
            <span id={`${baseId}-dates-error`} className="mt-1 block text-sm text-danger">
              {errors.dates}
            </span>
          ) : null}
        </label>
        <label className="block text-sm font-medium text-ink">
          {copy.fields.groupSize}
          <input
            {...fieldProps("groupSize")}
            name="groupSize"
            value={groupSize}
            onChange={(event) => setGroupSize(event.target.value)}
            placeholder={copy.placeholders.groupSize}
            maxLength={40}
            className="field mt-1.5"
          />
          {errors.groupSize ? (
            <span id={`${baseId}-groupSize-error`} className="mt-1 block text-sm text-danger">
              {errors.groupSize}
            </span>
          ) : null}
        </label>
      </div>

      <label className="block text-sm font-medium text-ink">
        {copy.fields.message}
        <textarea
          {...fieldProps("message")}
          name="message"
          rows={8}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={copy.placeholders.message}
          maxLength={4000}
          className="field mt-1.5"
        />
        {errors.message ? (
          <span id={`${baseId}-message-error`} className="mt-1 block text-sm text-danger">
            {errors.message}
          </span>
        ) : null}
      </label>

      <div>
        <label className="flex items-start gap-3 text-sm leading-relaxed text-ink">
          <input
            {...fieldProps("consent")}
            name="consent"
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-1 h-4 w-4 accent-teal"
          />
          <span>{copy.fields.consent}</span>
        </label>
        {errors.consent ? (
          <span id={`${baseId}-consent-error`} className="mt-1 block text-sm text-danger">
            {errors.consent}
          </span>
        ) : null}
      </div>

      <TurnstileWidget
        siteKey={TURNSTILE_SITE_KEY}
        language={locale}
        resetSignal={turnstileReset}
        onToken={setTurnstileToken}
      />
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-full bg-teal px-5 py-3 text-sm font-semibold text-white hover:bg-teal-dark disabled:cursor-wait"
      >
        {submitting ? copy.submitting : copy.submit}
      </button>

      {succeeded ? (
        <p role="status" className="rounded-2xl border border-line bg-sand-soft px-4 py-3 text-sm text-ink">
          {copy.success}
        </p>
      ) : null}
      {submitError === "invalid" ? (
        <p role="alert" className="rounded-2xl border border-line bg-sand-soft px-4 py-3 text-sm text-ink">
          {copy.errorInvalid}
        </p>
      ) : null}
      {submitError === "rate_limited" ? (
        <p role="alert" className="rounded-2xl border border-line bg-sand-soft px-4 py-3 text-sm text-ink">
          {copy.errorRateLimited}
        </p>
      ) : null}
      {submitError === "challenge" ? (
        <p role="alert" className="rounded-2xl border border-line bg-sand-soft px-4 py-3 text-sm text-ink">
          {copy.errorChallenge}
        </p>
      ) : null}
      {submitError === "error" ? (
        <p role="alert" className="rounded-2xl border border-line bg-sand-soft px-4 py-3 text-sm text-ink">
          {withEmailLink(copy.errorGeneric, fallbackEmail)}
        </p>
      ) : null}
      {notConfigured ? (
        <p role="status" className="rounded-2xl border border-line bg-sand-soft px-4 py-3 text-sm text-ink">
          {withEmailLink(copy.notConfigured, fallbackEmail)}
        </p>
      ) : null}
    </form>
  );
}
