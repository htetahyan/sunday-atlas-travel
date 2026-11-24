"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { cldBlurUrl, cldSrcSet, cldUrl } from "@/lib/cloudinary";
import { fill } from "@/lib/paths";

const Lightbox = dynamic(() => import("./Lightbox").then((mod) => mod.Lightbox), { ssr: false });

/** One photo already resolved to the page locale. */
export type GalleryFrame = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

export type GalleryLabels = {
  title: string;
  open: string;
  viewAll: string;
  dialogLabel: string;
  close: string;
  previous: string;
  next: string;
  counter: string;
};

/** Thumbs fill one desktop row (4) and two mobile rows (2×2) before the overflow tile. */
const VISIBLE_THUMBS = 4;

/** Fallback `src` is a srcset candidate so older browsers skip the 1600px file. */
const FALLBACK_WIDTH = 768;

/**
 * Hero width: full content column below `lg`, two thirds of the page grid at `lg`.
 * Thumb width: full carousel slide on phones, quarter row at `md`, side cell at `lg`.
 */
const HERO_SIZES =
  "(min-width: 1200px) 765px, (min-width: 1024px) calc(66.67vw - 2.167rem), calc(100vw - 2.5rem)";
const THUMB_SIZES =
  "(min-width: 1200px) 190px, (min-width: 1024px) calc(16.667vw - 0.917rem), (min-width: 768px) calc(25vw - 1.1875rem), calc(100vw - 2.5rem)";

type Props = {
  images: GalleryFrame[];
  labels: GalleryLabels;
};

function openLabel(labels: GalleryLabels, image: GalleryFrame, index: number, total: number) {
  return fill(labels.open, { n: index + 1, total, alt: image.alt });
}

const frameClass =
  "group atlas-photo relative block w-full min-w-full shrink-0 snap-center cursor-zoom-in overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-cream md:min-w-0";

function FrameImage({
  image,
  sizes,
  priority = false,
}: {
  image: GalleryFrame;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <img
      src={cldUrl(image.src, { width: FALLBACK_WIDTH })}
      srcSet={cldSrcSet(image.src)}
      sizes={sizes}
      alt={image.alt}
      width={image.width}
      height={image.height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "low"}
      draggable={false}
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105 motion-reduce:!transform-none motion-reduce:!transition-none"
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}

export function Gallery({ images, labels }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ x: 0, y: 0, moved: false });

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || images.length < 2) return;
    const media = window.matchMedia("(max-width: 767px)");
    let observer: IntersectionObserver | null = null;

    const connect = () => {
      observer?.disconnect();
      observer = null;
      if (!media.matches) return;
      observer = new IntersectionObserver(
        (entries) => {
          const best = entries
            .filter((entry) => entry.isIntersecting)
            .reduce<IntersectionObserverEntry | null>((top, entry) => {
              if (!top || entry.intersectionRatio > top.intersectionRatio) return entry;
              return top;
            }, null);
          if (!best) return;
          const value = Number((best.target as HTMLElement).dataset.slide);
          if (Number.isNaN(value)) return;
          setCurrent((prev) => (prev === value ? prev : value));
        },
        { root, threshold: [0.6, 0.75] },
      );
      root.querySelectorAll<HTMLElement>("[data-slide]").forEach((slide) => observer?.observe(slide));
    };

    connect();
    media.addEventListener("change", connect);
    return () => {
      media.removeEventListener("change", connect);
      observer?.disconnect();
    };
  }, [images.length]);

  if (images.length === 0) return null;

  const hero = images[0];
  const thumbs = images.slice(1);
  const shown = thumbs.slice(0, VISIBLE_THUMBS);
  const extras = thumbs.slice(VISIBLE_THUMBS);
  const hidden = thumbs.length - shown.length;
  const total = images.length;
  const beside = shown.length > 0;
  const heroBlur = cldBlurUrl(hero.src);

  function scrollToSlide(index: number) {
    setCurrent(index);
    const root = scrollerRef.current;
    const slide = root?.querySelector<HTMLElement>(`[data-slide="${index}"]`);
    if (!root || !slide) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const left = root.scrollLeft + (slide.getBoundingClientRect().left - root.getBoundingClientRect().left);
    root.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
  }

  function openAt(index: number) {
    if (drag.current.moved) {
      drag.current.moved = false;
      return;
    }
    setActiveIndex(index);
  }

  return (
    <section
      aria-label={labels.title}
      className={
        beside
          ? "flex w-full min-w-0 max-w-full flex-col gap-2 sm:gap-3 lg:grid lg:grid-cols-3 lg:items-stretch lg:gap-3"
          : "flex w-full min-w-0 max-w-full flex-col gap-2 sm:gap-3"
      }
    >
      <div
        ref={scrollerRef}
        className="gallery-scroller flex w-full min-w-0 max-w-full snap-x snap-mandatory overflow-x-auto md:contents"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 8) {
            drag.current.moved = true;
          }
        }}
        onClickCapture={(event) => {
          if (!drag.current.moved) return;
          event.preventDefault();
          event.stopPropagation();
          drag.current.moved = false;
        }}
      >
        <button
          type="button"
          data-slide={0}
          className={`${frameClass} aspect-[4/3] rounded-2xl md:aspect-video lg:aspect-auto lg:h-[min(60vh,520px)] ${beside ? "lg:col-span-2" : ""}`}
          style={heroBlur ? { backgroundImage: `url("${heroBlur}")` } : undefined}
          aria-label={openLabel(labels, hero, 0, total)}
          onClick={() => openAt(0)}
        >
          <FrameImage image={hero} sizes={HERO_SIZES} priority />
        </button>

        {beside ? (
          <div className="contents md:grid md:grid-cols-4 md:gap-3 lg:h-[min(60vh,520px)] lg:min-h-0 lg:grid-cols-2 lg:grid-rows-2 lg:gap-3">
            {shown.map((image, thumbIndex) => {
              const index = thumbIndex + 1;
              const isOverflow = hidden > 0 && thumbIndex === shown.length - 1;
              const blur = cldBlurUrl(image.src);
              return (
                <button
                  key={`${image.src}-${index}`}
                  type="button"
                  data-slide={index}
                  className={`${frameClass} aspect-[4/3] rounded-xl lg:aspect-auto lg:h-full`}
                  style={blur ? { backgroundImage: `url("${blur}")` } : undefined}
                  aria-label={openLabel(labels, image, index, total)}
                  onClick={() => openAt(index)}
                >
                  <FrameImage image={image} sizes={THUMB_SIZES} />
                  {isOverflow ? (
                    <span className="absolute inset-0 hidden flex-col items-center justify-center gap-1 bg-ink/70 px-2 text-center text-white md:flex">
                      <span className="font-serif text-3xl leading-none">+{hidden}</span>
                      <span className="text-xs font-semibold leading-snug sm:text-sm">
                        {fill(labels.viewAll, { count: total })}
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
            {extras.map((image, extraIndex) => {
              const index = VISIBLE_THUMBS + 1 + extraIndex;
              const blur = cldBlurUrl(image.src);
              return (
                <button
                  key={`${image.src}-${index}`}
                  type="button"
                  data-slide={index}
                  className={`${frameClass} aspect-[4/3] rounded-xl md:hidden`}
                  style={blur ? { backgroundImage: `url("${blur}")` } : undefined}
                  aria-label={openLabel(labels, image, index, total)}
                  onClick={() => openAt(index)}
                >
                  <FrameImage image={image} sizes="calc(100vw - 2.5rem)" />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {total > 1 ? (
        <div className="flex flex-col items-center gap-2 md:hidden">
          <p className="text-xs tabular-nums text-muted" aria-live="polite">
            {fill(labels.counter, { current: current + 1, total })}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-1">
            {images.map((image, index) => (
              <button
                key={`${image.src}-dot-${index}`}
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center"
                aria-label={fill(labels.counter, { current: index + 1, total })}
                aria-current={index === current ? "true" : undefined}
                onClick={() => scrollToSlide(index)}
              >
                <span
                  aria-hidden="true"
                  className={`block h-1.5 w-1.5 rounded-full ${index === current ? "bg-teal" : "bg-line"}`}
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {activeIndex !== null ? (
        <Lightbox
          images={images}
          initialIndex={activeIndex}
          labels={labels}
          onClose={() => setActiveIndex(null)}
        />
      ) : null}
    </section>
  );
}
