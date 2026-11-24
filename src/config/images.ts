/**
 * Homepage hero and the default Open Graph image.
 * Width and height are the real pixel size of the photo
 * (local original: public/images/hero/home.jpg).
 * Alt text lives in the dictionaries as home.heroImageAlt.
 */
export const heroImage = {
  src: "https://res.cloudinary.com/di4a4oz3o/image/upload/v1792317592/sunday-atlas/home_xqynbs.jpg",
  width: 1600,
  height: 1067,
} as const;

/** Default social image for pages that do not pass their own photo. */
export const defaultOgImage = heroImage;
