import type { ReactNode } from "react";

type Section = { heading: string; paragraphs: string[] };

/** Replaces each `{email}` token with a mailto link, or with `pending` text when no email is set. */
function withEmail(paragraph: string, email?: string, pending?: string): ReactNode {
  if (!paragraph.includes("{email}")) return paragraph;
  const parts = paragraph.split("{email}");
  return parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          email ? (
            <a key={index} href={`mailto:${email}`}>
              {email}
            </a>
          ) : (
            pending ?? ""
          ),
          part,
        ],
  );
}

type Block = { kind: "p" | "ul" | "ol"; items: string[] };

/**
 * Groups paragraphs into blocks: lines starting with "• " become a bulleted list,
 * lines starting with "1) " a numbered list, everything else stays a paragraph.
 */
function groupBlocks(paragraphs: string[]): Block[] {
  const blocks: Block[] = [];
  for (const paragraph of paragraphs) {
    const bullet = paragraph.match(/^•\s+([\s\S]*)$/);
    const numbered = paragraph.match(/^\d+\)\s+([\s\S]*)$/);
    const kind: Block["kind"] = bullet ? "ul" : numbered ? "ol" : "p";
    const text = bullet?.[1] ?? numbered?.[1] ?? paragraph;
    const last = blocks[blocks.length - 1];
    if (kind !== "p" && last?.kind === kind) last.items.push(text);
    else blocks.push({ kind, items: [text] });
  }
  return blocks;
}

export function ProsePage({
  eyebrow,
  title,
  lede,
  lastUpdated,
  sections,
  email,
  emailPending,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  lastUpdated?: string;
  sections: Section[];
  /** Public contact email for `{email}` tokens in paragraphs. */
  email?: string;
  emailPending?: string;
  children?: ReactNode;
}) {
  return (
    <main id="main" tabIndex={-1}>
      <article className="mx-auto w-full max-w-3xl px-5 py-14 md:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">{eyebrow}</p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight text-ink sm:text-5xl">{title}</h1>
        {lastUpdated ? <p className="mt-3 text-sm text-muted">{lastUpdated}</p> : null}
        <p className="mt-5 text-lg leading-relaxed text-muted">{lede}</p>
        <div className="prose-atlas">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {groupBlocks(section.paragraphs).map((block, index) =>
                block.kind === "p" ? (
                  <p key={block.items[0]}>{withEmail(block.items[0], email, emailPending)}</p>
                ) : block.kind === "ul" ? (
                  <ul key={index} className="list-disc pl-6">
                    {block.items.map((item) => (
                      <li key={item}>{withEmail(item, email, emailPending)}</li>
                    ))}
                  </ul>
                ) : (
                  <ol key={index} className="list-decimal pl-6">
                    {block.items.map((item) => (
                      <li key={item}>{withEmail(item, email, emailPending)}</li>
                    ))}
                  </ol>
                ),
              )}
            </section>
          ))}
        </div>
        {children}
      </article>
    </main>
  );
}
