/**
 * POST JSON -> { ok, messageId?, method?, code? }
 * Only the Pages Function reaches this Worker (service binding).
 * Omitted to/from/fromName/html: team notification on env.EMAIL (one destination,
 * one sender). Any of those fields present: acknowledgement on env.EMAIL_ACK.
 * Never fall back to env.EMAIL for an acknowledgement.
 */
import { EmailMessage } from "cloudflare:email";

const FROM = "inquiries@sundayatlastravel.com";
const FROM_NAME = "Sunday Atlas inquiries";
const TO = "contact@sundayatlastravel.com";
const ACK_FROM = "contact@sundayatlastravel.com";
const ACK_FROM_NAME = "Sunday Atlas Travel";
const SAFE_EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function oneLine(value, max) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function rawMime({ subject, text, replyTo }) {
  const lines = [
    `From: ${FROM_NAME} <${FROM}>`,
    `To: <${TO}>`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Message-ID: <${crypto.randomUUID()}@sundayatlastravel.com>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    (b64(text).match(/.{1,76}/g) || []).join("\r\n"),
  ].filter((line) => line !== null);
  return lines.join("\r\n");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function present(value) {
  return value !== undefined && value !== null;
}

/** An explicit ack payload names a recipient, sender, display name, or HTML part. */
function explicitAck(body) {
  if (body === null || typeof body !== "object") return false;
  return present(body.to) || present(body.from) || present(body.fromName) || present(body.html);
}

function wrapB64(text) {
  return (b64(text).match(/.{1,76}/g) || []).join("\r\n");
}

function mimeBoundary(parts) {
  let boundary = crypto.randomUUID();
  while (parts.some((part) => part.includes(boundary))) boundary = crypto.randomUUID();
  return boundary;
}

function rawMimeAck({ fromName, to, subject, text, html, replyTo }) {
  const lines = [
    `From: ${fromName} <${ACK_FROM}>`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Message-ID: <${crypto.randomUUID()}@sundayatlastravel.com>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];
  if (!html) {
    lines.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrapB64(text));
  } else {
    const boundary = mimeBoundary([text, html, wrapB64(text), wrapB64(html)]);
    lines.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapB64(text),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapB64(html),
      `--${boundary}--`,
    );
  }
  return lines.filter((line) => line !== null).join("\r\n");
}

async function sendAckMail(env, body) {
  if (present(body.cc) || present(body.bcc)) return json({ ok: false, code: "invalid" }, 400);
  if (typeof body.to !== "string" || !SAFE_EMAIL.test(body.to)) return json({ ok: false, code: "invalid" }, 400);
  if (oneLine(body.from, 240) !== ACK_FROM) return json({ ok: false, code: "invalid" }, 400);
  let fromName = oneLine(body.fromName, 80);
  if (!fromName) fromName = ACK_FROM_NAME;
  if (/["<>\\]/.test(fromName)) return json({ ok: false, code: "invalid" }, 400);
  const replyTo = typeof body.replyTo === "string" && SAFE_EMAIL.test(body.replyTo) ? body.replyTo : null;
  const subject = oneLine(body.subject, 240);
  const text = String(body.text ?? "").slice(0, 20000);
  if (!subject || !text) return json({ ok: false, code: "invalid" }, 400);
  const html = present(body.html) ? String(body.html).slice(0, 100000) : "";
  const to = body.to;

  let firstError = null;
  try {
    const result = await env.EMAIL_ACK.send({
      from: { email: ACK_FROM, name: fromName },
      to,
      subject,
      text,
      ...(html ? { html } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    console.log(JSON.stringify({ event: "inquiry_ack_mail_sent", method: "builder", messageId: result?.messageId ?? null }));
    return json({ ok: true, method: "builder", messageId: result?.messageId ?? null });
  } catch (error) {
    firstError = `${error?.code ?? "error"}: ${oneLine(error?.message, 200)}`;
  }
  try {
    const messageId = `<${crypto.randomUUID()}@sundayatlastravel.com>`;
    const raw = rawMimeAck({ fromName, to, subject, text, html, replyTo }).replace(
      /^Message-ID: .*$/m,
      `Message-ID: ${messageId}`,
    );
    await env.EMAIL_ACK.send(new EmailMessage(ACK_FROM, to, raw));
    console.log(JSON.stringify({ event: "inquiry_ack_mail_sent", method: "mime", messageId }));
    return json({ ok: true, method: "mime", messageId });
  } catch (error) {
    const code = `${error?.code ?? "error"}: ${oneLine(error?.message, 200)}`;
    console.error(JSON.stringify({ event: "inquiry_ack_mail_failed", code: error?.code ?? "error" }));
    return json({ ok: false, code, builderError: firstError }, 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ ok: false, code: "method" }, 405);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, code: "invalid" }, 400);
    }
    if (explicitAck(body)) return sendAckMail(env, body);
    const subject = oneLine(body?.subject, 240);
    const text = String(body?.text ?? "").slice(0, 20000);
    const replyTo = typeof body?.replyTo === "string" && SAFE_EMAIL.test(body.replyTo) ? body.replyTo : null;
    if (!subject || !text) return json({ ok: false, code: "invalid" }, 400);

    let firstError = null;
    try {
      const result = await env.EMAIL.send({
        from: { email: FROM, name: FROM_NAME },
        to: TO,
        subject,
        text,
        ...(replyTo ? { replyTo } : {}),
      });
      console.log(JSON.stringify({ event: "inquiry_mail_sent", method: "builder", messageId: result?.messageId ?? null }));
      return json({ ok: true, method: "builder", messageId: result?.messageId ?? null });
    } catch (error) {
      firstError = `${error?.code ?? "error"}: ${oneLine(error?.message, 200)}`;
      console.warn(JSON.stringify({ event: "inquiry_mail_builder_failed", error: firstError }));
    }
    try {
      const messageId = `<${crypto.randomUUID()}@sundayatlastravel.com>`;
      const raw = rawMime({ subject, text, replyTo }).replace(/^Message-ID: .*$/m, `Message-ID: ${messageId}`);
      await env.EMAIL.send(new EmailMessage(FROM, TO, raw));
      console.log(JSON.stringify({ event: "inquiry_mail_sent", method: "mime", messageId, builderError: firstError }));
      return json({ ok: true, method: "mime", messageId });
    } catch (error) {
      const code = `${error?.code ?? "error"}: ${oneLine(error?.message, 200)}`;
      console.error(JSON.stringify({ event: "inquiry_mail_failed", builderError: firstError, mimeError: code }));
      return json({ ok: false, code, builderError: firstError }, 502);
    }
  },
};
