const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){if(request.startsWith('@/'))request=path.join(process.cwd(),'src',request.slice(2));return resolve.call(this,request,parent,...rest)};
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
process.env.NODE_ENV='production';
const content=require('../src/lib/content.ts');
let reads=0;const read=fs.readFileSync;fs.readFileSync=function(file,...args){if(String(file).includes('/content/'))reads++;return read.call(this,file,...args)};
for(const getter of [content.getAllDestinations,content.getAllPackages,content.getAllBlogPosts]) {
 const first=getter();const count=reads;const second=getter();
 assert.deepEqual(first,second); assert.equal(reads,count,'production normalized catalogs must not reread on every lookup');
 first.pop();assert.equal(getter().length,second.length,'callers must not mutate cached array');
}
console.log(`production snapshot checks passed (${reads} content reads)`);
process.env.NODE_ENV='development';
const before=reads;content.getAllPackages();content.getAllPackages();assert.ok(reads>before,'development must stay fresh');
process.env.NODE_ENV='production';
const start=performance.now();const sitemap=require('../app/sitemap.ts').default();
assert.ok(sitemap.length>100);assert.ok(performance.now()-start<10000,'sitemap exceeds controlled 10s regression budget');
assert.ok(require('../src/lib/llms.ts').llmsFullTxt().includes('## Tours'));
console.log(`sitemap ${sitemap.length} URLs and llms-full passed`);
