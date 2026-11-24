"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/getDictionary";
import { fill } from "@/lib/paths";

type ChatCopy = Dictionary["chat"];

type ChatLink = { title: string; url: string };

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  links?: ChatLink[];
};

/** Messages kept in the request body. The API trims further on its side. */
const HISTORY_TURNS = 8;
const MESSAGE_MAX = 500;

const FOCUSABLE =
  "button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

type Props = {
  locale: Locale;
  chat: ChatCopy;
  launcherRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
};

export default function ChatPanel({ locale, chat, launcherRef, onClose }: Props) {
  const titleId = useId();
  const inputId = useId();
  const counterId = useId();
  const disclaimerId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef(false);
  const [messages, setMessages] = useState<ChatTurn[]>(() => readStored(locale));
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);

  onCloseRef.current = onClose;
  const contactHref = `/${locale}/contact/`;

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(locale), JSON.stringify(messages));
    } catch {
      // Private mode or a full quota. The thread still works for this view.
    }
  }, [locale, messages]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    log.scrollTo({ top: log.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const mobileQuery = window.matchMedia("(max-width: 639px)");

    const syncScrollLock = () => {
      if (mobileQuery.matches) {
        html.style.overflow = "hidden";
        body.style.overflow = "hidden";
      } else {
        html.style.overflow = previousHtmlOverflow;
        body.style.overflow = previousBodyOverflow;
      }
    };
    syncScrollLock();
    mobileQuery.addEventListener("change", syncScrollLock);

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = focusableItems(dialogRef.current);
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
      mobileQuery.removeEventListener("change", syncScrollLock);
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      abortRef.current?.abort();
      const opener = launcherRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [launcherRef]);

  useEffect(() => {
    if (pending) return;
    const textarea = textareaRef.current;
    const dialog = dialogRef.current;
    if (!textarea || !dialog) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && dialog.contains(active)) return;
    textarea.focus({ preventScroll: true });
  }, [pending]);

  function submit(raw: string) {
    const message = raw.trim();
    if (!message || pendingRef.current || message.length > MESSAGE_MAX) return;
    pendingRef.current = true;
    const history = messages.slice(-HISTORY_TURNS).map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));
    if (message === draft.trim()) setDraft("");
    setMessages((current) => [...current, { role: "user", content: message }]);
    setPending(true);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    void (async () => {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, locale, history }),
          signal: controller.signal,
        });
        const reply = await readReply(response);
        if (controller.signal.aborted) return;
        if (!reply) {
          setMessages((current) => [...current, networkTurn(chat)]);
          return;
        }
        setMessages((current) => [...current, reply]);
      } catch {
        if (controller.signal.aborted) return;
        setMessages((current) => [...current, networkTurn(chat)]);
      } finally {
        if (!controller.signal.aborted) {
          pendingRef.current = false;
          setPending(false);
        }
      }
    })();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(draft);
  }

  function onTextKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit(draft);
  }

  const showSuggestions = messages.length === 0 && !pending;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy={pending}
      className="fixed inset-0 z-[60] flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none bg-card text-ink shadow-card sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[min(600px,calc(100dvh-7rem))] sm:max-h-[600px] sm:w-[380px] sm:rounded-2xl sm:border sm:border-line"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 bg-teal px-4 py-3 text-white">
        <h2 id={titleId} className="font-serif text-lg leading-tight">
          {chat.title}
        </h2>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15"
          aria-label={chat.close}
          onClick={onClose}
        >
          <span aria-hidden="true" className="text-2xl leading-none">
            ×
          </span>
        </button>
      </div>

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-cream">
        <div className="flex flex-col gap-3 p-3" role="log" aria-live="polite" aria-relevant="additions">
          <AssistantBubble>
            <p className="whitespace-pre-wrap">{chat.welcome}</p>
          </AssistantBubble>
          {messages.map((message, index) =>
            message.role === "user" ? (
              <div key={index} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-teal px-3 py-2 text-sm leading-relaxed text-white">
                  {message.content}
                </p>
              </div>
            ) : (
              <AssistantBubble key={index}>
                <p className="whitespace-pre-wrap">
                  <ContactPhrase
                    text={message.content}
                    linkText={chat.contactLink}
                    href={contactHref}
                    onNavigate={onClose}
                  />
                </p>
                {message.links && message.links.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={chat.linksLabel}>
                    {message.links.map((link) => (
                      <Link
                        key={link.url}
                        href={link.url}
                        onClick={onClose}
                        className="inline-flex max-w-full rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold text-teal hover:bg-teal-soft"
                      >
                        {link.title}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </AssistantBubble>
            ),
          )}
          {pending ? (
            <AssistantBubble>
              <p>
                <span aria-hidden="true">…</span>
                <span className="sr-only">{chat.typing}</span>
              </p>
            </AssistantBubble>
          ) : null}
        </div>
        {showSuggestions ? (
          <div className="flex flex-wrap gap-2 px-3 pb-3" role="group" aria-label={chat.suggestionsLabel}>
            {chat.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-sm font-semibold text-teal hover:bg-teal-soft disabled:opacity-50"
                disabled={pending}
                onClick={() => submit(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t border-line bg-white p-3">
        <label htmlFor={inputId} className="sr-only">
          {chat.inputLabel}
        </label>
        <textarea
          ref={textareaRef}
          id={inputId}
          className="field max-h-32 min-h-[2.75rem] resize-y text-sm disabled:opacity-60"
          rows={2}
          maxLength={MESSAGE_MAX}
          value={draft}
          placeholder={chat.placeholder}
          aria-describedby={`${counterId} ${disclaimerId}`}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onTextKeyDown}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p id={counterId} className="text-xs tabular-nums text-muted">
            {fill(chat.counter, { count: draft.length })}
          </p>
          <button
            type="submit"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-teal px-4 text-sm font-semibold text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={chat.send}
            disabled={pending || draft.trim().length === 0}
          >
            {chat.send}
          </button>
        </div>
        <p id={disclaimerId} className="mt-2 text-xs leading-relaxed text-muted">
          <ContactPhrase text={chat.disclaimer} linkText={chat.contactLink} href={contactHref} onNavigate={onClose} />
        </p>
      </form>
    </div>
  );
}

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl bg-white px-3 py-2 text-sm leading-relaxed text-ink">{children}</div>
    </div>
  );
}

function ContactPhrase({
  text,
  linkText,
  href,
  onNavigate,
}: {
  text: string;
  linkText: string;
  href: string;
  onNavigate: () => void;
}) {
  const index = linkText ? text.indexOf(linkText) : -1;
  if (index === -1) return text;
  const linkClass = "font-semibold text-teal underline underline-offset-2";
  return (
    <>
      {text.slice(0, index)}
      <Link href={href} onClick={onNavigate} className={linkClass}>
        {linkText}
      </Link>
      {text.slice(index + linkText.length)}
    </>
  );
}

function networkTurn(chat: ChatCopy): ChatTurn {
  return { role: "assistant", content: chat.errorNetwork };
}

async function readReply(response: Response): Promise<ChatTurn | null> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.reply !== "string") return null;
  const content = data.reply.trim();
  if (!content) return null;
  const links = sanitizeLinks(data.links);
  return links.length > 0 ? { role: "assistant", content, links } : { role: "assistant", content };
}

function storageKey(locale: string): string {
  return `sunday-atlas-chat:${locale}`;
}

function readStored(locale: string): ChatTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(storageKey(locale));
    if (!raw) return [];
    return sanitizeTurns(JSON.parse(raw));
  } catch {
    return [];
  }
}

function sanitizeTurns(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ChatTurn[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const role = item.role;
    const content = item.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim();
    if (!text) continue;
    if (role === "assistant") {
      const links = sanitizeLinks(item.links);
      turns.push(links.length > 0 ? { role, content: text, links } : { role, content: text });
    } else {
      turns.push({ role, content: text });
    }
  }
  return turns;
}

function sanitizeLinks(value: unknown): ChatLink[] {
  if (!Array.isArray(value)) return [];
  const links: ChatLink[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.title !== "string" || typeof item.url !== "string") continue;
    const title = item.title.trim();
    const url = item.url.trim();
    if (!title || !url.startsWith("/") || url.startsWith("//") || url.includes("://")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ title, url });
  }
  return links;
}

function focusableItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (item) => !item.hasAttribute("disabled") && item.tabIndex !== -1,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
