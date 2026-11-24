"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/getDictionary";

const loadChatPanel = () => import("./ChatPanel");
const ChatPanel = lazy(loadChatPanel);

type ChatCopy = Dictionary["chat"];

/**
 * Floating bubble only. The panel chunk loads on idle, and again on the first
 * pointer, focus, or click if idle has not run yet.
 */
export function ChatLauncher({ locale, chat }: { locale: Locale; chat: ChatCopy }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRequested = useRef(false);

  const prefetch = useCallback(() => {
    if (panelRequested.current) return;
    panelRequested.current = true;
    void loadChatPanel().catch(() => {
      panelRequested.current = false;
    });
  }, []);

  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => prefetch());
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => prefetch(), 200);
    return () => window.clearTimeout(id);
  }, [prefetch]);

  function toggle() {
    prefetch();
    setOpen((value) => !value);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-teal text-white shadow-card hover:bg-teal-dark motion-safe:transition-colors"
        aria-label={chat.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        onPointerEnter={prefetch}
        onFocus={prefetch}
      >
        <ChatIcon />
      </button>
      {open ? (
        <Suspense fallback={null}>
          <ChatPanel
            locale={locale}
            chat={chat}
            launcherRef={buttonRef}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.2 16.2 4 19.5l3.8-1.2A8 8 0 1 0 6.2 16.2z" />
    </svg>
  );
}
