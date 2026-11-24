export type InquiryInput = {
  name: string;
  email: string;
  passport: string;
  destination: string;
  dates: string;
  groupSize: string;
  message: string;
  consent: boolean;
  packageSlug: string | null;
  locale: string;
  /** Honeypot. Real submissions leave this empty. */
  website: string;
  /** Cloudflare Turnstile token (single-use). */
  turnstileToken: string;
};

export type InquiryResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "invalid" | "rate_limited" | "challenge" | "error" };

const REASONS = new Set(["not_configured", "invalid", "rate_limited", "challenge", "error"]);

/**
 * POST the inquiry to /api/inquiry (Pages Function). The function validates it,
 * saves it in Cloudflare D1 and emails the team. A filled honeypot is answered with
 * success and nothing is saved.
 */
export async function submitInquiry(data: InquiryInput): Promise<InquiryResult> {
  try {
    const response = await fetch("/api/inquiry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; reason?: string }
      | null;
    if (response.ok && body?.ok === true) return { ok: true };
    const reason = body?.reason;
    if (reason && REASONS.has(reason)) {
      return { ok: false, reason: reason as "not_configured" | "invalid" | "rate_limited" | "challenge" | "error" };
    }
    if (response.status === 429) return { ok: false, reason: "rate_limited" };
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
