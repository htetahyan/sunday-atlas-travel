import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const marker=(sha,hash)=>`<meta name="sunday-atlas-content" content="${sha}:${hash}">`;
/** Stamp the exact exported HTML; retries upload the same files without rewriting posts. */
export function prepareExport(out,sha) {
 if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('full deployment commit SHA required');
 const pages=[];
 for(const locale of fs.readdirSync(out).sort()) {
  if(!/^[a-z]{2}$/.test(locale))continue;
  const blog=path.join(out,locale,'blog');if(!fs.existsSync(blog))continue;
  for(const slug of fs.readdirSync(blog).sort()) {
   if(!/^[a-z0-9-]+$/.test(slug))continue;
   const file=path.join(blog,slug,'index.html');if(!fs.existsSync(file))continue;
   const html=fs.readFileSync(file,'utf8').replace(/<meta name="sunday-atlas-content" content="[^"]*">/g,'');
   if(!html.includes('</head>'))throw new Error(`missing HTML head: ${locale}/${slug}`);
   const hash=createHash('sha256').update(html).digest('hex');
   fs.writeFileSync(file,html.replace('</head>',`${marker(sha,hash)}</head>`));
   pages.push({slug,locale,path:`/${locale}/blog/${slug}/`,hash});
  }
 }
 if(!pages.length)throw new Error('no exported blog pages found');
 const manifest={version:1,sha,pages};
 fs.writeFileSync(path.join(out,'blog-publication.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
/** Called only after a successful deployment. Every exported locale must load the
 * exact build marker before that post counts as published. No content writes.
 */
export async function verifyExport(manifest,origin,{fetch=globalThis.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 if(!/^[a-f0-9]{40}$/.test(manifest.sha)||!manifest.pages?.length)throw new Error('nonempty deployment manifest required');
 if(new URL(origin).protocol!=='https:')throw new Error('HTTPS publication origin required');
 const deadline=Date.now()+180000,checks=[];let rateLimited=false;
 for(const page of manifest.pages) {
  if(!/^\/[a-z]{2}\/blog\/[a-z0-9-]+\/$/.test(page.path))throw new Error('invalid blog page path');
  let ok=false,reason='verification budget exhausted';
  for(let attempt=0;attempt<2&&!rateLimited&&Date.now()<deadline;attempt++) {
   try {
    const url=new URL(page.path,origin);url.searchParams.set('publication-check',manifest.sha);
    const response=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now())))});
    if(response.status===429){rateLimited=true;reason='HTTP 429; verification stopped without further requests';break;}
    ok=response.ok&&(await response.text()).includes(marker(manifest.sha,page.hash));
    reason=ok?'verified':`HTTP ${response.status}: missing expected build/content marker`;
   } catch {reason='request failed or timed out';}
   if(ok)break;
   if(attempt===0&&Date.now()+5000<deadline)await sleep(5000);
  }
  checks.push({path:page.path,slug:page.slug,ok,reason:rateLimited&&!ok?'verification stopped on rate limit':reason});
  if(!rateLimited&&Date.now()+150<deadline)await sleep(150);
 }
 const slugs=[...new Set(manifest.pages.map(p=>p.slug))];
 const published=slugs.filter(slug=>checks.filter(c=>c.slug===slug).every(c=>c.ok));
 return {sha:manifest.sha,deployed:true,liveVerified:checks.every(c=>c.ok),generatedPosts:slugs.length,publishedPosts:published.length,checks,verifiedAt:new Date().toISOString()};
}
