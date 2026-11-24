import { JsonLd } from "@/components/seo/JsonLd";
import { faqPageSchema } from "@/lib/structured-data";

export type PageFaqItem = { q: string; a: string };

/** Question/answer list matching the destination FAQ markup. */
export function FaqAccordion({ items }: { items: readonly PageFaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4 divide-y divide-line rounded-2xl border border-line bg-card">
      {items.map((item) => (
        <details key={item.q} className="group px-5">
          <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 font-medium text-ink">
            {item.q}
            <span aria-hidden="true" className="text-xl text-teal group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="pb-4 text-sm leading-relaxed text-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

/**
 * Optional CMS FAQ block for static pages. Renders nothing when `items` is empty.
 * Emits FAQPage JSON-LD only when there is at least one complete pair.
 */
export function PageFaq({ title, items }: { title: string; items: readonly PageFaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-12">
      <JsonLd data={faqPageSchema(items)} />
      <h2 className="font-serif text-2xl text-ink">{title}</h2>
      <FaqAccordion items={items} />
    </section>
  );
}
