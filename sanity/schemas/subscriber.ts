import { defineField, defineType } from "../lib/define";

/** Email sign-ups from the site (POST /api/subscribe). _id is "subscribers.<hash>" so records stay private. */
export const subscriber = defineType({
  name: "subscriber",
  title: "Subscriber",
  type: "document",
  fields: [
    defineField({ name: "email", title: "Email", type: "string" }),
    defineField({ name: "locale", title: "Language", type: "string" }),
    defineField({ name: "sourcePage", title: "Signed up on page", type: "string" }),
    defineField({ name: "placement", title: "Form (header, footer, blog)", type: "string" }),
    defineField({ name: "createdAt", title: "Signed up at", type: "datetime" }),
    // Weekly newsletter (scripts/newsletter.mjs, /api/unsubscribe).
    defineField({ name: "unsubscribed", title: "Unsubscribed", type: "boolean" }),
    defineField({ name: "unsubscribedAt", title: "Unsubscribed at", type: "datetime" }),
    defineField({ name: "lastSentWeek", title: "Last newsletter week (ISO, e.g. 2026-W45)", type: "string" }),
    defineField({ name: "lastSentAt", title: "Last newsletter sent at", type: "datetime" }),
    defineField({ name: "lastMessageId", title: "Last newsletter message id", type: "string" }),
    defineField({ name: "lastAttemptWeek", title: "Newsletter send claimed for week", type: "string" }),
    defineField({ name: "lastAttemptAt", title: "Newsletter send claimed at", type: "datetime" }),
  ],
});
