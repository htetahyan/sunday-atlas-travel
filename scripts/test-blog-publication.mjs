import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as publication from './lib/blog-publication.mjs';
import * as retry from './lib/bounded-retry.mjs';
const sha='a'.repeat(40);
test('export manifest stamps only actual post pages and is idempotent',t=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'blog-publication-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
 for(const file of ['en/blog/a/index.html','de/blog/a/index.html','en/blog/index.html']) {
  fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),'<html><head></head><body>A</body></html>');
 }
 const one=publication.prepareExport(out,sha),two=publication.prepareExport(out,sha);
 assert.deepEqual(one,two);assert.equal(one.pages.length,2);
 assert.match(fs.readFileSync(path.join(out,'en/blog/a/index.html'),'utf8'),/sunday-atlas-content/);
});
test('successful deployment is not published until every locale page has correct marker',async()=>{
 const manifest={sha,pages:[{slug:'a',path:'/en/blog/a/',hash:'1'},{slug:'a',path:'/de/blog/a/',hash:'2'}]};
 const report=await publication.verifyExport(manifest,'https://example.com',{
  fetch:async url=>new Response(url.pathname.startsWith('/en/')?`<meta name="sunday-atlas-content" content="${sha}:1">`:'old page'),sleep:async()=>{},
 });
 assert.equal(report.generatedPosts,1);assert.equal(report.publishedPosts,0);assert.equal(report.deployed,true);assert.equal(report.liveVerified,false);
 const good=await publication.verifyExport(manifest,'https://example.com',{fetch:async url=>new Response(`<meta name="sunday-atlas-content" content="${sha}:${url.pathname.startsWith('/en/')?'1':'2'}">`),sleep:async()=>{}});
 assert.equal(good.publishedPosts,1);assert.equal(good.liveVerified,true);
});
test('missing pages fail closed with bounded GET attempts',async()=>{
 let calls=0;
 const report=await publication.verifyExport({sha,pages:[{slug:'a',path:'/en/blog/a/',hash:'x'}]},'https://example.com',{fetch:async()=>{calls++;return new Response('missing',{status:404});},sleep:async()=>{}});
 assert.equal(calls,2);assert.equal(report.publishedPosts,0);
});
test('verification refuses missing deployment identity or empty manifests',async()=>{
 await assert.rejects(publication.verifyExport({sha,pages:[]},'https://example.com'));
 assert.throws(()=>publication.prepareExport('/unused','not-a-sha'));
});
test('bounded retry reuses same operation and never retries success',async()=>{
 let calls=0;const waits=[];
 assert.equal(await retry.boundedRetry(async()=>++calls===1?1:0,{sleep:async ms=>waits.push(ms)}),0);
 assert.equal(calls,2);assert.equal(waits.length,1);
 calls=0;assert.equal(await retry.boundedRetry(async()=>{calls++;return 1;},{sleep:async()=>{}}),1);assert.equal(calls,2);
 calls=0;assert.equal(await retry.boundedRetry(async()=>{calls++;return 0;},{sleep:async()=>{}}),0);assert.equal(calls,1);
});
test('live-site 429 stops verification without rotating pages around the limit',async()=>{
 let calls=0;
 const report=await publication.verifyExport({sha,pages:[{slug:'a',path:'/en/blog/a/',hash:'x'},{slug:'b',path:'/en/blog/b/',hash:'y'}]},'https://example.com',{
  fetch:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'3600'}});},sleep:async()=>{},
 });
 assert.equal(calls,1);assert.equal(report.publishedPosts,0);assert.equal(report.liveVerified,false);
});
