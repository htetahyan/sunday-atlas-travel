/** Small JPEG copy of a Cloudinary upload (for hashing / gating); other URLs unchanged. */
export function cldSmall(src, width = 512) {
  const m = String(src).match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/);
  return m ? `${m[1]}w_${width},c_limit,f_jpg,q_80/${m[2]}` : src;
}
