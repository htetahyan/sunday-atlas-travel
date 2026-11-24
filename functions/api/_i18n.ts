export const locales = ["en", "de", "fr", "ja", "es"] as const;

export type Locale = (typeof locales)[number];

export type ChatCopy = {
  contactOffer: string;
  unavailable: string;
  rateLimited: string;
  dailyCap: string;
  priceOnRequest: string;
  /** `{amount}` and `{currency}`, for example `6964 USD per person`. */
  perPersonAmount: string;
  singleSupplement: string;
  priceTableLabel: string;
  /** `{url}` is the package page, for example `/en/packages/five-stans-long-road-22-days/`. */
  seePriceTable: string;
  aboutUs: string;
  finalPrice: string;
  contactLinkTitle: string;
  languageName: string;
};

export const copy: Record<Locale, ChatCopy> = {
  en: {
    languageName: "English (English)",
    contactLinkTitle: "Plan my trip",
    contactOffer: "Please use the inquiry form at /en/contact/ to leave your name and email, or write to contact@sundayatlastravel.com.",
    unavailable: "I can't answer right now. Please use our inquiry form and we will reply by email.",
    rateLimited: "Too many messages… please use the inquiry form.",
    dailyCap: "Our chat assistant is resting for today. Please use the inquiry form and our team will reply by email.",
    priceOnRequest: "Prices are on request. Please use the inquiry form and we will reply by email with a personal quote.",
    perPersonAmount: "{amount} {currency} per person",
    singleSupplement: "single supplement",
    priceTableLabel: "price table",
    seePriceTable: "see the price table on the tour page: {url}",
    aboutUs: "Sunday Atlas Travel plans every trip itself and arranges the hotels, transport and guides. Our team replies to inquiries by email.",
    finalPrice: "Our team confirms the final price by email.",
  },
  de: {
    languageName: "German (Deutsch)",
    contactLinkTitle: "Reise planen",
    contactOffer: "Bitte nutzen Sie das Anfrageformular unter /de/contact/ und hinterlassen Sie Ihren Namen und Ihre E-Mail, oder schreiben Sie an contact@sundayatlastravel.com.",
    unavailable: "Ich kann gerade nicht antworten. Bitte nutzen Sie unser Anfrageformular, wir antworten per E-Mail.",
    rateLimited: "Zu viele Nachrichten… bitte nutzen Sie das Anfrageformular.",
    dailyCap: "Unser Chat-Assistent ruht sich heute aus. Bitte nutzen Sie das Anfrageformular, unser Team antwortet per E-Mail.",
    priceOnRequest: "Preise gibt es nur auf Anfrage. Bitte nutzen Sie das Anfrageformular, wir senden ein persönliches Angebot per E-Mail.",
    perPersonAmount: "{amount} {currency} pro Person",
    singleSupplement: "Einzelzimmerzuschlag",
    priceTableLabel: "Preistabelle",
    seePriceTable: "siehe die Preistabelle auf der Reiseseite: {url}",
    aboutUs: "Sunday Atlas Travel plant jede Reise selbst und organisiert Hotels, Transport und Reiseleitung. Unser Team antwortet auf Anfragen per E-Mail.",
    finalPrice: "Das Team bestätigt den endgültigen Preis per E-Mail.",
  },
  fr: {
    languageName: "French (français)",
    contactLinkTitle: "Planifier mon voyage",
    contactOffer: "Veuillez utiliser le formulaire de demande sur /fr/contact/ pour laisser votre nom et votre e-mail, ou écrire à contact@sundayatlastravel.com.",
    unavailable: "Je ne peux pas répondre pour le moment. Veuillez utiliser notre formulaire de demande et nous répondrons par e-mail.",
    rateLimited: "Trop de messages… veuillez utiliser le formulaire de demande.",
    dailyCap: "Notre assistant de chat se repose pour aujourd’hui. Veuillez utiliser le formulaire de demande et notre équipe répondra par e-mail.",
    priceOnRequest: "Les prix sont sur demande. Veuillez utiliser le formulaire de demande et nous répondrons par e-mail avec un devis personnel.",
    perPersonAmount: "{amount} {currency} par personne",
    singleSupplement: "supplément chambre individuelle",
    priceTableLabel: "grille tarifaire",
    seePriceTable: "voir la grille tarifaire sur la page du circuit : {url}",
    aboutUs: "Sunday Atlas Travel planifie chaque voyage et organise les hôtels, les transports et les guides. Notre équipe répond aux demandes par e-mail.",
    finalPrice: "Notre équipe confirme le prix final par e-mail.",
  },
  ja: {
    languageName: "Japanese (日本語)",
    contactLinkTitle: "旅の相談",
    contactOffer: "お名前とメールアドレスを /ja/contact/ のお問い合わせフォームからお送りいただくか、contact@sundayatlastravel.com までメールをお送りください。",
    unavailable: "ただいま回答できません。お問い合わせフォームをご利用ください。メールで返信します。",
    rateLimited: "メッセージが多すぎます…お問い合わせフォームをご利用ください。",
    dailyCap: "チャットアシスタントは本日お休みしています。お問い合わせフォームをご利用ください。チームがメールで返信します。",
    priceOnRequest: "料金はお問い合わせください。フォームからご連絡いただければ、メールでお見積もりをお送りします。",
    perPersonAmount: "1名あたり {amount} {currency}",
    singleSupplement: "1人部屋追加料金",
    priceTableLabel: "料金表",
    seePriceTable: "ツアーページの料金表をご覧ください：{url}",
    aboutUs: "Sunday Atlas Travelはすべての旅を自ら計画し、ホテル、移動、ガイドを手配します。お問い合わせにはチームがメールでお返事します。",
    finalPrice: "最終的な料金はチームがメールで確定してお知らせします。",
  },
  es: {
    languageName: "Spanish (español)",
    contactLinkTitle: "Planear mi viaje",
    contactOffer: "Use el formulario de consulta en /es/contact/ para dejar su nombre y su correo, o escriba a contact@sundayatlastravel.com.",
    unavailable: "No puedo responder ahora. Use nuestro formulario de consulta y le responderemos por correo.",
    rateLimited: "Demasiados mensajes… use el formulario de consulta.",
    dailyCap: "Nuestro asistente de chat descansa por hoy. Use el formulario de consulta y nuestro equipo responderá por correo.",
    priceOnRequest: "Los precios son a consultar. Use el formulario de consulta y le enviaremos un presupuesto personal por correo.",
    perPersonAmount: "{amount} {currency} por persona",
    singleSupplement: "suplemento individual",
    priceTableLabel: "tabla de precios",
    seePriceTable: "vea la tabla de precios en la página del tour: {url}",
    aboutUs: "Sunday Atlas Travel planifica cada viaje y organiza los hoteles, el transporte y los guías. Nuestro equipo responde a las consultas por correo electrónico.",
    finalPrice: "Nuestro equipo confirma el precio final por correo electrónico.",
  },
};

/** Fills `perPersonAmount` for `locale`. */
export function perPerson(locale: Locale, amount: string | number, currency: string): string {
  return copy[locale].perPersonAmount
    .replaceAll("{amount}", String(amount))
    .replaceAll("{currency}", currency);
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
