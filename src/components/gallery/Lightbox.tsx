"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cldBlurUrl, cldSrcSet, cldUrl } from "@/lib/cloudinary";
import { fill } from "@/lib/paths";
import type { GalleryFrame, GalleryLabels } from "./Gallery";

const LIGHTBOX_WIDTH = 1600;
const LIGHTBOX_SIZES = "(min-width: 1400px) 1024px, 92vw";

type Props = {
  images: GalleryFrame[];
  initialIndex: number;
  labels: GalleryLabels;
  onClose: () => void;
};

function wrap(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isNear(index: number, current: number, length: number): boolean {
  if (length <= 1) return true;
  const delta = Math.abs(index - current);
  return Math.min(delta, length - delta) <= 1;
}

export function Lightbox({ images, initialIndex, labels, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const indexRef = useRef(wrap(initialIndex, images.length));
  const programmatic = useRef(false);
  const programmaticTimer = useRef<number | null>(null);
  const closing = useRef(false);
  const drag = useRef({ x: 0, y: 0, moved: false });
  const closeTimer = useRef<number | null>(null);
  const captionId = useId();
  const [index, setIndex] = useState(() => wrap(initialIndex, images.length));
  const [phase, setPhase] = useState<"enter" | "open" | "leave">("enter");

  onCloseRef.current = onClose;
  indexRef.current = index;

  useLayoutEffect(() => {
    const track = trackRef.current;
    const slide = track?.querySelector<HTMLElement>(`[data-lightbox-index="${indexRef.current}"]`);
    if (track && slide) {
      programmatic.current = true;
      track.scrollLeft = slide.offsetLeft;
      programmatic.current = false;
    }
    if (prefersReducedMotion()) {
      setPhase("open");
      return;
    }
    const id = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement ? active : null;
    closeRef.current?.focus();

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      const length = images.length;
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key === "ArrowLeft" && length > 1) {
        event.preventDefault();
        goTo(indexRef.current - 1);
        return;
      }
      if (event.key === "ArrowRight" && length > 1) {
        event.preventDefault();
        goTo(indexRef.current + 1);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((item) => !item.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeElement = document.activeElement;
      if (!dialogRef.current.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      if (programmaticTimer.current) window.clearTimeout(programmaticTimer.current);
      const opener = returnFocus.current;
      returnFocus.current = null;
      if (opener?.isConnected) opener.focus();
    };
  }, [images.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || images.length < 2) return;
    let frame = 0;
    const finishProgrammatic = () => {
      programmatic.current = false;
    };
    const onScroll = () => {
      if (programmatic.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const slides = track.querySelectorAll<HTMLElement>("[data-lightbox-index]");
        const center = track.scrollLeft + track.clientWidth / 2;
        let best = indexRef.current;
        let bestDist = Infinity;
        slides.forEach((slide) => {
          const mid = slide.offsetLeft + slide.offsetWidth / 2;
          const dist = Math.abs(mid - center);
          if (dist < bestDist) {
            bestDist = dist;
            best = Number(slide.dataset.lightboxIndex);
          }
        });
        if (Number.isNaN(best)) return;
        setIndex((current) => (current === best ? current : best));
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("scrollend", finishProgrammatic);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("scrollend", finishProgrammatic);
    };
  }, [images.length]);

  useEffect(() => {
    if (images.length < 2) return;
    const length = images.length;
    const neighbours = [images[wrap(index + 1, length)], images[wrap(index - 1, length)]];
    const preloaded = neighbours.map((frame) => {
      const img = new window.Image();
      const srcSet = cldSrcSet(frame.src);
      if (srcSet) img.srcset = srcSet;
      img.sizes = LIGHTBOX_SIZES;
      img.src = cldUrl(frame.src, { width: LIGHTBOX_WIDTH });
      return img;
    });
    return () => {
      preloaded.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [images, index]);

  function goTo(next: number) {
    const length = images.length;
    if (length === 0) return;
    const wrapped = wrap(next, length);
    setIndex(wrapped);
    const track = trackRef.current;
    const slide = track?.querySelector<HTMLElement>(`[data-lightbox-index="${wrapped}"]`);
    if (!track || !slide) return;
    const left = slide.offsetLeft;
    if (Math.abs(track.scrollLeft - left) < 2) {
      programmatic.current = false;
      return;
    }
    programmatic.current = true;
    const reduced = prefersReducedMotion();
    track.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
    if (programmaticTimer.current) window.clearTimeout(programmaticTimer.current);
    programmaticTimer.current = window.setTimeout(() => {
      programmatic.current = false;
    }, reduced ? 80 : 450);
  }

  function closeUnlessDrag() {
    if (drag.current.moved) {
      drag.current.moved = false;
      return;
    }
    requestClose();
  }

  function requestClose() {
    if (closing.current) return;
    closing.current = true;
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    setPhase("leave");
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), 180);
  }

  if (images.length === 0 || typeof document === "undefined") return null;

  const current = wrap(index, images.length);
  const image = images[current];
  const total = images.length;
  const counter = fill(labels.counter, { current: current + 1, total });
  const iconButton =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialogLabel}
      aria-describedby={captionId}
      data-phase={phase}
      className="lightbox-overlay fixed inset-0 z-[90] flex flex-col bg-ink/90"
    >
      <div className="flex justify-end p-3 sm:p-4">
        <button
          ref={closeRef}
          type="button"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-semibold text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          onClick={requestClose}
        >
          <span aria-hidden="true" className="text-xl leading-none">
            ×
          </span>
          {labels.close}
        </button>
      </div>

      <div className="relative min-h-0 w-full min-w-0 flex-1">
        <div
          ref={trackRef}
          className="lightbox-track relative flex h-full w-full min-w-0 snap-x snap-mandatory overflow-x-auto"
          onPointerDown={(event) => {
            drag.current = { x: event.clientX, y: event.clientY, moved: false };
          }}
          onPointerMove={(event) => {
            if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 8) {
              drag.current.moved = true;
            }
          }}
        >
          {images.map((frame, frameIndex) => {
            const blur = cldBlurUrl(frame.src);
            const eager = isNear(frameIndex, current, total);
            return (
              <div
                key={`${frame.src}-${frameIndex}`}
                data-lightbox-index={frameIndex}
                className="flex h-full w-full shrink-0 snap-center items-center justify-center px-4 sm:px-16"
                onClick={closeUnlessDrag}
              >
                <figure
                  className="lightbox-frame atlas-photo relative aspect-[3/2] max-w-full"
                  style={blur ? { backgroundImage: `url("${blur}")` } : undefined}
                  onClick={(event) => event.stopPropagation()}
                >
                  <img
                    src={cldUrl(frame.src, { width: LIGHTBOX_WIDTH })}
                    srcSet={cldSrcSet(frame.src)}
                    sizes={LIGHTBOX_SIZES}
                    alt={frame.alt}
                    width={frame.width}
                    height={frame.height}
                    loading={eager ? "eager" : "lazy"}
                    fetchPriority={frameIndex === current ? "high" : "low"}
                    decoding="async"
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-contain"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                </figure>
              </div>
            );
          })}
        </div>
        {total > 1 ? (
          <>
            <button
              type="button"
              className={`${iconButton} absolute left-3 top-1/2 z-10 -translate-y-1/2 sm:left-5`}
              aria-label={labels.previous}
              onClick={() => goTo(current - 1)}
            >
              <Chevron direction="left" />
            </button>
            <button
              type="button"
              className={`${iconButton} absolute right-3 top-1/2 z-10 -translate-y-1/2 sm:right-5`}
              aria-label={labels.next}
              onClick={() => goTo(current + 1)}
            >
              <Chevron direction="right" />
            </button>
          </>
        ) : null}
      </div>

      <div id={captionId} aria-live="polite" className="mx-auto w-full max-w-3xl px-5 pb-6 pt-4 text-center">
        <p className="text-sm leading-relaxed text-white">{image.alt}</p>
        <p className="mt-1 text-sm tabular-nums text-white/75">{counter}</p>
      </div>
    </div>,
    document.body,
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "left" ? <path d="M15 6 9 12l6 6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  );
}
