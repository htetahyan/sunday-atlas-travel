export type PageSectionCopy = { heading: string; body: string };

/** Paragraphs are blank-line separated. A single newline stays inside one paragraph. */
function paragraphsFromBody(body: string): string[] {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.replace(/[ \t]*\n[ \t]*/g, " ").trim())
    .filter((part) => part.length > 0);
}

/**
 * Optional CMS content blocks. Renders nothing when no item has both a heading
 * and a body. Callers pass locale-only copy; this component does not translate.
 */
export function PageSections({ sections }: { sections: readonly PageSectionCopy[] }) {
  const visible = sections.flatMap((section, index) => {
    const heading = section.heading.trim();
    const paragraphs = paragraphsFromBody(section.body);
    if (!heading || paragraphs.length === 0) return [];
    return [{ heading, paragraphs, index }];
  });
  if (visible.length === 0) return null;

  return (
    <div className="mt-12 space-y-12">
      {visible.map((section) => (
        <section key={`${section.heading}-${section.index}`}>
          <h2 className="font-serif text-2xl text-ink">{section.heading}</h2>
          {section.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex} className="mt-3 leading-relaxed text-muted">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
