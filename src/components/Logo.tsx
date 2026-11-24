import Link from "next/link";

export function CompassMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M16 5.5 L18.4 16 L16 14.2 L13.6 16 Z" fill="#0F6E6E" />
      <path d="M16 26.5 L13.6 16 L16 17.8 L18.4 16 Z" fill="#C8794A" />
      <circle cx="16" cy="16" r="1.4" fill="#1C2430" />
    </svg>
  );
}

export function Logo({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-2 text-ink" aria-label={label}>
      <CompassMark className="h-8 w-8 shrink-0" />
      <span className="whitespace-nowrap font-serif text-xl leading-none tracking-tight">Sunday Atlas</span>
    </Link>
  );
}
