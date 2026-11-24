#!/usr/bin/env node
import { loadPosts } from "./lib/blog-core.mjs";
import { dailyBudget } from "./lib/blog-daily-budget.mjs";
/**
 * Is this blog run's slot already done? Cheap check before the daily blog job does any work.
 *   node scripts/blog-slot.mjs [--slot=auto|0] [--date=YYYY-MM-DD] [--count=1]
 * Prints date=, slot=, done=, destination=, created= lines (GITHUB_OUTPUT format).
 * Slot 0 = 02:17 UTC (06:17 Asia/Dubai). "auto" fills today's slot after it has started, or
 * reports done before then / once the daily post exists (pickSlot in lib/blog-rotation.mjs).
 */
import { loadRotation, pickSlot, slotEntry } from "./lib/blog-rotation.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const count = Math.max(1, Number(args.count ?? 1));
const state = loadRotation();
const now = pickSlot(state, new Date(), count);
const slot = String(args.slot ?? "") === "0" ? 0 : now.slot;
const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? "")) ? String(args.date) : now.date;
const entry = slotEntry(state, date, slot);
const created = entry?.created ?? 0;
console.log(`date=${date}`);
console.log(`slot=${slot}`);
const budget = dailyBudget(loadPosts());
console.log(`done=${budget.remaining === 0 || created >= count}`);
console.log(`daily_remaining=${budget.remaining}`);
console.log(`destination=${entry?.destination ?? ""}`);
console.log(`created=${created}`);
