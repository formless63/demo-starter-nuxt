import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Real Node24 Nitro boot; only a uniquely bound loopback listener is owned here. */
export async function verifyProductionBoot(databaseUrl: string, installed: boolean) {
  const reserve=createServer()
  await new Promise<void>((done,reject)=>{reserve.once('error',reject);reserve.listen(0,'127.0.0.1',()=>done())})
  const address=reserve.address();assert(address&&typeof address==='object');const port=address.port
  await new Promise<void>((done,reject)=>reserve.close(error=>error?reject(error):done()))
  const child=Bun.spawn(['node','.output/server/index.mjs'],{env:{...process.env,DATABASE_URL:databaseUrl,NITRO_HOST:'127.0.0.1',NITRO_PORT:String(port)},stdout:'pipe',stderr:'pipe'})
  const output=new Response(child.stdout).text(),errors=new Response(child.stderr).text()
  try {
    let ready=false
    for(let attempt=0;attempt<100&&!ready;attempt++){
      try{ready=(await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1000)})).status===200}catch{ /* Retry readiness only; each HTTP request has its own abort deadline. */ }
      if(!ready)await new Promise(resolve=>setTimeout(resolve,100))
    }
    assert(ready,'Node production fixture must serve its base application')
    const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})
    // The base application has no router, so it answers every path with 200. Removal is proven by the
    // consumer health route's JSON payload disappearing, not by a 404 status.
    assert.equal(response.status,200)
    assert.equal((response.headers.get('content-type')??'').includes('application/json'),installed)
    if(installed)assert.deepEqual(await response.json(),{status:'ok'})
    const assets=await readdir(resolve('.output/public/_nuxt'),{recursive:true})
    for(const asset of assets.filter(name=>name.endsWith('.js'))){const content=await readFile(resolve('.output/public/_nuxt',asset),'utf8');for(const secret of ['authorization_assignment','feature_flag_override','organization_member_owner_idx','fixture-operator'])assert(!content.includes(secret),'Server-only schema/policy must be excluded from browser output')}
  }
  finally {child.kill('SIGTERM');await child.exited;const logs=(await output)+(await errors);assert(!logs.includes(databaseUrl),'Startup must not disclose database settings')}
}
