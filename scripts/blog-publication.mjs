#!/usr/bin/env node
import fs from 'node:fs';
import {prepareExport,verifyExport} from './lib/blog-publication.mjs';
const [mode,...args]=process.argv.slice(2);
if(mode==='prepare') {
 const manifest=prepareExport('out',args[0]);
 console.log(`[publication] ${manifest.pages.length} exported locale pages stamped; no live publication claimed`);
} else if(mode==='verify') {
 const report=await verifyExport(JSON.parse(fs.readFileSync('out/blog-publication.json','utf8')),args[0]);
 fs.writeFileSync('blog-publication-report.json',JSON.stringify(report,null,2)+'\n');
 console.log(`[publication] exported/generated ${report.generatedPosts}; verified published ${report.publishedPosts}; all locale pages verified=${report.liveVerified}`);
 if(!report.liveVerified)process.exitCode=1;
} else throw new Error('expected prepare <sha> or verify <https-origin>');
