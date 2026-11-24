import Link from "next/link";
import { hasBlog, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/getDictionary";
import { partialLocalePaths } from "@/lib/content";
import { fill } from "@/lib/paths";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SubscribeForm } from "./subscribe/SubscribeForm";

export function Footer({
  locale,
  dict,
  year,
  email,
}: {
  locale: Locale;
  dict: Dictionary;
  year: number;
  /** Public contact email; omitted when unset. */
  email?: string;
}) {
  const explore = [
    { href: `/${locale}/destinations/`, label: dict.nav.destinations },
    { href: `/${locale}/packages/`, label: dict.nav.packages },
    ...(hasBlog(locale) ? [{ href: `/${locale}/blog/`, label: dict.nav.blog }] : []),
    { href: `/${locale}/how-it-works/`, label: dict.nav.howItWorks },
  ];
  const company = [
    { href: `/${locale}/about/`, label: dict.nav.about },
    { href: `/${locale}/faq/`, label: dict.nav.faq },
    { href: `/${locale}/contact/`, label: dict.nav.contact },
    { href: `/${locale}/privacy/`, label: dict.nav.privacy },
    { href: `/${locale}/terms/`, label: dict.nav.terms },
  ];

  return (
    <footer className="mt-auto border-t border-line bg-card">
      <div id="subscribe" className="border-b border-line bg-teal-soft/50">
        <div className="mx-auto grid max-w-page items-center gap-6 px-5 py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">{dict.subscribe.eyebrow}</p>
            <h2 className="mt-2 font-serif text-2xl tracking-tight text-ink sm:text-3xl">{dict.subscribe.title}</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{dict.subscribe.body}</p>
          </div>
          <SubscribeForm locale={locale} copy={dict.subscribe} source="footer" />
        </div>
      </div>
      <div className="mx-auto grid max-w-page gap-10 px-5 py-12 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <p className="font-serif text-2xl text-ink">Sunday Atlas</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">{dict.footer.blurb}</p>
          {email ? (
            <p className="mt-3 text-sm">
              <span className="font-semibold text-ink">{dict.contact.emailLabel}: </span>
              <a href={`mailto:${email}`} className="link-slide text-muted hover:text-ink">
                {email}
              </a>
            </p>
          ) : null}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-ink">{dict.footer.explore}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {explore.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="link-slide text-muted hover:text-ink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-ink">{dict.footer.company}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {company.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="link-slide text-muted hover:text-ink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-ink">{dict.languages.label}</h2>
          <div className="mt-3">
            <LanguageSwitcher locale={locale} languages={dict.languages} partialPaths={partialLocalePaths()} />
          </div>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-page px-5 py-5 text-sm text-muted">
          <p>{fill(dict.footer.rights, { year })}</p>
        </div>
      </div>
    </footer>
  );
}
