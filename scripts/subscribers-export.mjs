#!/usr/bin/env node
/**
 * Export email subscribers (Sanity type "subscriber", written by POST /api/subscribe) to CSV.
 *   SANITY_API_WRITE_TOKEN=... node scripts/subscribers-export.mjs [out.csv]
 * Subscriber documents have private ids ("subscribers.<hash>"), so a token is required.
 */
import { writeFileSync } from "node:fs";

const token = process.env.SANITY_API_WRITE_TOKEN || process.env.SANITY_READ_TOKEN || process.env.SANITY_TOKEN;
if (!token) {
  console.error("Set SANITY_API_WRITE_TOKEN (or SANITY_READ_TOKEN) to read subscribers.");
  process.exit(1);
}
const projectId = process.env.SANITY_PROJECT_ID || "mi09tcmc";
const dataset = process.env.SANITY_DATASET || "production";
const query = '*[_type == "subscriber"] | order(createdAt desc) {email, locale, sourcePage, placement, createdAt}';
const url = `https://${projectId}.api.sanity.io/v2023-10-01/data/query/${dataset}?query=${encodeURIComponent(query)}&perspective=raw`;
const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
if (!response.ok) {
  console.error(`Sanity query failed: HTTP ${response.status}`);
  process.exit(1);
}
const { result = [] } = await response.json();
const cell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const rows = [["email", "locale", "sourcePage", "placement", "createdAt"]];
for (const row of result) rows.push([row.email, row.locale, row.sourcePage, row.placement, row.createdAt]);
const csv = rows.map((row) => row.map(cell).join(",")).join("\n") + "\n";
const out = process.argv[2];
if (out) {
  writeFileSync(out, csv);
  console.log(`${result.length} subscriber(s) written to ${out}`);
} else {
  process.stdout.write(csv);
}
