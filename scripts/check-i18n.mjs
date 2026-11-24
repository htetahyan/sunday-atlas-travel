import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dictionariesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "i18n",
  "dictionaries",
);
const targets = ["de", "fr", "ja", "es", "zh"];

function load(locale) {
  const file = join(dictionariesDir, `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function kindOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function tokensIn(value) {
  return [...value.matchAll(/\{[^{}]+\}/g)].map((match) => match[0]);
}

const ICU_RE = /\{\s*\w+\s*,\s*(?:plural|select|selectordinal|number|date|time)\b|\{\{|\}\}|\b(?:one|other|few|many)\s*\{[^{}]*#/;

function compare(source, target, path, problems) {
  if (target === undefined) {
    problems.push(`${path || "(root)"} is missing`);
    return;
  }

  const sourceKind = kindOf(source);
  const targetKind = kindOf(target);
  if (sourceKind !== targetKind) {
    problems.push(`${path || "(root)"} is ${targetKind}, expected ${sourceKind}`);
    return;
  }

  if (sourceKind === "array") {
    if (source.length !== target.length) {
      problems.push(
        `${path} has ${target.length} item(s), expected ${source.length}`,
      );
      return;
    }
    source.forEach((item, index) => {
      compare(item, target[index], `${path}[${index}]`, problems);
    });
    return;
  }

  if (sourceKind === "object") {
    const sourceKeys = Object.keys(source);
    const targetKeys = Object.keys(target);
    const sourceKeySet = new Set(sourceKeys);
    for (const key of targetKeys) {
      if (!sourceKeySet.has(key)) {
        problems.push(`${path ? `${path}.` : ""}${key} is an extra key`);
      }
    }
    if (sourceKeys.join("\0") !== targetKeys.join("\0")) {
      problems.push(`${path || "(root)"} keys differ in order or name`);
    }
    for (const key of sourceKeys) {
      compare(source[key], target[key], path ? `${path}.${key}` : key, problems);
    }
    return;
  }

  if (sourceKind === "string") {
    if (ICU_RE.test(target)) {
      problems.push(`${path} contains ICU/mustache syntax; use simple {name} tokens filled with fill()`);
    }
    if (target === "" && source !== "") {
      problems.push(`${path} is an empty string`);
    }
    const expected = tokensIn(source);
    const actual = new Set(tokensIn(target));
    for (const token of expected) {
      if (!actual.has(token)) {
        problems.push(`${path} is missing ${token}`);
      }
    }
    return;
  }

  if ((sourceKind === "number" || sourceKind === "boolean") && source !== target) {
    problems.push(`${path} ${sourceKind} is ${target}, expected ${source}`);
  }
}

const problems = [];
let source;

try {
  source = load("en");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`i18n dictionary parity\n  en.json  failed to load\n\n${message}`);
  process.exit(1);
}

(function scanSource(value, path) {
  if (typeof value === "string") {
    if (ICU_RE.test(value)) problems.push(`en: ${path} contains ICU/mustache syntax; use simple {name} tokens filled with fill()`);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) scanSource(child, path ? `${path}.${key}` : key);
  }
})(source, "");

const lines = ["i18n dictionary parity", "  en.json  source"];

for (const locale of targets) {
  const localeProblems = [];
  try {
    const dictionary = load(locale);
    if (dictionary._status !== "translated") {
      localeProblems.push(
        `_status is ${JSON.stringify(dictionary._status)}, expected "translated"`,
      );
    }
    compare(source, dictionary, "", localeProblems);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    localeProblems.push(`failed to load (${message})`);
  }

  for (const problem of localeProblems) {
    problems.push(`${locale}: ${problem}`);
  }
  lines.push(
    `  ${locale}.json  ${localeProblems.length === 0 ? "ok" : `${localeProblems.length} problem(s)`}`,
  );
}

console.log(lines.join("\n"));

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log("All target dictionaries match en.json.");
