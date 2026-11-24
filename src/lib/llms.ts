import { siteName } from "@/config/site";
import { getDictionarySync } from "@/i18n/getDictionary";
import { isPartialLocale, locales } from "@/i18n/config";
import { packageAnswerLine } from "@/lib/answer-lines";
import {
  contactEmail,
  formatPackageDuration,
  formatStoredPrice,
  getBlogPosts,
  getDestinations,
  getPackages,
  getPackagesByDestination,
  localizeBlogPost,
  localizeDestination,
  localizePackage,
  type TravelPackage,
} from "@/lib/content";
import { cmsUpdatedAt, latestDate } from "@/lib/content-dates";
import { formatMonthYear, lastModified } from "@/lib/dates";
import { absoluteUrl } from "@/lib/metadata";

/**
 * /llms.txt and /llms-full.txt (llmstxt.org format), built from the same catalog as the pages so
 * every price, count and URL stays current. English only; the other languages are linked.
 */

const en = () => getDictionarySync("en");

function usd(packages: readonly TravelPackage[]) {
  return packages.filter((p) => typeof p.priceFrom === "number" && p.priceFrom > 0 && (!p.currency || p.currency === "USD"));
}

function range(packages: readonly TravelPackage[]): string {
  const values = usd(packages).map((p) => p.priceFrom as number);
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? formatStoredPrice(min) : `${formatStoredPrice(min)} to ${formatStoredPrice(max)}`;
}

function checkedMonth(): string {
  return formatMonthYear(latestDate(getPackages().map((p) => cmsUpdatedAt(`packages/${p.slug}`))), "en");
}

function header(): string[] {
  const packages = getPackages();
  const destinations = getDestinations();
  const multi = packages.filter((p) => !p.isDayTour);
  const day = packages.filter((p) => p.isDayTour);
  const countries = destinations.map((d) => localizeDestination(d, "en").name).filter(Boolean);
  const regions = Array.from(new Set(destinations.map((d) => localizeDestination(d, "en").region).filter(Boolean)));
  const email = contactEmail();
  const month = checkedMonth();
  return [
    `# ${siteName}`,
    "",
    `> ${siteName} is a travel agency based in Bangkok, Thailand, that plans private tours in ${listJoin(regions.map((r) => (r === "Caucasus" ? "the Caucasus" : r)))}: ${countries.join(", ")}. It publishes ${packages.length} tours with day-by-day itineraries and per-person prices by group size, plus a travel blog. Quotes are personal; asking about a tour does not reserve a place.`,
    "",
    "## Key facts",
    "",
    `- Countries: ${countries.join(", ")} (${countries.length}).`,
    `- Tours: ${packages.length} in total: ${multi.length} multi-day tours (${range(multi)} per person, starting prices) and ${day.length} day tours (${range(day)} per person, starting prices).`,
    `- Prices are in USD per person and depend on group size; the price table on each tour page has every group size.${month ? ` Prices checked ${month}.` : ""}`,
    ...(packages.some((p) => !(typeof p.priceFrom === "number" && p.priceFrom > 0))
      ? [`- Tours without a listed price are quoted on request for your dates, group size and hotels.`]
      : []),
    `- Languages: the site is in ${locales.filter((l) => !isPartialLocale(l)).map((l) => l.toUpperCase()).join(", ")}; Simplified Chinese (ZH) pages are being added tour by tour.`,
    ...(email ? [`- Contact: ${email}, or the enquiry form at ${absoluteUrl("en", "/contact/")}`] : []),
    "",
  ];
}

function destinationLines(): string[] {
  return getDestinations().map((d) => {
    const copy = localizeDestination(d, "en");
    const tours = getPackagesByDestination(d.slug);
    const prices = range(tours);
    const season = copy.bestSeasons[0]?.replace(/\s*\([^)]*\)/g, "").trim();
    return `- [${copy.name}](${absoluteUrl("en", `/destinations/${d.slug}/`)}): ${tours.length} tour${tours.length === 1 ? "" : "s"}${prices ? `, starting prices ${prices} per person` : ""}${season ? `. Best time: ${season}` : ""}.`;
  });
}

function packageLine(p: TravelPackage): string {
  const copy = localizePackage(p, "en");
  return `- [${copy.title}](${absoluteUrl("en", `/packages/${p.slug}/`)}): ${packageAnswerLine(p, "en", en())}`;
}

function blogLines(limit?: number): string[] {
  const posts = [...getBlogPosts()].sort(
    (a, b) => Date.parse(lastModified(b.publishedAt, b.updatedAt)) - Date.parse(lastModified(a.publishedAt, a.updatedAt)),
  );
  return (limit ? posts.slice(0, limit) : posts).map((post) => {
    const copy = localizeBlogPost(post, "en");
    return `- [${copy.title}](${absoluteUrl("en", `/blog/${post.slug}/`)})${copy.summary ? `: ${copy.summary}` : ""}`;
  });
}

function companyLines(): string[] {
  const dict = en();
  return [
    `- [About](${absoluteUrl("en", "/about/")})`,
    `- [How it works](${absoluteUrl("en", "/how-it-works/")})`,
    `- [FAQ](${absoluteUrl("en", "/faq/")})`,
    `- [Contact](${absoluteUrl("en", "/contact/")})`,
    `- [Privacy policy](${absoluteUrl("en", "/privacy/")})`,
    `- [Terms](${absoluteUrl("en", "/terms/")})`,
    `- [${dict.nav.packages}](${absoluteUrl("en", "/packages/")}) · [${dict.nav.destinations}](${absoluteUrl("en", "/destinations/")}) · [Travel blog](${absoluteUrl("en", "/blog/")})`,
  ];
}

/** Listed price for sorting; tours quoted on request go after the priced ones. */
function priceOrder(p: TravelPackage): number {
  return typeof p.priceFrom === "number" && p.priceFrom > 0 ? p.priceFrom : Number.POSITIVE_INFINITY;
}

function sortedPackages(): TravelPackage[] {
  return [...getPackages()].sort((a, b) => Number(a.isDayTour) - Number(b.isDayTour) || priceOrder(a) - priceOrder(b));
}

export function llmsTxt(): string {
  const packages = sortedPackages();
  return [
    ...header(),
    "## Destinations",
    "",
    ...destinationLines(),
    "",
    "## Multi-day tours",
    "",
    ...packages.filter((p) => !p.isDayTour).map(packageLine),
    "",
    "## Day tours",
    "",
    ...packages.filter((p) => p.isDayTour).map(packageLine),
    "",
    "## Travel blog (latest posts)",
    "",
    ...blogLines(10),
    "",
    "## Company and policies",
    "",
    ...companyLines(),
    "",
    "## Optional",
    "",
    `- [Full text for AI tools](${absoluteUrl("en", "/").replace(/\/en\/$/, "")}/llms-full.txt): every tour with itinerary, inclusions and price table`,
    `- Other languages: ${locales.filter((l) => l !== "en").map((l) => absoluteUrl(l, "/")).join(", ")}`,
    "",
  ].join("\n");
}

function packageFull(p: TravelPackage): string[] {
  const dict = en();
  const copy = localizePackage(p, "en");
  const out = [`### ${copy.title}`, "", `URL: ${absoluteUrl("en", `/packages/${p.slug}/`)}`, "", packageAnswerLine(p, "en", dict)];
  if (copy.summary) out.push("", copy.summary);
  const duration = formatPackageDuration(copy.durationDays, copy.nights, dict.packages);
  if (copy.seasonNote) out.push("", `Season: ${copy.seasonNote}`);
  if (copy.maxGroupSize) out.push(`Group size: private, up to ${copy.maxGroupSize} travellers`);
  if (duration) out.push(`Length: ${duration}`);
  if (copy.itinerary.length > 0) {
    out.push("", "Itinerary:");
    for (const day of copy.itinerary) out.push(`- Day ${day.day}: ${day.title}`);
  }
  if (copy.included.length > 0) out.push("", "Included:", ...copy.included.map((x) => `- ${x}`));
  if (copy.notIncluded.length > 0) out.push("", "Not included:", ...copy.notIncluded.map((x) => `- ${x}`));
  const table = copy.priceTable;
  if (table && table.rows.length > 0 && table.groupSizes.length > 0) {
    out.push("", `Prices${table.caption ? ` (${table.caption})` : ""}:`);
    for (const row of table.rows) {
      const cells = table.groupSizes
        .map((g, i) => (typeof row.prices[i] === "number" && row.prices[i] > 0 ? `${g} ${formatStoredPrice(row.prices[i])}` : ""))
        .filter(Boolean);
      out.push(`- ${row.label}: ${cells.join("; ")}${row.singleSupplement ? `; single supplement ${row.singleSupplement}` : ""}`);
    }
    if (table.note) out.push(table.note);
  }
  return [...out, ""];
}

export function llmsFullTxt(): string {
  const dict = en();
  const faqs = (dict.faq.items as { q: string; a: string }[]) ?? [];
  return [
    ...header(),
    "## Destinations",
    "",
    ...destinationLines(),
    "",
    "## Tours",
    "",
    ...sortedPackages().flatMap(packageFull),
    "## Frequently asked questions",
    "",
    ...faqs.flatMap((f) => [`Q: ${f.q}`, `A: ${f.a}`, ""]),
    "## Travel blog",
    "",
    ...blogLines(),
    "",
    "## Company and policies",
    "",
    ...companyLines(),
    "",
  ].join("\n");
}

function listJoin(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
