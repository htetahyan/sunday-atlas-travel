import Link from "next/link";
import { isPartialLocale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/getDictionary";

/**
 * Partial locales (zh) list only the tours and destinations that have their own copy.
 * `empty`: nothing yet, so a short note and a link to the enquiry form.
 * Otherwise a one-line note that more are coming, with a link to the full English list.
 */
export function PartialLocaleNote({
  locale,
  dict,
  kind,
  empty,
  className = "",
}: {
  locale: string;
  dict: Dictionary;
  kind: "destinations" | "packages";
  empty: boolean;
  className?: string;
}) {
  if (!isPartialLocale(locale)) return null;
  const copy = dict.empty.partial;
  if (empty) {
    return (
      <div className={`rounded-2xl border border-dashed border-line bg-card px-5 py-8 text-muted ${className}`}>
        <p>{kind === "destinations" ? copy.emptyDestinations : copy.emptyPackages}</p>
        <Link
          href={`/${locale}/contact/`}
          className="btn-pop mt-5 inline-flex items-center justify-center rounded-full bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-dark"
        >
          {dict.nav.planTrip}
        </Link>
      </div>
    );
  }
  return (
    <p className={`text-sm text-muted ${className}`}>
      {kind === "destinations" ? copy.moreDestinations : copy.morePackages}{" "}
      <a href={`/en/${kind}/`} hrefLang="en" className="font-semibold text-teal underline-offset-4 hover:underline">
        {kind === "destinations" ? copy.allInEnglishDestinations : copy.allInEnglishPackages}
      </a>
    </p>
  );
}
