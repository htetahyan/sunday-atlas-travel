import { START_CITIES, type StartCity } from "@/config/start-cities";
import type { Dictionary } from "@/i18n/getDictionary";
import {
  formatPackageDuration,
  formatStoredPrice,
  getPackage,
  getPackagesByDestination,
  localizeDestination,
  localizePackage,
  pick,
  type BlogPost,
  type Destination,
  type TravelPackage,
} from "@/lib/content";
import { cmsUpdatedAt, latestDate } from "@/lib/content-dates";
import { formatMonthYear } from "@/lib/dates";
import { fill } from "@/lib/paths";

/**
 * One-line, answer-first summaries shown right under the H1 of package, destination and blog pages,
 * so a reader (or an AI answer engine) gets length, start city and price without scrolling.
 * Every value comes from the catalog; nothing is shown when the data is missing.
 */

type AnswerCopy = Dictionary["answer"];

function startCity(travelPackage: TravelPackage): StartCity | undefined {
  const firstDay = travelPackage.itinerary?.[0];
  const title = firstDay ? pick(firstDay.title, "en") : "";
  if (!title) return undefined;
  let best: { city: StartCity; at: number } | undefined;
  for (const city of START_CITIES) {
    const at = title.search(new RegExp(`(?<![\\p{L}\\p{N}])${city.en}(?![\\p{L}\\p{N}])`, "iu"));
    if (at >= 0 && (!best || at < best.at)) best = { city, at };
  }
  return best?.city;
}

function cityName(city: StartCity, locale: string): string {
  return (city as Record<string, string>)[locale] || city.en;
}

function pricesChecked(dates: readonly (string | undefined)[], locale: string, copy: AnswerCopy): string {
  const month = formatMonthYear(latestDate(dates), locale);
  return month ? fill(copy.pricesChecked, { month }) : "";
}

/** Sentences are joined with a space, except in Japanese, where "。" already ends each one. */
function joinSentences(locale: string, ...parts: string[]): string {
  return parts.filter(Boolean).join(locale === "ja" || locale === "zh" ? "" : " ");
}

/** "1 day, starting in Bishkek, from $130 per person (4 travellers). Prices checked October 2026." */
export function packageAnswerLine(travelPackage: TravelPackage, locale: string, dict: Dictionary): string {
  const copy = localizePackage(travelPackage, locale);
  const duration = formatPackageDuration(copy.durationDays, copy.nights, dict.packages);
  // A tour without a listed price is quoted per enquiry: the line gives length and start city only.
  const price = copy.fromLabel;
  const city = startCity(travelPackage);
  const line = !duration
    ? ""
    : price
      ? city
        ? fill(dict.answer.packageLine, { duration, city: cityName(city, locale), price })
        : fill(dict.answer.packageLineNoCity, { duration, price })
      : city
        ? fill(dict.answer.packageLineNoPrice, { duration, city: cityName(city, locale) })
        : fill(dict.answer.packageLineNoCityNoPrice, { duration });
  if (!line) return "";
  const checked = copy.fromLabel ? pricesChecked([cmsUpdatedAt(`packages/${travelPackage.slug}`)], locale, dict.answer) : "";
  return joinSentences(locale, line, checked);
}

export type CompactPriceTable = {
  columns: { label: string }[];
  rows: { label: string; prices: string[] }[];
};

const GROUP_SIZES = [1, 2, 4, 6] as const;

/** Column index of the price-table band ("2–3 travellers", "4 travellers") that a group of `n` falls in. */
function bandIndex(labels: readonly string[], n: number): number {
  return labels.findIndex((label) => {
    const nums = (label.match(/\d+/g) ?? []).map(Number);
    if (nums.length === 0) return false;
    const lo = nums[0];
    const hi = nums.length > 1 ? nums[1] : nums[0];
    return n >= lo && n <= hi;
  });
}

/**
 * Per-person price for groups of 1, 2, 4 and 6, read from the tour's own price table. A group size
 * with no matching band is left out (never estimated); the table is omitted unless at least two
 * different bands match.
 */
export function compactPriceTable(travelPackage: TravelPackage, locale: string, dict: Dictionary): CompactPriceTable | undefined {
  const table = travelPackage.priceTable;
  if (!table || (travelPackage.currency && travelPackage.currency !== "USD")) return undefined;
  const enLabels = table.groupSizes.en ?? [];
  const matched = GROUP_SIZES.flatMap((n) => {
    const index = bandIndex(enLabels, n);
    if (index < 0) return [];
    if (!table.rows.some((row) => typeof row.prices[index] === "number" && row.prices[index] > 0)) return [];
    return [{ n, index }];
  });
  if (new Set(matched.map((m) => m.index)).size < 2) return undefined;
  const localized = localizePackage(travelPackage, locale).priceTable;
  const rows = table.rows.flatMap((row, rowIndex) => {
    const label = localized?.rows[rowIndex]?.label ?? pick(row.label, locale);
    const prices = matched.map(({ index }) => {
      const value = row.prices[index];
      return typeof value === "number" && value > 0 ? formatStoredPrice(value) : "–";
    });
    return prices.some((p) => p !== "–") ? [{ label, prices }] : [];
  });
  if (rows.length === 0) return undefined;
  return {
    columns: matched.map(({ n }) => ({
      label: n === 1 ? dict.answer.travellerOne : fill(dict.answer.travellers, { n }),
    })),
    rows,
  };
}

function priced(packages: readonly TravelPackage[]) {
  return packages.filter((p) => typeof p.priceFrom === "number" && p.priceFrom > 0 && (!p.currency || p.currency === "USD"));
}

function stripAside(text: string): string {
  return text.replace(/\s*[(（][^()（）]*[)）]\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** "9 tours in Kazakhstan, with starting prices from $104 to $3145 per person. Best time to go: …" */
export function destinationAnswerLine(destination: Destination, locale: string, dict: Dictionary): string {
  const copy = localizeDestination(destination, locale);
  const tours = getPackagesByDestination(destination.slug, locale);
  const withPrice = priced(tours);
  const parts: string[] = [];
  if (tours.length > 0 && withPrice.length > 0 && copy.name) {
    const values = withPrice.map((p) => p.priceFrom as number);
    const min = formatStoredPrice(Math.min(...values));
    const max = formatStoredPrice(Math.max(...values));
    const count = tours.length;
    const template =
      count === 1 ? dict.answer.destinationLineOne : min === max ? dict.answer.destinationLineFrom : dict.answer.destinationLine;
    parts.push(fill(template, { count, country: copy.name, min, max }));
  } else if (tours.length > 0 && copy.name) {
    const template = tours.length === 1 ? dict.answer.destinationLineNoPriceOne : dict.answer.destinationLineNoPrice;
    parts.push(fill(template, { count: tours.length, country: copy.name }));
  }
  const season = copy.bestSeasons[0] ? stripAside(copy.bestSeasons[0]) : "";
  if (season) parts.push(fill(dict.answer.bestTime, { season }));
  if (parts.length > 0 && withPrice.length > 0) {
    parts.push(pricesChecked(withPrice.map((p) => cmsUpdatedAt(`packages/${p.slug}`)), locale, dict.answer));
  }
  return joinSentences(locale, ...parts);
}

/** "3 related tours, from $104 per person. Prices checked October 2026." for a blog post. */
export function blogAnswerLine(post: BlogPost, locale: string, dict: Dictionary): string {
  const related = (post.relatedPackages ?? []).flatMap((slug) => {
    const p = getPackage(slug);
    return p ? [p] : [];
  });
  const tours = related.length > 0 ? related : post.destination ? getPackagesByDestination(post.destination) : [];
  const withPrice = priced(tours);
  if (withPrice.length === 0) return "";
  const min = formatStoredPrice(Math.min(...withPrice.map((p) => p.priceFrom as number)));
  const count = tours.length;
  const line = fill(count === 1 ? dict.answer.blogLineOne : dict.answer.blogLine, { count, min });
  return joinSentences(locale, line, pricesChecked(withPrice.map((p) => cmsUpdatedAt(`packages/${p.slug}`)), locale, dict.answer));
}
