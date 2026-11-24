/**
 * Resize gallery originals and recompress every JPEG under public/images.
 *
 * New files are read from /tmp/gallery-src (never committed) and written to
 * public/images/gallery/{entry}/{file}.jpg. Existing JPEGs are rewritten in
 * place, keeping their filenames.
 *
 * Each file is at most 1600px wide, progressive mozjpeg, metadata stripped.
 * Quality starts at 78 and steps down until the file is at most 300KB.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const MAX_WIDTH = 1600;
const MAX_BYTES = 300 * 1000;
const QUALITIES = [78, 70, 62, 54, 46, 40, 34];
const SRC = "/tmp/gallery-src";

/** Original filename in /tmp/gallery-src → public path. */
const GALLERY_JOBS = [
  ["35995450.jpg", "public/images/gallery/kyrgyzstan/01-issyk-kul.jpg"],
  ["17533368.jpg", "public/images/gallery/kyrgyzstan/02-tash-rabat.jpg"],
  ["35755657.jpg", "public/images/gallery/kyrgyzstan/03-horses-pasture.jpg"],
  ["13542277.jpg", "public/images/gallery/kyrgyzstan/04-alpine-lake.jpg"],
  ["27532623.jpg", "public/images/gallery/kyrgyzstan/05-bishkek.jpg"],
  ["33999679.jpg", "public/images/gallery/kyrgyzstan/06-ala-too-ridges.jpg"],
  ["33674485.jpg", "public/images/gallery/kyrgyzstan-8-day-nomad-trails/01-kel-suu.jpg"],
  ["13985846.jpg", "public/images/gallery/kyrgyzstan-8-day-nomad-trails/02-horses-naryn.jpg"],
  ["11927132.jpg", "public/images/gallery/kyrgyzstan-8-day-nomad-trails/03-issyk-kul-pier.jpg"],
  ["35755650.jpg", "public/images/gallery/kyrgyzstan-8-day-nomad-trails/04-yurt-mountains.jpg"],
  ["37732558.jpg", "public/images/gallery/kyrgyzstan-8-day-nomad-trails/05-yurt-spruce-pasture.jpg"],
  ["840668.jpg", "public/images/gallery/kyrgyzstan-8-day-nomad-trails/06-yurt-pasture.jpg"],
];

async function encode(input) {
  let width = MAX_WIDTH;
  let chosen = null;
  while (width >= 800) {
    for (const quality of QUALITIES) {
      const buf = await sharp(input)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true, progressive: true })
        .toBuffer();
      const meta = await sharp(buf).metadata();
      chosen = { buf, width: meta.width, height: meta.height, bytes: buf.length, quality };
      if (buf.length <= MAX_BYTES) return chosen;
    }
    width -= 200;
  }
  if (!chosen) throw new Error("encode produced nothing");
  return chosen;
}

async function writeOptimized(input, dest) {
  const before = Buffer.isBuffer(input) ? input.length : (await readFile(input)).length;
  const result = await encode(input);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, result.buf);
  const rel = path.relative(ROOT, dest);
  console.log(
    `${rel}  ${result.width}x${result.height}  q${result.quality}  ${before} -> ${result.bytes}`,
  );
  return { file: rel, ...result, buf: undefined };
}

async function walkJpegs(dir) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walkJpegs(full)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jpg")) found.push(full);
  }
  return found;
}

const report = [];

for (const [srcName, destRel] of GALLERY_JOBS) {
  const src = path.join(SRC, srcName);
  report.push(await writeOptimized(src, path.join(ROOT, destRel)));
}

const existing = await walkJpegs(path.join(ROOT, "public/images"));
const fresh = new Set(report.map((item) => path.join(ROOT, item.file)));
for (const file of existing) {
  if (fresh.has(file)) continue;
  report.push(await writeOptimized(file, file));
}

const summary = report.map(({ file, width, height, bytes, quality }) => ({
  file,
  width,
  height,
  bytes,
  quality,
}));
await writeFile("/tmp/image-meta.json", JSON.stringify(summary, null, 2));
const max = Math.max(...summary.map((item) => item.bytes));
console.log(`files ${summary.length}  max ${max}`);
if (max > MAX_BYTES) process.exit(1);
