/**
 * Weekly newsletter: pure helpers (no network). Used by scripts/newsletter.mjs and its tests.
 *
 * - ISO week keys ("2026-W45") decide "one email per subscriber per week".
 * - pickFeatured() rotates the featured tour through every live package before repeating,
 *   preferring a package whose destination had blog posts that week.
 * - buildEmail() renders the localized subject, HTML and plain text.
 * - unsubscribeToken() is the HMAC also checked by functions/api/unsubscribe.ts.
 */
import { createHmac } from "node:crypto";
import { BANNED_RE, SUPPLIER_RE, SITE_ORIGIN, brandNeutral } from "./blog-core.mjs";

export const LOCALES = ["en", "de", "fr", "ja", "es"];
export const SENDER = { email: "contact@sundayatlastravel.com", name: "Jeremy at Sunday Atlas Travel" };

/* ------------------------------------------------------------------ weeks */

/** ISO 8601 week key for a date, e.g. "2026-W44". Computed in UTC. */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 UTC to next Monday of the ISO week that contains `date`. */
export function weekRange(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  const start = new Date(d.getTime() - (day - 1) * 86400000);
  return { start, end: new Date(start.getTime() + 7 * 86400000) };
}

/* ------------------------------------------------------------------ catalog */

export function isFeaturable(pkg) {
  return Boolean(
    pkg &&
      pkg.slug &&
      pkg.published !== false &&
      pkg.sample !== true &&
      typeof pkg.priceFrom === "number" &&
      pkg.priceFrom > 0 &&
      pkg.image?.src &&
      pkg.title?.en,
  );
}

function postTime(post) {
  const t = Date.parse(post.publishedAt || "");
  return Number.isFinite(t) ? t : 0;
}

export function livePosts(posts) {
  return posts.filter((p) => p && p.slug && p.published !== false && p.title?.en).sort((a, b) => postTime(b) - postTime(a) || a.slug.localeCompare(b.slug));
}

/** Destinations with posts published in the 7 days before `now` (or this ISO week). */
export function recentDestinations(posts, now = new Date()) {
  const { start } = weekRange(now);
  const since = Math.min(start.getTime(), now.getTime() - 7 * 86400000);
  const out = [];
  for (const p of livePosts(posts)) {
    const t = postTime(p);
    if (t >= since && t <= now.getTime() + 86400000 && p.destination && !out.includes(p.destination)) out.push(p.destination);
  }
  return out;
}

/**
 * Featured tour for `week`. Same week => same tour (idempotent re-runs).
 * Never repeats a package until every featurable package has been used once (state.cycleUsed).
 * Returns { slug, state } where state is the updated copy (not written).
 */
export function pickFeatured(packages, posts, state, week, now = new Date()) {
  const next = {
    version: 1,
    weeks: { ...(state?.weeks || {}) },
    cycleUsed: [...(state?.cycleUsed || [])],
    cycle: state?.cycle || 1,
  };
  const pool = packages.filter(isFeaturable).sort((a, b) => a.slug.localeCompare(b.slug));
  if (!pool.length) throw new Error("No featurable package (published, priced, with an image).");
  const existing = next.weeks[week]?.package;
  if (existing && pool.some((p) => p.slug === existing)) return { slug: existing, state: next, reused: true };

  let unused = pool.filter((p) => !next.cycleUsed.includes(p.slug));
  if (!unused.length) {
    next.cycle += 1;
    next.cycleUsed = [];
    unused = pool;
  }
  const lastDest = Object.entries(next.weeks).sort(([a], [b]) => b.localeCompare(a))[0]?.[1]?.destination;
  const recent = recentDestinations(posts, now);
  const score = (p) => {
    let s = 0;
    const r = recent.indexOf(p.destination);
    if (r >= 0) s += 100 - r * 10; // destination blogged this week
    if (!p.isDayTour && (p.durationDays || 0) > 1) s += 20; // multi-day tours first
    if (p.featured) s += 5;
    if (lastDest && p.destination === lastDest && r < 0) s -= 30; // vary week to week
    return s;
  };
  unused.sort((a, b) => score(b) - score(a) || a.slug.localeCompare(b.slug));
  const pick = unused[0];
  next.cycleUsed.push(pick.slug);
  next.weeks[week] = { package: pick.slug, destination: pick.destination, chosenAt: now.toISOString(), matchedBlogDestination: recent.includes(pick.destination) };
  return { slug: pick.slug, state: next, reused: false };
}

/* ------------------------------------------------------------------ copy */

const loc = (value, locale) => (value && typeof value === "object" ? value[locale] || value.en || "" : String(value ?? ""));

export function formatPrice(amount, locale) {
  // Same style as the catalog's fromLabel: $1,080 (en/de/ja), $1.080 (es), 1 080 $ (fr).
  const n = String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, locale === "es" ? "." : locale === "fr" ? "\u202f" : ",");
  return locale === "fr" ? `${n} $` : `$${n}`;
}

export const COPY = {
  en: {
    subject: "{tour}, from {price} + 3 new travel blog posts",
    preheader: "This week's tour from Sunday Atlas Travel: {days}, from {price} per person.",
    hello: "Hello,",
    intro: "Here is this week's tour and the newest posts from our travel blog.",
    tourLabel: "Tour of the week",
    from: "from {price} per person",
    days: (n) => (n === 1 ? "1-day trip" : `${n} days`),
    cta: "See the tour, prices and itinerary",
    blogLabel: "New on the travel blog",
    readPost: "Read the post",
    allPosts: "All travel blog posts",
    reply: "Questions about dates or prices? Just reply to this email and I will get back to you.",
    signoff: "Best wishes,",
    signer: "Jeremy, Sunday Atlas Travel (Bangkok)",
    why: "You are getting this email because you subscribed at sundayatlastravel.com. One email a week, no more.",
    unsubscribe: "Unsubscribe",
    view: "Prices are per person in USD, from our tour catalog; the final price is confirmed by email.",
  },
  de: {
    subject: "{tour}, ab {price} + 3 neue Beiträge im Reiseblog",
    preheader: "Die Reise der Woche von Sunday Atlas Travel: {days}, ab {price} pro Person.",
    hello: "Hallo,",
    intro: "Hier ist unsere Reise der Woche und die neuesten Beiträge aus unserem Reiseblog.",
    tourLabel: "Reise der Woche",
    from: "ab {price} pro Person",
    days: (n) => (n === 1 ? "Tagesausflug" : `${n} Tage`),
    cta: "Reise, Preise und Ablauf ansehen",
    blogLabel: "Neu im Reiseblog",
    readPost: "Beitrag lesen",
    allPosts: "Alle Beiträge im Reiseblog",
    reply: "Fragen zu Terminen oder Preisen? Antworten Sie einfach auf diese E-Mail, ich melde mich.",
    signoff: "Viele Grüße",
    signer: "Jeremy, Sunday Atlas Travel (Bangkok)",
    why: "Sie erhalten diese E-Mail, weil Sie sich auf sundayatlastravel.com angemeldet haben. Eine E-Mail pro Woche, nicht mehr.",
    unsubscribe: "Abmelden",
    view: "Preise pro Person in USD aus unserem Reisekatalog; der Endpreis wird per E-Mail bestätigt.",
  },
  fr: {
    subject: "{tour}, dès {price} + 3 nouveaux articles du blog voyage",
    preheader: "Le circuit de la semaine de Sunday Atlas Travel : {days}, dès {price} par personne.",
    hello: "Bonjour,",
    intro: "Voici le circuit de la semaine et les derniers articles de notre blog voyage.",
    tourLabel: "Circuit de la semaine",
    from: "à partir de {price} par personne",
    days: (n) => (n === 1 ? "excursion d’une journée" : `${n} jours`),
    cta: "Voir le circuit, les prix et le programme",
    blogLabel: "Nouveau sur le blog voyage",
    readPost: "Lire l’article",
    allPosts: "Tous les articles du blog voyage",
    reply: "Une question sur les dates ou les prix ? Répondez simplement à cet e-mail, je vous réponds.",
    signoff: "Bien à vous,",
    signer: "Jeremy, Sunday Atlas Travel (Bangkok)",
    why: "Vous recevez cet e-mail car vous vous êtes inscrit sur sundayatlastravel.com. Un e-mail par semaine, pas plus.",
    unsubscribe: "Se désabonner",
    view: "Prix par personne en USD, issus de notre catalogue ; le prix final est confirmé par e-mail.",
  },
  ja: {
    subject: "{tour}（{price}から）＋旅行ブログ新着記事3本",
    preheader: "Sunday Atlas Travel 今週のツアー：{days}、1名{price}から。",
    hello: "こんにちは。",
    intro: "今週のおすすめツアーと、旅行ブログの新着記事をお届けします。",
    tourLabel: "今週のツアー",
    from: "1名{price}から",
    days: (n) => (n === 1 ? "日帰りツアー" : `${n}日間`),
    cta: "ツアーの料金と旅程を見る",
    blogLabel: "旅行ブログの新着記事",
    readPost: "記事を読む",
    allPosts: "旅行ブログの記事一覧",
    reply: "日程や料金のご質問は、このメールにそのままご返信ください。",
    signoff: "よろしくお願いいたします。",
    signer: "Jeremy（Sunday Atlas Travel、バンコク）",
    why: "このメールは sundayatlastravel.com でご登録いただいた方にお送りしています。配信は週1回のみです。",
    unsubscribe: "配信停止",
    view: "料金はツアーカタログに基づく1名あたりの米ドル価格です。最終料金はメールでご案内します。",
  },
  es: {
    subject: "{tour}, desde {price} + 3 nuevas entradas del blog de viajes",
    preheader: "El tour de la semana de Sunday Atlas Travel: {days}, desde {price} por persona.",
    hello: "Hola:",
    intro: "Aquí tienes el tour de la semana y las entradas más recientes de nuestro blog de viajes.",
    tourLabel: "Tour de la semana",
    from: "desde {price} por persona",
    days: (n) => (n === 1 ? "excursión de un día" : `${n} días`),
    cta: "Ver el tour, los precios y el itinerario",
    blogLabel: "Nuevo en el blog de viajes",
    readPost: "Leer la entrada",
    allPosts: "Todas las entradas del blog de viajes",
    reply: "¿Dudas sobre fechas o precios? Responde a este correo y te contesto.",
    signoff: "Un saludo,",
    signer: "Jeremy, Sunday Atlas Travel (Bangkok)",
    why: "Recibes este correo porque te suscribiste en sundayatlastravel.com. Un correo por semana, nada más.",
    unsubscribe: "Darse de baja",
    view: "Precios por persona en USD de nuestro catálogo de tours; el precio final se confirma por correo.",
  },
};

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/** 2–3 short highlight lines: the middle itinerary days, or the first inclusions for a day trip. */
export function highlights(pkg, locale) {
  const days = (pkg.itinerary || []).map((d) => loc(d.title, locale)).filter(Boolean);
  let lines = days.length > 3 ? days.slice(1, -1) : days.length >= 2 ? days : [];
  if (lines.length < 2) lines = (pkg.included?.[locale] || pkg.included?.en || []).slice(0, 3);
  return lines.slice(0, 3).map((s) => s.replace(/\s+/g, " ").trim());
}

/** Cloudinary delivery transform for email (JPEG, fixed width). The stored image is untouched. */
export function emailImage(src, transform) {
  if (!src) return "";
  if (!/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(src)) return src;
  return src.replace("/image/upload/", `/image/upload/${transform}/`);
}

export function withUtm(url, week, content) {
  const u = new URL(url);
  u.searchParams.set("utm_source", "newsletter");
  u.searchParams.set("utm_medium", "email");
  u.searchParams.set("utm_campaign", `weekly-${week.toLowerCase()}`);
  u.searchParams.set("utm_content", content);
  return u.toString();
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Strip a trailing "From $972 per person." sentence; the price is shown on its own line. */
function summaryText(pkg, locale) {
  return loc(pkg.summary, locale).replace(/\s*(?:From|Ab|Dès|Desde|1名)[^.。]*(?:\$|USD)[^.。]*[.。]?\s*$/iu, "").trim();
}

/**
 * Render one email. `unsubscribeUrl` is per subscriber (use a placeholder for previews).
 * Returns { subject, preheader, html, text }.
 */
export function buildEmail({ locale, pkg, posts, week, unsubscribeUrl }) {
  const L = LOCALES.includes(locale) ? locale : "en";
  const c = COPY[L];
  const price = formatPrice(pkg.priceFrom, L);
  const tour = loc(pkg.title, L);
  const days = c.days(pkg.durationDays || 1);
  const pkgUrl = withUtm(`${SITE_ORIGIN}/${L}/packages/${pkg.slug}/`, week, "featured-tour");
  const blogIndex = withUtm(`${SITE_ORIGIN}/${L}/blog/`, week, "all-posts");
  const img = emailImage(pkg.image.src, "c_fill,g_auto,w_1200,h_600,f_jpg,q_auto:good");
  const imgAlt = loc(pkg.image.alt, L) || tour;
  const lines = highlights(pkg, L);
  const summary = summaryText(pkg, L);
  const items = posts.slice(0, 3).map((p, i) => ({
    title: loc(p.title, L),
    summary: loc(p.summary, L),
    url: withUtm(`${SITE_ORIGIN}/${L}/blog/${p.slug}/`, week, `post-${i + 1}`),
    thumb: p.heroImage?.src ? emailImage(p.heroImage.src, "c_fill,g_auto,w_240,h_180,f_jpg,q_auto") : "",
    alt: loc(p.heroImage?.alt, L) || loc(p.title, L),
  }));
  const subject = fill(c.subject, { tour, price });
  const preheader = fill(c.preheader, { days, price });
  const fromLine = fill(c.from, { price });

  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Hiragino Sans','Noto Sans JP',sans-serif";
  const postRows = items
    .map(
      (p) => `
          <tr><td style="padding:0 0 18px 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              ${p.thumb ? `<td width="120" valign="top" style="padding-right:14px"><a href="${esc(p.url)}"><img src="${esc(p.thumb)}" width="120" height="90" alt="${esc(p.alt)}" style="display:block;border-radius:8px;width:120px;height:90px;object-fit:cover;border:0"></a></td>` : ""}
              <td valign="top" style="${font}">
                <a href="${esc(p.url)}" style="color:#12324a;font-size:16px;line-height:22px;font-weight:700;text-decoration:none">${esc(p.title)}</a>
                ${p.summary ? `<div style="color:#55606b;font-size:14px;line-height:20px;padding-top:4px">${esc(p.summary)}</div>` : ""}
                <div style="padding-top:6px"><a href="${esc(p.url)}" style="color:#c2571a;font-size:14px;font-weight:600;text-decoration:none">${esc(c.readPost)} &rarr;</a></div>
              </td>
            </tr></table>
          </td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="${L}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
<style>
  @media (max-width:620px){ .wrap{width:100%!important} .pad{padding-left:18px!important;padding-right:18px!important} .h1{font-size:22px!important;line-height:28px!important} }
</style>
</head>
<body style="margin:0;padding:0;background:#f3efe8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3efe8">
  <tr><td align="center" style="padding:24px 10px">
    <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
      <tr><td class="pad" style="padding:22px 32px;background:#12324a;${font}">
        <a href="${esc(withUtm(`${SITE_ORIGIN}/${L}/`, week, "logo"))}" style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;text-decoration:none">Sunday Atlas Travel</a>
      </td></tr>
      <tr><td class="pad" style="padding:26px 32px 6px 32px;${font};color:#26313b;font-size:16px;line-height:24px">
        <p style="margin:0 0 8px 0">${esc(c.hello)}</p>
        <p style="margin:0">${esc(c.intro)}</p>
      </td></tr>
      <tr><td class="pad" style="padding:18px 32px 0 32px;${font}">
        <div style="color:#c2571a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding-bottom:10px">${esc(c.tourLabel)}</div>
        <a href="${esc(pkgUrl)}"><img src="${esc(img)}" width="536" alt="${esc(imgAlt)}" style="display:block;width:100%;max-width:536px;height:auto;border-radius:10px;border:0"></a>
        <h1 class="h1" style="margin:16px 0 4px 0;color:#12324a;font-size:24px;line-height:30px">${esc(tour)}</h1>
        <div style="color:#26313b;font-size:16px;line-height:24px;font-weight:600">${esc(days)} &middot; ${esc(fromLine)}</div>
        ${summary ? `<p style="margin:10px 0 0 0;color:#55606b;font-size:15px;line-height:22px">${esc(summary)}</p>` : ""}
        <ul style="margin:12px 0 0 0;padding:0 0 0 20px;color:#26313b;font-size:15px;line-height:23px">
          ${lines.map((l) => `<li style="margin:0 0 4px 0">${esc(l)}</li>`).join("")}
        </ul>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 6px 0"><tr>
          <td style="border-radius:999px;background:#c2571a"><a href="${esc(pkgUrl)}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;${font}">${esc(c.cta)} &rarr;</a></td>
        </tr></table>
      </td></tr>
      <tr><td class="pad" style="padding:22px 32px 0 32px"><div style="border-top:1px solid #e6e0d6"></div></td></tr>
      <tr><td class="pad" style="padding:20px 32px 0 32px;${font}">
        <div style="color:#c2571a;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding-bottom:14px">${esc(c.blogLabel)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${postRows}
        </table>
        <a href="${esc(blogIndex)}" style="color:#12324a;font-size:14px;font-weight:600">${esc(c.allPosts)} &rarr;</a>
      </td></tr>
      <tr><td class="pad" style="padding:24px 32px 28px 32px;${font};color:#26313b;font-size:15px;line-height:23px">
        <p style="margin:0 0 12px 0">${esc(c.reply)}</p>
        <p style="margin:0">${esc(c.signoff)}<br><strong>${esc(c.signer)}</strong></p>
      </td></tr>
    </table>
    <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
      <tr><td class="pad" style="padding:16px 32px;${font};color:#7a828a;font-size:12px;line-height:18px;text-align:center">
        ${esc(c.view)}<br>${esc(c.why)}<br>
        Sunday Atlas Travel &middot; Bangkok, Thailand &middot; <a href="mailto:contact@sundayatlastravel.com" style="color:#7a828a">contact@sundayatlastravel.com</a><br>
        <a href="${esc(unsubscribeUrl)}" style="color:#7a828a;text-decoration:underline">${esc(c.unsubscribe)}</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    c.hello,
    "",
    c.intro,
    "",
    `${c.tourLabel.toUpperCase()}`,
    tour,
    `${days} · ${fromLine}`,
    summary,
    ...lines.map((l) => `- ${l}`),
    `${c.cta}: ${pkgUrl}`,
    "",
    c.blogLabel.toUpperCase(),
    ...items.flatMap((p) => [`* ${p.title}`, `  ${p.url}`]),
    `${c.allPosts}: ${blogIndex}`,
    "",
    c.reply,
    "",
    c.signoff,
    c.signer,
    "",
    "--",
    c.view,
    c.why,
    "Sunday Atlas Travel · Bangkok, Thailand · contact@sundayatlastravel.com",
    `${c.unsubscribe}: ${unsubscribeUrl}`,
  ]
    .filter((x) => x !== undefined && x !== null)
    .join("\n");

  return { subject, preheader, html, text, pkgUrl, posts: items };
}

/** Brand rules for anything we send: banned words and supplier names (whole words). Returns problems. */
const SUPPLIER_WORD_RE = new RegExp(`(?<![\\p{L}])(?:${SUPPLIER_RE.source})(?![\\p{L}])`, "iu");
export function emailProblems(email) {
  const problems = [];
  const visibleHtml = String(email.html ?? "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  for (const [name, value] of Object.entries({ subject: email.subject, html: visibleHtml, text: email.text })) {
    const t = brandNeutral(value);
    if (BANNED_RE.test(t)) problems.push(`${name}: banned word (${t.match(BANNED_RE)[0]})`);
    if (SUPPLIER_WORD_RE.test(t)) problems.push(`${name}: supplier name (${t.match(SUPPLIER_WORD_RE)[0]})`);
    if (/\{[a-z]+\}/i.test(value)) problems.push(`${name}: unfilled placeholder`);
    if (/\bhtet\b|ah yan/i.test(value)) problems.push(`${name}: owner name`);
  }
  return problems;
}

/* ------------------------------------------------------------------ unsubscribe */

/** HMAC-SHA256 over "unsub:<subscriber _id>", base64url, first 32 chars. */
export function unsubscribeToken(secret, subscriberId) {
  return createHmac("sha256", secret).update(`unsub:${subscriberId}`).digest("base64url").slice(0, 32);
}

export function unsubscribeUrl(secret, subscriberId, locale) {
  const id = subscriberId.replace(/^subscribers\./, "");
  const u = new URL(`${SITE_ORIGIN}/api/unsubscribe`);
  u.searchParams.set("id", id);
  u.searchParams.set("t", unsubscribeToken(secret, subscriberId));
  u.searchParams.set("l", LOCALES.includes(locale) ? locale : "en");
  return u.toString();
}
