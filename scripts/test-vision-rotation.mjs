import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from './lib/vision-model-policy.mjs';
import { visionGate } from './lib/image-gate.mjs';
import sharp from 'sharp';
const primary = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const alternate = 'meta/llama-3.2-90b-vision-instruct';
const error = (props) => Object.assign(new Error('failed'), props);

test('validated default order; legacy single override and ordered list deduplicate', () => {
 assert.deepEqual(policy.visionModels({}), [primary, alternate]);
 assert.deepEqual(policy.visionModels({BLOG_NVIDIA_VISION_MODEL:'custom'}), ['custom']);
 assert.deepEqual(policy.visionModels({BLOG_NVIDIA_VISION_MODELS:` ${primary},${alternate},${primary}`}), [primary, alternate]);
});
for (const props of [{status:429}, {timeout:true}, {status:503}]) {
 test(`brief retry then rotation: ${JSON.stringify(props)}`, async () => {
  const seen=[], waits=[];
  const result=await policy.runVisionModels([primary, alternate], async model => {
   seen.push(model); if(model===primary) throw error(props); return 'ok';
  }, {sleep:async ms=>waits.push(ms)});
  assert.equal(result,'ok'); assert.deepEqual(seen,[primary,primary,alternate]);
  assert.deepEqual(waits,[2000,4000]);
 });
}
test('Retry-After is never shortened including before rotation', async () => {
 const waits=[]; let calls=0;
 await assert.rejects(policy.runVisionModels([primary, alternate], async()=>{calls++;throw error({status:429,retryAfterMs:30000});}, {sleep:async ms=>waits.push(ms)}));
 assert.equal(calls,4); assert.deepEqual(waits,[30000,30000,30000]);
});
test('total attempt budget is shared across all models',async()=>{
 let calls=0;
 await assert.rejects(policy.runVisionModels(['a','b','c'],async()=>{calls++;throw error({status:503});},{sleep:async()=>{}}));
 assert.equal(calls,4);
});
for (const props of [{status:400},{status:401},{status:404},{retryable:true}]) {
 test(`no rotation for non-operational failure ${JSON.stringify(props)}`,async()=>{
  let calls=0;
  await assert.rejects(policy.runVisionModels([primary,alternate],async()=>{calls++;throw error(props);},{sleep:async()=>{}}));
  assert.equal(calls,1);
 });
}
test('valid rejection and uncertain JSON never rotate; exhausted calls fail closed',async()=>{
 const image=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).jpeg().toBuffer();
 const rejection=JSON.stringify({has_text:true,has_logo:false,has_watermark:false,has_border:false,is_photo:true,matches_subject:true,alt:'',reason:'text'});
 for(const reply of [rejection,'uncertain']) {
  let calls=0;
  const verdict=await visionGate(image,{call:()=>policy.runVisionModels([primary,alternate],async()=>{calls++;return reply;},{sleep:async()=>{}})});
  assert.equal(verdict.ok,false); assert.equal(calls,1);
 }
 const verdict=await visionGate(image,{call:()=>policy.runVisionModels([primary,alternate],async()=>{throw error({status:503});},{sleep:async()=>{}})});
 assert.equal(verdict.ok,false); assert.match(verdict.reasons[0],/failed closed/);
});

for (const failure of ['429', 'timeout', 'body-timeout', '503', '400']) {
 test(`HTTP integration: ${failure}, image wire format and explicit model override`, async t => {
  const saved={key:process.env.NVIDIA_API_KEY, interval:process.env.BLOG_NVIDIA_MIN_INTERVAL_MS, models:process.env.BLOG_NVIDIA_VISION_MODELS, fetch:globalThis.fetch};
  process.env.NVIDIA_API_KEY='test-only-not-a-real-key';
  process.env.BLOG_NVIDIA_MIN_INTERVAL_MS='0';
  process.env.BLOG_NVIDIA_VISION_MODELS=`${primary},${alternate}`;
  t.after(()=>{
   globalThis.fetch=saved.fetch;
   for(const [name,value] of [['NVIDIA_API_KEY',saved.key],['BLOG_NVIDIA_MIN_INTERVAL_MS',saved.interval],['BLOG_NVIDIA_VISION_MODELS',saved.models]]) {
    if(value===undefined) delete process.env[name]; else process.env[name]=value;
   }
  });
  const client=await import(`./lib/blog-ai-client.mjs?rotation-test=${failure}`);
  const seen=[];
  globalThis.fetch=async (url,options)=>{
   assert.equal(url,'https://integrate.api.nvidia.com/v1/chat/completions');
   const payload=JSON.parse(options.body); seen.push(payload.model);
   assert.equal(payload.messages[0].content[1].image_url.url,'data:image/jpeg;base64,test');
   assert.equal(payload.response_format,undefined); // Prompt JSON, not native structured output.
   if(payload.model===primary) {
    if(failure==='timeout') throw new DOMException('timed out','TimeoutError');
    if(failure==='body-timeout') return {text:async()=>{throw new DOMException('timed out','TimeoutError');}};
    return new Response('{}',{status:Number(failure),headers:{'Retry-After':'0'}});
   }
   assert.equal(payload.chat_template_kwargs,undefined);
   return new Response(JSON.stringify({choices:[{message:{content:'{"has_text":true}'}}]}));
  };
  const run=()=>client.vision('strict JSON','data:image/jpeg;base64,test');
  if(failure==='400') {
   await assert.rejects(run()); assert.deepEqual(seen,[primary]);
  } else {
   assert.equal(await run(),'{"has_text":true}');
   assert.deepEqual(seen,[primary,primary,alternate]);
  }
  seen.length=0;
  assert.equal(await client.vision('strict JSON','data:image/jpeg;base64,test',{model:alternate}),'{"has_text":true}');
  assert.deepEqual(seen,[alternate]);
 });
}

test('oversized Retry-After fails closed instead of shortening or rotating',async()=>{
 let calls=0; const waits=[];
 await assert.rejects(policy.runVisionModels([primary,alternate],async()=>{calls++;throw error({status:429,retryAfterMs:180000});},{sleep:async ms=>waits.push(ms)}));
 assert.equal(calls,1); assert.deepEqual(waits,[]);
});
test('shared cooldown preserves spacing for queued concurrent vision requests',async t=>{
 const saved={fetch:globalThis.fetch,key:process.env.NVIDIA_API_KEY,interval:process.env.BLOG_NVIDIA_MIN_INTERVAL_MS};
 process.env.NVIDIA_API_KEY='test-only'; process.env.BLOG_NVIDIA_MIN_INTERVAL_MS='20';
 t.after(()=>{globalThis.fetch=saved.fetch; for(const [k,v] of [['NVIDIA_API_KEY',saved.key],['BLOG_NVIDIA_MIN_INTERVAL_MS',saved.interval]]) {if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const client=await import('./lib/blog-ai-client.mjs?cooldown-spacing');
 const starts=[];
 globalThis.fetch=async (_url,opts)=>{
  if(JSON.parse(opts.body).model===primary) return new Response('{}',{status:429,headers:{'Retry-After':'0.1'}});
  starts.push(Date.now()); return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));
 };
 const failing=client.vision('p','image',{model:primary}).catch(()=>{});
 await new Promise(r=>setTimeout(r,10));
 await Promise.all([client.vision('p','image',{model:alternate}),client.vision('p','image',{model:alternate})]);
 await failing;
 assert.ok(starts[1]-starts[0]>=15,`requests bunched: ${starts[1]-starts[0]}ms`);
});
