/**
 * Send the same seven questions to BASE/api/chat and print locale, question, reply, and links.
 * Origin is http://localhost:8788. BASE defaults to http://127.0.0.1:8788.
 * Run twice against two `wrangler pages dev` processes that differ only by CHAT_MODEL_OVERRIDE.
 */
const base = (process.env.BASE || "http://127.0.0.1:8788").replace(/\/$/, "");
const origin = "http://localhost:8788";

const questions = [
  { locale: "ja", question: "3スタンのツアーについて教えてください。" },
  { locale: "ja", question: "カザフスタンではどんな旅ができますか。" },
  { locale: "ja", question: "5つのスタンのツアーは2名、4*だといくらですか。" },
  { locale: "de", question: "Was kostet die Four Stans Odyssey für 2 Personen, 4*?" },
  { locale: "de", question: "Gibt es eine Antarktis-Kreuzfahrt?" },
  { locale: "de", question: "Wie funktioniert eine Reiseanfrage?" },
  { locale: "en", question: "How does a trip with Sunday Atlas Travel work?" },
];

function formatLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return "(none)";
  return links
    .map((link) => {
      const title = link && typeof link.title === "string" ? link.title : "";
      const url = link && typeof link.url === "string" ? link.url : "";
      return `${title} ${url}`.trim();
    })
    .join(" | ");
}

async function main() {
  let failed = 0;
  for (const item of questions) {
    let status = 0;
    let body = null;
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: item.question, locale: item.locale }),
      });
      status = response.status;
      const text = await response.text();
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { reply: text };
      }
    } catch (error) {
      failed += 1;
      console.log(`locale: ${item.locale}`);
      console.log(`question: ${item.question}`);
      console.log(`reply: (request failed: ${error instanceof Error ? error.message : String(error)})`);
      console.log("links: (none)");
      console.log("");
      continue;
    }
    if (status !== 200) failed += 1;
    const reply = body && typeof body.reply === "string" ? body.reply : "";
    const error = body && body.error ? ` error=${body.error}` : "";
    console.log(`locale: ${item.locale}`);
    console.log(`question: ${item.question}`);
    console.log(`reply: ${reply || `(status ${status}${error})`}`);
    console.log(`links: ${formatLinks(body && body.links)}`);
    console.log("");
  }
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
