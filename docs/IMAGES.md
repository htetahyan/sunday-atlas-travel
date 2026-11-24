# Image finder, vision gate and registry

New photos for blog posts (daily job) and for destinations/packages come from one pipeline:

Spend-aware order: everything that is free (metadata) happens before anything is downloaded,
and the vision model sees as few, as small images as possible.

1. **Search** (`scripts/lib/image-finder.mjs`): Wikimedia Commons API (no key; CC0, public domain,
   CC BY, CC BY-SA only). Commons is searched first within Featured pictures / Quality images,
   then in general. Pexels if `PEXELS_API_KEY` is set, Unsplash if `UNSPLASH_ACCESS_KEY` is set
   (Unsplash photos are hotlinked, as Unsplash's API terms require).
2. **Metadata filter** (no downloads): JPEG/WebP photos only (no PNG/SVG/GIF/TIFF graphics), long
   edge ≥ 2000 px, ≥ 2 MP, landscape (3:2 and 4:3 pass); title/categories/tags must not mention
   logo, sign, poster, map, text, caption, watermark, stitching errors, people, flags…
   (`scripts/lib/image-gate.mjs`); source id not already used on the site and no cached vision
   reject in the registry.
3. **Rank**: quality tier (Featured > Quality > Valued > none, from Commons categories and
   assessment data), then resolution band (≥ 12 MP, ≥ 6 MP, ≥ 2 MP), then relevance to the place.
4. **Preview + pHash**: a 500 px thumbnail of each finalist, in rank order; same source or pHash
   within 6 bits of any image in use (`content/image-registry.json`) is skipped.
5. **Vision gate**: at most **2 finalists per image slot**, stopping at the first pass, with a
   ≈512 px copy and a short JSON-only prompt to `nvidia/nemotron-3.5-super-vl-120b-a12b`
   (`NVIDIA_API_KEY`). Any of has_text / has_logo / has_watermark / has_border, a non-photo, a
   subject mismatch, a bad reply or a failed call rejects (fail closed). Each blog post has a
   budget of 12 vision calls (`IMAGE_FINDER_POST_VISION_CAP`; packages:
   `IMAGE_FINDER_PAGE_VISION_CAP`), and the count is logged. **Every verdict is cached in the
   registry**, so no file is ever sent to the model twice (failed calls are not cached).
6. **Upload** (`scripts/lib/cloudinary-upload.mjs`): the winner only, full size (1920 px), signed
   upload to Cloudinary `di4a4oz3o`, folder `sunday-atlas/blog/<slug>`,
   `sunday-atlas/packages/<slug>` or `sunday-atlas/destinations/<slug>`. Needs the
   `CLOUDINARY_URL` secret (`cloudinary://<api_key>:<api_secret>@di4a4oz3o`). Without it the blog
   job uses catalog photos.

Credits: CC BY / CC BY-SA / Unsplash photos carry `credit` (author, licence, source) and the blog
page shows a small "Photo: … / Wikimedia Commons, CC BY-SA 4.0" line.

Commands:

```bash
npm run test:images                      # offline unit tests (add -- --live to hit the vision model)
npm run images:registry                  # refresh the registry from content and list duplicates
npm run images:packages                  # dry run: what destinations/packages need, with suggestions
npm run images:packages -- --audit       # also audit existing images: metadata + pHash, no vision calls
npm run images:packages -- --audit --vision  # …plus the vision gate on each existing image (cached)
npm run images:packages -- --apply       # upload + write content JSON (then push to Sanity)
```
