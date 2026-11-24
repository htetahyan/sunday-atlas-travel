import type { ImageCredit } from "@/lib/content";

const PHOTO: Record<string, string> = { en: "Photo", de: "Foto", fr: "Photo", ja: "写真", es: "Foto", zh: "图片" };

/** Small attribution line for photos whose licence requires one (CC BY, CC BY-SA, Unsplash). */
export function PhotoCredit({ credit, locale }: { credit?: ImageCredit; locale: string }) {
  if (!credit?.required) return null;
  const author = credit.sourceUrl ? (
    <a href={credit.sourceUrl} rel="nofollow noopener" target="_blank" className="underline decoration-dotted underline-offset-2">
      {credit.author}
    </a>
  ) : (
    credit.author
  );
  const license = credit.licenseUrl ? (
    <a href={credit.licenseUrl} rel="license nofollow noopener" target="_blank" className="underline decoration-dotted underline-offset-2">
      {credit.license}
    </a>
  ) : (
    credit.license
  );
  return (
    <span className="text-[11px] leading-snug text-muted">
      {PHOTO[locale] ?? PHOTO.en}: {author}
      {credit.provider === "commons" ? " / Wikimedia Commons" : credit.provider === "unsplash" ? " / Unsplash" : ""}, {license}
    </span>
  );
}
