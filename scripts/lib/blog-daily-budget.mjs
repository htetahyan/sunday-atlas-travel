/** Standing automatic ceiling: exactly one generated post per real Asia/Dubai day.
 * Count actual creation timestamps, never rotation slot dates (catch-up can be old).
 */
export const DAILY_GENERATION_LIMIT = 1;
const day = date => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function dailyBudget(posts, now = new Date()) {
 const date=day(now);
 const generated=posts.filter(entry=>{
  const stamp=new Date((entry.post??entry).publishedAt);
  return Number.isFinite(stamp.getTime())&&day(stamp)===date;
 }).length;
 return {date,limit:DAILY_GENERATION_LIMIT,generated,remaining:Math.max(0,DAILY_GENERATION_LIMIT-generated)};
}
