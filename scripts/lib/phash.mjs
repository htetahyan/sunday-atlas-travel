/**
 * 64-bit DCT perceptual hash (pHash). 32×32 greyscale → 2-D DCT → top-left 8×8
 * (without the DC term) → bit = coefficient > median. Hex string of 16 chars.
 * Resizing, re-encoding and mild colour changes keep the distance small (≤ 6).
 */
import sharp from "sharp";

const N = 32;
const K = 8;
const COS = Array.from({ length: K }, (_, u) =>
  Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))),
);

/** pHash from a 32×32 greyscale pixel array (row-major, 1024 values). Pure; used by tests. */
export function phashFromPixels(px) {
  if (px.length !== N * N) throw new Error(`expected ${N * N} pixels`);
  const rows = Array.from({ length: N }, (_, y) =>
    Array.from({ length: K }, (_, u) => {
      let s = 0;
      for (let x = 0; x < N; x += 1) s += px[y * N + x] * COS[u][x];
      return s;
    }),
  );
  const coeffs = [];
  for (let v = 0; v < K; v += 1)
    for (let u = 0; u < K; u += 1) {
      let s = 0;
      for (let y = 0; y < N; y += 1) s += rows[y][u] * COS[v][y];
      coeffs.push(s);
    }
  const ac = coeffs.slice(1);
  const median = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)];
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nib = 0;
    for (let b = 0; b < 4; b += 1) nib = (nib << 1) | (coeffs[i + b] > median ? 1 : 0);
    hex += nib.toString(16);
  }
  return hex;
}

export async function phash(buffer) {
  const px = await sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(N, N, { fit: "fill" })
    .raw()
    .toBuffer();
  return phashFromPixels(Array.from(px));
}

const POP = Array.from({ length: 16 }, (_, n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1));

export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}
