import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from './lib/blog-daily-budget.mjs';

test('exactly one post per actual Dubai generation day, including catch-up and manual runs', () => {
  const now = new Date('2026-11-08T08:00:00Z');
  const posts = [{ post: { publishedAt: '2026-11-07T19:59:00Z' } }];
  assert.deepEqual(policy.dailyBudget(posts, now), { date: '2026-11-08', limit: 1, generated: 0, remaining: 1 });
  posts.push({ post: { publishedAt: '2026-11-07T20:01:00Z' } });
  assert.deepEqual(policy.dailyBudget(posts, now), { date: '2026-11-08', limit: 1, generated: 1, remaining: 0 });
  posts.push({ post: { publishedAt: '2026-11-08T05:00:00Z' } });
  assert.equal(policy.dailyBudget(posts, now).remaining, 0);
  assert.equal(policy.dailyBudget(posts, new Date('2026-11-08T20:01:00Z')).remaining, 1);
  assert.equal(policy.DAILY_GENERATION_LIMIT, 1);
});
