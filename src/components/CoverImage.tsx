import { cldBlurUrl, cldSrcSet, cldUrl } from "@/lib/cloudinary";

/** A srcset candidate, so browsers that fall back to `src` do not fetch 1600px. */
const FALLBACK_WIDTH = 768;

/**
 * Content photo with an explicit pixel size. The parent supplies the box
 * (relative, overflow hidden, aspect ratio or height). A sand field and, for
 * Cloudinary URLs, a tiny blurred background sit behind the bitmap.
 */
export function CoverImage({
  src,
  alt,
  width,
  height,
  sizes,
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  priority?: boolean;
}) {
  const url = cldUrl(src, { width: FALLBACK_WIDTH });
  const srcSet = cldSrcSet(src);
  const blur = cldBlurUrl(src);
  return (
    <span
      className="atlas-photo absolute inset-0"
      style={blur ? { backgroundImage: `url("${blur}")` } : undefined}
    >
      <img
        src={url}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "low"}
        decoding="async"
        className="h-full w-full object-cover"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </span>
  );
}
