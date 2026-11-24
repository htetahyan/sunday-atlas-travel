/**
 * Cloudflare Pages Function: /api/unsubscribe
 * Signed unsubscribe for the weekly newsletter (scripts/newsletter.mjs).
 *
 *   GET  /api/unsubscribe?id=<40 hex>&t=<token>&l=<locale>
 *        Localized page with one "Unsubscribe" button. GET never changes anything, so mail
 *        scanners that prefetch links cannot unsubscribe people by accident.
 *   POST /api/unsubscribe?id=...&t=...&l=...
 *        Marks the subscriber unsubscribed (unsubscribed=true, unsubscribedAt) and shows the
 *        confirmation page. Also the RFC 8058 one-click target: Gmail/Apple Mail POST
 *        "List-Unsubscribe=One-Click" here straight from the inbox.
 *
 * Token: HMAC-SHA256(NEWSLETTER_UNSUB_SECRET, "unsub:subscribers.<id>"), base64url, first 32 chars.
 * Pages secrets (synced by .github/workflows/deploy-pages.yml, never in git):
 *   NEWSLETTER_UNSUB_SECRET, SANITY_SUBSCRIBE_TOKEN.
 */

interface Env {
  NEWSLETTER_UNSUB_SECRET?: string;
  SANITY_SUBSCRIBE_TOKEN?: string;
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
}

interface EventContext {
  request: Request;
  env: Env;
}

type Locale = "en" | "de" | "fr" | "ja" | "es";
const LOCALES: Locale[] = ["en", "de", "fr", "ja", "es"];

const COPY: Record<Locale, { title: string; ask: string; button: string; done: string; doneBody: string; invalid: string; error: string; home: string; blog: string }> = {
  en: {
    title: "Unsubscribe",
    ask: "Stop the weekly Sunday Atlas Travel email? You can sign up again on the site at any time.",
    button: "Unsubscribe",
    done: "You are unsubscribed",
    doneBody: "You will not get the weekly email any more. Our travel blog is still there whenever you want it.",
    invalid: "This unsubscribe link is not valid. Please reply to any of our emails or write to contact@sundayatlastravel.com and we will remove you by hand.",
    error: "Something went wrong on our side. Please try again in a minute, or write to contact@sundayatlastravel.com.",
    home: "Home",
    blog: "Travel blog",
  },
  de: {
    title: "Abmelden",
    ask: "Die wöchentliche E-Mail von Sunday Atlas Travel abbestellen? Sie können sich jederzeit wieder anmelden.",
    button: "Abmelden",
    done: "Sie sind abgemeldet",
    doneBody: "Sie erhalten die wöchentliche E-Mail nicht mehr. Unser Reiseblog bleibt für Sie da.",
    invalid: "Dieser Abmeldelink ist ungültig. Antworten Sie auf eine unserer E-Mails oder schreiben Sie an contact@sundayatlastravel.com, wir tragen Sie von Hand aus.",
    error: "Bei uns ist etwas schiefgelaufen. Bitte versuchen Sie es gleich noch einmal oder schreiben Sie an contact@sundayatlastravel.com.",
    home: "Startseite",
    blog: "Reiseblog",
  },
  fr: {
    title: "Se désabonner",
    ask: "Ne plus recevoir l’e-mail hebdomadaire de Sunday Atlas Travel ? Vous pourrez vous réinscrire à tout moment sur le site.",
    button: "Se désabonner",
    done: "Vous êtes désabonné",
    doneBody: "Vous ne recevrez plus l’e-mail hebdomadaire. Notre blog voyage reste ouvert quand vous voulez.",
    invalid: "Ce lien de désabonnement n’est pas valide. Répondez à l’un de nos e-mails ou écrivez à contact@sundayatlastravel.com et nous vous retirerons nous-mêmes.",
    error: "Un problème est survenu de notre côté. Réessayez dans une minute ou écrivez à contact@sundayatlastravel.com.",
    home: "Accueil",
    blog: "Blog voyage",
  },
  ja: {
    title: "配信停止",
    ask: "Sunday Atlas Travel の週1回のメール配信を停止しますか？サイトからいつでも再登録できます。",
    button: "配信を停止する",
    done: "配信を停止しました",
    doneBody: "今後、週1回のメールは届きません。旅行ブログはいつでもご覧いただけます。",
    invalid: "この配信停止リンクは無効です。メールにご返信いただくか、contact@sundayatlastravel.com までご連絡ください。手動で停止いたします。",
    error: "システムエラーが発生しました。少し時間をおいて再度お試しいただくか、contact@sundayatlastravel.com までご連絡ください。",
    home: "ホーム",
    blog: "旅行ブログ",
  },
  es: {
    title: "Darse de baja",
    ask: "¿Dejar de recibir el correo semanal de Sunday Atlas Travel? Puedes volver a suscribirte en la web cuando quieras.",
    button: "Darme de baja",
    done: "Te has dado de baja",
    doneBody: "Ya no recibirás el correo semanal. Nuestro blog de viajes sigue ahí cuando quieras.",
    invalid: "Este enlace de baja no es válido. Responde a cualquiera de nuestros correos o escribe a contact@sundayatlastravel.com y te daremos de baja a mano.",
    error: "Algo ha fallado por nuestra parte. Inténtalo de nuevo en un minuto o escribe a contact@sundayatlastravel.com.",
    home: "Inicio",
    blog: "Blog de viajes",
  },
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function page(locale: Locale, heading: string, body: string, status: number, form?: string): Response {
  const c = COPY[locale];
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(heading)} | Sunday Atlas Travel</title>
<style>body{margin:0;background:#f3efe8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,"Hiragino Sans","Noto Sans JP",sans-serif;color:#26313b}main{max-width:520px;margin:10vh auto;background:#fff;border-radius:14px;padding:32px 28px;box-shadow:0 6px 24px rgba(18,50,74,.08)}.brand{color:#12324a;font-weight:700;font-size:18px;text-decoration:none}h1{color:#12324a;font-size:24px;margin:20px 0 10px}p{line-height:1.55}button{background:#c2571a;color:#fff;border:0;border-radius:999px;padding:13px 26px;font-size:16px;font-weight:700;cursor:pointer}nav a{color:#12324a;margin-right:16px;font-weight:600}</style></head>
<body><main><a class="brand" href="/${locale}/">Sunday Atlas Travel</a><h1>${esc(heading)}</h1><p>${esc(body)}</p>${form ?? ""}<nav><a href="/${locale}/">${esc(c.home)}</a><a href="/${locale}/blog/">${esc(c.blog)}</a></nav></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    },
  });
}

function base64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function expectedToken(secret: string, docId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unsub:${docId}`));
  return base64url(sig).slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function params(url: URL): { id: string; token: string; locale: Locale } {
  const l = url.searchParams.get("l") || "en";
  return {
    id: (url.searchParams.get("id") || "").toLowerCase(),
    token: url.searchParams.get("t") || "",
    locale: (LOCALES as string[]).includes(l) ? (l as Locale) : "en",
  };
}

async function verify(env: Env, id: string, token: string): Promise<boolean> {
  if (!env.NEWSLETTER_UNSUB_SECRET || !/^[0-9a-f]{40}$/.test(id) || !/^[A-Za-z0-9_-]{32}$/.test(token)) return false;
  return safeEqual(await expectedToken(env.NEWSLETTER_UNSUB_SECRET, `subscribers.${id}`), token);
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const url = new URL(context.request.url);
  const { id, token, locale } = params(url);
  const c = COPY[locale];
  if (!(await verify(context.env, id, token))) return page(locale, c.title, c.invalid, 400);
  const action = `/api/unsubscribe?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}&l=${locale}`;
  const form = `<form method="post" action="${esc(action)}" style="margin:22px 0 26px"><button type="submit">${esc(c.button)}</button></form>`;
  return page(locale, c.title, c.ask, 200, form);
}

export async function onRequestPost(context: EventContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const { id, token, locale } = params(url);
  const c = COPY[locale];
  if (!(await verify(env, id, token))) return page(locale, c.title, c.invalid, 400);
  if (!env.SANITY_SUBSCRIBE_TOKEN) {
    console.warn(JSON.stringify({ event: "unsubscribe_unconfigured" }));
    return page(locale, c.title, c.error, 503);
  }
  const projectId = env.SANITY_PROJECT_ID || "mi09tcmc";
  const dataset = env.SANITY_DATASET || "production";
  try {
    const r = await fetch(`https://${projectId}.api.sanity.io/v2023-10-01/data/mutate/${dataset}?visibility=async`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.SANITY_SUBSCRIBE_TOKEN}` },
      body: JSON.stringify({
        mutations: [{ patch: { id: `subscribers.${id}`, set: { unsubscribed: true, unsubscribedAt: new Date().toISOString() } } }],
      }),
    });
    // A missing document (already deleted) is fine: the person gets no more email either way.
    if (!r.ok && r.status !== 404 && r.status !== 409) {
      console.warn(JSON.stringify({ event: "unsubscribe_store_failed", status: r.status }));
      return page(locale, c.title, c.error, 502);
    }
  } catch {
    console.warn(JSON.stringify({ event: "unsubscribe_store_failed", status: 0 }));
    return page(locale, c.title, c.error, 502);
  }
  return page(locale, c.done, c.doneBody, 200);
}

export async function onRequest(context: EventContext): Promise<Response> {
  const method = context.request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return onRequestGet(context);
  if (method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
}
