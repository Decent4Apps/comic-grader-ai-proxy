import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizePaidRequest, readPaidJson, boundAIInput } from '../lib/paid-security.mjs';
const secret='s'.repeat(48), env={PAID_PROXY_SECRET:secret,UPSTASH_REDIS_REST_URL:'https://quota.invalid',UPSTASH_REDIS_REST_TOKEN:'test'};
const request=token=>new Request('https://proxy.invalid',{headers:token?{authorization:`Bearer ${token}`}:{}});
test('missing/incorrect authentication never reaches the quota service',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('must not call')};
 assert.equal((await authorizePaidRequest(request(secret),{env:{},fetcher})).status,503);
 assert.equal((await authorizePaidRequest(request(),{env,fetcher})).status,401);
 assert.equal((await authorizePaidRequest(request('wrong'),{env,fetcher})).status,401);assert.equal(calls,0);
});
test('quota limits and outages fail closed; authorized budget succeeds',async()=>{
 assert.equal((await authorizePaidRequest(request(secret),{env:{PAID_PROXY_SECRET:secret}})).status,503);
 assert.equal((await authorizePaidRequest(request(secret),{env,fetcher:async()=>Response.json({result:0})})).status,429);
 assert.equal((await authorizePaidRequest(request(secret),{env,fetcher:async()=>{throw Error('offline')}})).status,503);
 assert.equal(await authorizePaidRequest(request(secret),{env,fetcher:async(_url,init)=>{const command=JSON.parse(init.body);assert.equal(command[0],'EVAL');assert.match(command[1],/INCR/);return Response.json({result:1})}}),null);
});
test('chunked bodies and caller-supplied budgets are bounded',async()=>{
 const req=new Request('https://proxy.invalid',{method:'POST',body:new ReadableStream({start(c){c.enqueue(new Uint8Array(20));c.close()}}),duplex:'half'});
 await assert.rejects(()=>readPaidJson(req,10),/too large/);
 const body=boundAIInput({model:'gpt-4o-mini',max_tokens:999999,n:100});assert.equal(body.max_tokens,2048);assert.equal(body.n,1);
 assert.throws(()=>boundAIInput({model:'unapproved-expensive-model'}),/not permitted/);
});
