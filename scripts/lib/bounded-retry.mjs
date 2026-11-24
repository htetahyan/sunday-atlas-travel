/** Exactly two attempts of the same operation; never calls the content generator. */
export async function boundedRetry(operation, {sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 const first=await operation();
 if(first===0)return 0;
 await sleep(15000);
 return operation();
}
