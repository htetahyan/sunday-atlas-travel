"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const SELECTOR = "[data-reveal]:not(.reveal-done), [data-reveal-group]:not(.reveal-done)";

export function prefersMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    "IntersectionObserver" in window &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Scroll-reveal for elements marked data-reveal or data-reveal-group.
 * Only elements that start BELOW the viewport are hidden (class reveal-pending), so nothing
 * the visitor already sees fades out, LCP is untouched, and server HTML is fully visible
 * without JS. Opacity/transform only: no layout shift. Off under prefers-reduced-motion.
 */
export function MotionObserver() {
  const pathname = usePathname();

  useEffect(() => {
    if (!prefersMotion()) return;
    const timers: number[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const node = entry.target as HTMLElement;
          observer.unobserve(node);
          node.classList.remove("reveal-pending");
          node.classList.add("reveal-done");
          // Drop the slow reveal transition afterwards so hover effects stay snappy.
          timers.push(window.setTimeout(() => node.classList.remove("reveal-armed"), 1400));
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
    );
    const fold = window.innerHeight;
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach((node) => {
      if (node.getBoundingClientRect().top < fold) {
        node.classList.add("reveal-done");
        return;
      }
      node.classList.add("reveal-armed", "reveal-pending");
      observer.observe(node);
    });
    return () => {
      observer.disconnect();
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [pathname]);

  return null;
}
