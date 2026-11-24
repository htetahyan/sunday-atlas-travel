type JsonLdNode = Record<string, unknown>;

type JsonLdProps = {
  /** One schema object, or several. Omit it and the component renders nothing. */
  data?: JsonLdNode | JsonLdNode[] | null;
};

function serialize(data: JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Server-rendered JSON-LD. No next/script and no client effect. */
export function JsonLd({ data }: JsonLdProps) {
  if (data == null) return null;
  if (Array.isArray(data) && data.length === 0) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serialize(data) }}
    />
  );
}
