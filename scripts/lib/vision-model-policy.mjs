/** Ordered vision defaults validated against live positive/negative photo controls. */
export function visionModels(env = process.env) {
  const models = (env.BLOG_NVIDIA_VISION_MODELS || env.BLOG_NVIDIA_VISION_MODEL ||
    'nvidia/nemotron-3.5-super-vl-120b-a12b,meta/llama-3.2-90b-vision-instruct').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(models)];
}

/** Four calls total, at most two per model. Successful output is NEVER retried here:
 * rejection and JSON validation belong solely to the unchanged photo gate.
 */
export async function runVisionModels(models, request, { sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let remaining = 4;
  let waitBudgetMs = 120_000;
  let last;
  for (const model of models) {
    for (let attempt = 0; attempt < 2 && remaining > 0; attempt++) {
      remaining--;
      try { return await request(model); }
      catch (err) {
        last = err;
        const operational = err.timeout === true || err.status === 429 ||
          (err.status >= 500 && err.status <= 599);
        if (!operational) throw err;
        const hasNext = remaining > 0 && (attempt === 0 || model !== models.at(-1));
        if (!hasNext) throw err;
        // Honor the full server delay, including before switching models.
        const delay = Math.max(err.retryAfterMs || 0, 2000 * (attempt + 1));
        // Do not truncate Retry-After to fit a job: defer this image instead.
        if (delay > waitBudgetMs) throw err;
        waitBudgetMs -= delay;
        await sleep(delay);
      }
    }
    if (!remaining) break;
  }
  throw last || new Error('no vision model configured');
}
