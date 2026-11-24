/** Default srcset widths for content photos, including phone-sized candidates. */
export const CLOUDINARY_SRCSET_WIDTHS = [320, 480, 640, 768, 1024, 1280, 1600, 1920] as const;

const UPLOAD_URL =
  /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

/** True for a Cloudinary image delivery URL under `/image/upload/`. */
export function isCloudinaryUploadUrl(src: string): boolean {
  return UPLOAD_URL.test(src);
}

/**
 * First path segment after `/upload/` is a transform when it is a comma list
 * (`f_auto,q_auto`) or a single `name_value` action (`w_800`). A version
 * (`v123`) or a public id (folder or `file.jpg`) is not.
 */
function firstSegmentIsTransform(rest: string): boolean {
  const first = rest.split("/")[0] ?? "";
  if (!first || /^v\d+$/.test(first)) return false;
  if (first.includes(",")) return true;
  if (/\.[a-z0-9]{2,5}$/i.test(first)) return false;
  return /^[a-z]{1,5}_[a-z0-9]+$/i.test(first);
}

/**
 * Insert `f_auto,q_auto` (and optional `w_<width>,c_limit`) after `/upload/`
 * on Cloudinary image URLs. Local paths and other hosts are returned as-is.
 * Already-transformed Cloudinary URLs are not modified.
 */
export function cldUrl(src: string, opts?: { width?: number }): string {
  const match = src.match(UPLOAD_URL);
  if (!match) return src;
  const [, prefix, rest] = match;
  if (firstSegmentIsTransform(rest)) return src;
  const parts = ["f_auto", "q_auto:good"];
  if (opts?.width != null && Number.isFinite(opts.width) && opts.width > 0) {
    parts.push(`w_${Math.round(opts.width)}`, "c_limit");
  }
  return `${prefix}${parts.join(",")}/${rest}`;
}

/**
 * Tiny blurred placeholder for a Cloudinary upload URL.
 * Inserts `e_blur:1000,q_1,w_32,f_auto` after `/upload/`.
 * Local paths and other hosts return undefined.
 */
export function cldBlurUrl(src: string): string | undefined {
  const match = src.match(UPLOAD_URL);
  if (!match) return undefined;
  const [, prefix, rest] = match;
  return `${prefix}e_blur:1000,q_1,w_32,f_auto/${rest}`;
}

const OG_TRANSFORM = "c_fill,g_auto,w_1200,h_630,f_jpg,q_auto";

/**
 * 1200×630 JPEG crop for social crawlers. Inserts the transform after `/upload/`.
 * Local paths and other hosts are returned unchanged. `f_jpg` because some
 * crawlers reject WebP and AVIF.
 */
export function cldOgImage(src: string): string {
  const match = src.match(UPLOAD_URL);
  if (!match) return src;
  const [, prefix, rest] = match;
  if (rest === OG_TRANSFORM || rest.startsWith(`${OG_TRANSFORM}/`)) return src;
  return `${prefix}${OG_TRANSFORM}/${rest}`;
}

/**
 * `srcset` for a Cloudinary URL. Returns undefined for local paths and other hosts.
 */
export function cldSrcSet(
  src: string,
  widths: readonly number[] = CLOUDINARY_SRCSET_WIDTHS,
): string | undefined {
  if (!isCloudinaryUploadUrl(src)) return undefined;
  return widths.map((width) => `${cldUrl(src, { width })} ${width}w`).join(", ");
}

/** Structured-data crops of a tour's main photo: 1:1, 4:3 and 16:9 JPEG. */
export const SCHEMA_IMAGE_CROPS = [
  { width: 1200, height: 1200 },
  { width: 1600, height: 1200 },
  { width: 1920, height: 1080 },
] as const;

/**
 * `c_fill,g_auto,w_<w>,h_<h>,f_jpg` crop of a Cloudinary upload URL, inserted
 * after `/upload/` so the version and public id stay as they are. Returns
 * undefined for local paths, other hosts and already-transformed URLs.
 */
export function cldCrop(src: string, width: number, height: number): string | undefined {
  const match = src.match(UPLOAD_URL);
  if (!match) return undefined;
  const [, prefix, rest] = match;
  if (firstSegmentIsTransform(rest)) return undefined;
  return `${prefix}c_fill,g_auto,w_${width},h_${height},f_jpg/${rest}`;
}
