import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as reserveServer } from 'node:net'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createMedusaService, adminGet } from '@repo/nuxt-medusa/server'
import { medusaInbox } from '@repo/nuxt-medusa/schema'
import { createJobsBoss, defineQueues, registerWorkers } from '@repo/nuxt-jobs/server'

async function port() {
  const server = reserveServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const selected = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return selected
}
/** Actual pinned backend; isolated provider graph never enters the starter runtime. */
export async function runPinnedBackend(applicationUrl: string) {
  const root = await mkdtemp(join(tmpdir(), 'medusa-pinned-2-21-2-')), providerName = `medusa_native_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${providerName}"`)
  const providerUrl = new URL(process.env.DATABASE_URL!); providerUrl.pathname = `/${providerName}`
  const connectionPort = await port(), receiverPort = await port(), keySecret = `whsec_${Buffer.alloc(32, 44).toString('base64')}`
  const providerEnv = { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), MEDUSA_DISABLE_TELEMETRY: 'true', NODE_ENV: 'development', DATABASE_URL: providerUrl.toString(), MEDUSA_BRIDGE_WEBHOOK_SECRET: keySecret, MEDUSA_BRIDGE_CONNECTION_ID: 'default', MEDUSA_BRIDGE_TARGET_URL: `http://127.0.0.1:${receiverPort}/api/integrations/medusa/webhooks/default` }
  const sql = postgres(applicationUrl, { max: 4 }), db = drizzle(sql), jobsConfig = { databaseUrl: applicationUrl, schema: 'medusa_native_jobs', concurrency: 1, useListenNotify: false }
  let apiKey = ''
  const config = { id: 'default', baseUrl: `http://127.0.0.1:${connectionPort}`, get secretApiKey() { return apiKey } }
  const mappings = new Map<string, string>(), ctx = { actorUserId: 'native-owner', scope: { kind: 'user' as const, id: 'native-owner' } }
  const migrationBoss = createJobsBoss(jobsConfig, 'migration'); await migrationBoss.start(); await migrationBoss.stop()
  const boss = createJobsBoss(jobsConfig); await boss.start()
  const service = createMedusaService({
    database: () => db, boss: async () => boss,
    env: { NODE_ENV: 'test', DATABASE_URL: applicationUrl, MEDUSA_BRIDGE_WEBHOOK_SECRET: keySecret },
    resolveConnection: async () => config,
    authorizeScope: async (actor, scope) => actor === 'native-owner' && scope.kind === 'user' && scope.id === actor,
    authorizeBoundResource: async (context, binding) => mappings.get(binding.remoteId) === context.actorUserId,
    authorizeMedusaResource: async (context, binding) => mappings.get(binding.remoteId) === context.actorUserId,
    authorizeReconciliation: async binding => mappings.get(binding.remoteId) === binding.scopeId,
  })
  const registry = { [service.operationJob.name]: service.operationJob, [service.inboxJob.name]: service.inboxJob }
  await defineQueues(boss, registry)
  let receiptFailure = false
  const receiver = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; let bytes = 0
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('Bound exceeded'); chunks.push(chunk) }
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(name, value)
      const result = await service.receive(new Request(`http://127.0.0.1:${receiverPort}`, { method: 'POST', headers, body: Buffer.concat(chunks) }), 'default')
      response.end(JSON.stringify(result))
    }
    catch { receiptFailure = true; response.writeHead(503); response.end('{}') }
  })
  await new Promise<void>(resolve => receiver.listen(receiverPort, '127.0.0.1', resolve))
  let backend: ReturnType<typeof Bun.spawn> | undefined, worker: ReturnType<typeof createJobsBoss> | undefined
  let backendLogs: Promise<string> | undefined
  async function command(args: string[]) {
    const child = Bun.spawn(args, { cwd: root, env: providerEnv, stdout: 'pipe', stderr: 'pipe' })
    const output = new Response(child.stdout).text(), errors = new Response(child.stderr).text()
    const status = await child.exited, logs = await output + await errors
    // Report static fixture failure. Never dump provider logs/keys/bodies to starter logs.
    assert.equal(status, 0, `Pinned fixture command failed: ${args[0]} ${args[1] ?? ''}`)
    assert(!apiKey || !logs.includes(apiKey), 'Provider key leaked')
    return logs
  }
  try {
    await mkdir(join(root, 'src/subscribers'), { recursive: true }); await mkdir(join(root, 'src/scripts')); await mkdir(join(root, 'config'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'disposable-medusa-compatibility', private: true, dependencies: { '@medusajs/framework': '2.21.2', '@medusajs/medusa': '2.21.2', '@medusajs/cli': '2.21.2' }, devDependencies: { 'ts-node': '10.9.2', 'tsconfig-paths': '4.2.0', typescript: '5.9.3' } }))
    const modulePath = dirname(dirname(new URL(import.meta.resolve('@repo/nuxt-medusa')).pathname))
    const source = join(modulePath, 'provider-bridge/subscriber.ts')
    const bridge = await Bun.build({ entrypoints: [source], target: 'node', format: 'cjs', outdir: join(root, 'src/subscribers') }); assert(bridge.success)
    await writeFile(join(root, 'medusa-config.js'), `const {defineConfig}=require('@medusajs/framework/utils');module.exports=defineConfig({admin:{disable:true},projectConfig:{databaseUrl:process.env.DATABASE_URL,databaseDriverOptions:{connection:{ssl:false}},http:{storeCors:'http://127.0.0.1',adminCors:'http://127.0.0.1',authCors:'http://127.0.0.1',jwtSecret:'disposable-local-only-32-character-secret',cookieSecret:'disposable-local-only-32-character-secret'}}})`)
    await command(['bun', 'install'])
    assert.equal(JSON.parse(await readFile(join(root, 'node_modules/@medusajs/medusa/package.json'), 'utf8')).version, '2.21.2')
    const cli = ['node', 'node_modules/@medusajs/cli/cli.js']
    await command([...cli, 'db:migrate'])
    await writeFile(join(root, 'src/scripts/seed.js'), `
const fs=require('node:fs/promises');module.exports.default=async({container})=>{
 const {createProductsWorkflow}=require('@medusajs/medusa/core-flows');
 const {result}=await createProductsWorkflow(container).run({input:{products:[{title:'Pinned safe product',handle:'pinned-safe-product',status:'published',options:[{title:'Size',values:['One']}],variants:[]}]}});
 const order=await container.resolve('order').createOrders({currency_code:'usd',items:[{title:'Local fixture item',quantity:1,unit_price:20}]});
 const key=await container.resolve('api_key').createApiKeys({title:'Disposable local test key',type:'secret',created_by:'local-fixture'});
 await fs.writeFile('fixture-seed.json',JSON.stringify({productId:result[0].id,orderId:order.id,apiKey:key.token}));
 // Source-proven order.placed {id}; no checkout/payment workflow is invoked.
 await container.resolve('event_bus').emit({name:'order.placed',data:{id:order.id}});
 await new Promise(resolve=>setTimeout(resolve,500));
}`)
    await command([...cli, 'exec', './src/scripts/seed.js'])
    const seeded = JSON.parse(await readFile(join(root, 'fixture-seed.json'), 'utf8')) as { productId: string, orderId: string, apiKey: string }
    apiKey = seeded.apiKey
    mappings.set(seeded.productId, ctx.actorUserId); mappings.set(seeded.orderId, ctx.actorUserId)
    const productBinding = await db.transaction(tx => service.createBindingInTransaction(tx, ctx, { scope: ctx.scope, localResourceId: crypto.randomUUID(), connectionId: 'default', resourceKind: 'product', remoteId: seeded.productId }))
    const orderBinding = await db.transaction(tx => service.createBindingInTransaction(tx, ctx, { scope: ctx.scope, localResourceId: crypto.randomUUID(), connectionId: 'default', resourceKind: 'order', remoteId: seeded.orderId }))
    backend = Bun.spawn([...cli, 'start', '--port', String(connectionPort)], { cwd: root, env: providerEnv, stdout: 'pipe', stderr: 'pipe' })
    backendLogs = Promise.all([new Response(backend.stdout).text(), new Response(backend.stderr).text()]).then(parts => parts.join(''))
    let ready = false
    for (let i = 0; i < 150; i++) {
      assert.equal(backend.exitCode, null)
      try { if ((await fetch(`${config.baseUrl}/health`)).ok) { ready = true; break } } catch { /* Local bounded boot. */ }
      await Bun.sleep(100)
    }
    assert(ready)
    // Native Admin Basic authentication and selected-field response shape.
    const nativeProduct = await adminGet(config, 'product', { remoteId: seeded.productId }, { env: { NODE_ENV: 'test' } })
    const nativeOrder = await adminGet(config, 'order', { remoteId: seeded.orderId }, { env: { NODE_ENV: 'test' } })
    assert(nativeProduct); assert(nativeOrder)
    worker = createJobsBoss(jobsConfig, 'worker'); await worker.start(); await registerWorkers(worker, registry, 1)
    await writeFile(join(root, 'src/scripts/update.js'), `
const fs=require('node:fs/promises');module.exports.default=async({container})=>{
 const seed=JSON.parse(await fs.readFile('fixture-seed.json','utf8'));const {updateProductsWorkflow}=require('@medusajs/medusa/core-flows');
 await updateProductsWorkflow(container).run({input:{products:[{id:seed.productId,title:'Pinned updated product'}]}});
 await container.resolve('event_bus').emit({name:'order.placed',data:{id:seed.orderId}});
 await new Promise(resolve=>setTimeout(resolve,500));
}`)
    await command([...cli, 'exec', './src/scripts/update.js'])
    let synced = false
    for (let i = 0; i < 100; i++) {
      try {
        const product = await service.getProduct(ctx, { bindingId: productBinding.id }), order = await service.getOrder(ctx, { bindingId: orderBinding.id })
        if ('title' in product && product.title === 'Pinned updated product' && 'total' in order && order.total === '20') { synced = true; break }
      }
      catch { /* Await worker projection transaction. */ }
      await Bun.sleep(100)
    }
    assert(synced, 'Native bridge receipt and real Jobs reconciliation must complete')
    assert(!receiptFailure)
    const receipts = await db.select().from(medusaInbox)
    for (const type of ['product.created', 'product.updated', 'order.placed']) assert(receipts.some(row => row.eventType === type), `Native ${type} subscriber shape required`)
    assert.equal((await service.listProducts({ actorUserId: 'native-owner', scope: { kind: 'user', id: 'native-owner' } })).items.filter(p => p.bindingId === productBinding.id).length, 1)
    await assert.rejects(service.getProduct({ actorUserId: 'native-other', scope: { kind: 'user', id: 'native-other' } }, { bindingId: productBinding.id }))
    console.info('[medusa] Actual 2.21.2 backend/Admin Basic auth/major-unit total/product workflow and order.placed subscriber/atomic receipt/real Jobs/scoped projection passed; no payment workflow invoked')
  }
  finally {
    await worker?.stop(); await service.stop(); await boss.stop()
    if (backend) { backend.kill('SIGTERM'); await backend.exited; const logs = await backendLogs!; assert(!apiKey || !logs.includes(apiKey)) }
    await new Promise<void>(resolve => { receiver.close(() => resolve()); receiver.closeAllConnections() })
    await sql.end(); await admin.unsafe(`DROP DATABASE "${providerName}"`); await admin.end(); await rm(root, { recursive: true, force: true })
  }
}
