import { JsonLd } from "@/components/seo/JsonLd";
import { absoluteUrl } from "@/lib/metadata";
import { breadcrumbSchema } from "@/lib/structured-data";

type Crumb = { name: string; path: string };

/** BreadcrumbList JSON-LD. `path` is locale-agnostic (`/` or `/about/`). Renders no visible UI. */
export function BreadcrumbJsonLd({
  locale,
  crumbs,
}: {
  locale: string;
  crumbs: readonly Crumb[];
}) {
  return (
    <JsonLd
      data={breadcrumbSchema(
        crumbs.map((crumb) => ({ name: crumb.name, url: absoluteUrl(locale, crumb.path) })),
        locale,
      )}
    />
  );
}
