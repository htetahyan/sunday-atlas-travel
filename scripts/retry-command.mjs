#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {boundedRetry} from './lib/bounded-retry.mjs';
const args=process.argv.slice(2);if(args[0]==='--')args.shift();
if(!args.length)throw new Error('command required');
let attempts=0;
process.exitCode=await boundedRetry(()=>new Promise(resolve=>{
 console.log(`[retry] command attempt ${++attempts}/2`);
 const child=spawn(args[0],args.slice(1),{stdio:'inherit',shell:false});
 child.on('error',()=>resolve(1));child.on('exit',code=>resolve(code??1));
}));
