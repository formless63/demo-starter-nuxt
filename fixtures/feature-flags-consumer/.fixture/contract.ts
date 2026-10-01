import assert from 'node:assert/strict'
import { randomUUID,createHash } from 'node:crypto'
import postgres from 'postgres'
import pg from 'pg'
import { drizzle as postgresDrizzle } from 'drizzle-orm/postgres-js'
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres'
import { eq,sql } from 'drizzle-orm'
import { defineFeatureFlags,FeatureFlagsError,rolloutBucket } from '@repo/nuxt-feature-flags/server'
import { flagDefinition,fixtureAudit } from '../server/database/schema.ts'
const client=process.env.FLAGS_PROBE_DRIVER==='pg'?new pg.Pool({connectionString:process.env.FLAGS_PROBE_DATABASE_URL,max:8}):postgres(process.env.FLAGS_PROBE_DATABASE_URL!,{max:8})
const db=client instanceof pg.Pool?nodeDrizzle(client):postgresDrizzle(client)
const actor={userId:'fixture-operator'},k=`fixture.${randomUUID().replaceAll('-','')}`
const flags=defineFeatureFlags({managementGuard:async supplied=>supplied.userId===actor.userId,onChange:async(tx,_operation,definition)=>{await tx.insert(fixtureAudit).values({id:randomUUID(),flagKey:definition.key})}})
const code=(expected:string)=>(error:unknown)=>error instanceof FeatureFlagsError&&error.code===expected
try {
  for(const [kind,id,bucket] of [['tenant','tenant-a',4307],['tenant','tenant-b',7830],['user','user-a',2910],['user','user-b',6109]] as const)assert.equal(rolloutBucket('beta.dashboard',kind,id),bucket)
  for(const [id,prefix,bucket] of [['雪🙂','f8d2c537',9719],['quote"\\line','2a1320d4',1643],['é','620991d2',3829],['a\u2028b','3c6dbb16',2360],['\u0001','17bafccf',926]] as const) { const digest=createHash('sha256').update(Buffer.from(JSON.stringify(['feature-flags-v1','unicode.test','user',id]),'utf8')).digest();assert.equal(digest.subarray(0,4).toString('hex'),prefix);assert.equal(rolloutBucket('unicode.test','user',id),bucket) }
  let golden=await flags.evaluateBooleanDetails(db,'beta.dashboard')
  if(golden.reason==='not-found')await flags.createDefinition(db,actor,'beta.dashboard')
  golden=await flags.evaluateBooleanDetails(db,'beta.dashboard')
  let goldenUpdate=await flags.updateDefinition(db,actor,'beta.dashboard',golden.revision!,{enabled:true,rolloutBasisPoints:5000})
  for(const [kind,id,wanted] of [['tenant','tenant-a',true],['tenant','tenant-b',false],['user','user-a',true],['user','user-b',false]] as const)assert.equal(await flags.evaluateBoolean(db,'beta.dashboard',kind==='tenant'?{tenantId:id}:{userId:id}),wanted)
  goldenUpdate=await flags.updateDefinition(db,actor,'beta.dashboard',goldenUpdate.definition.revision,{rolloutBasisPoints:4307})
  assert.equal(await flags.evaluateBoolean(db,'beta.dashboard',{tenantId:'tenant-a'}),false)
  await flags.updateDefinition(db,actor,'beta.dashboard',goldenUpdate.definition.revision,{rolloutBasisPoints:4308})
  assert.equal(await flags.evaluateBoolean(db,'beta.dashboard',{tenantId:'tenant-a'}),true)
  await assert.rejects(flags.evaluateBoolean(db,k,{userId:'\u0001'}),code('invalid-input'))
  await assert.rejects(flags.evaluateMany(db,[k,k]),code('invalid-input'))
  await assert.rejects(flags.evaluateMany(db,Array.from({length:51},(_,n)=>`key.${n}`)),code('invalid-input'))
  assert.deepEqual(await flags.evaluateBooleanDetails(db,k),{value:false,reason:'not-found'})
  await assert.rejects(defineFeatureFlags().createDefinition(db,actor,k),code('forbidden'))
  await assert.rejects(flags.createDefinition(db,{userId:'not-operator'},k),code('forbidden'))
  let result=await flags.createDefinition(db,actor,k,{defaultValue:true,rolloutBasisPoints:10000});assert.equal(result.definition.revision,1)
  assert.equal((await flags.evaluateBooleanDetails(db,k,{userId:'user-a'})).reason,'disabled')
  await assert.rejects(flags.createDefinition(db,actor,k),code('conflict'))
  result=await flags.updateDefinition(db,actor,k,1,{enabled:true});assert.equal(result.definition.revision,2)
  assert.equal(await flags.evaluateBoolean(db,k,{userId:'user-a'}),true)
  assert.equal((await flags.evaluateBooleanDetails(db,k)).reason,'default')
  assert.equal(await flags.evaluateBoolean(db,k),true)
  result=await flags.updateDefinition(db,actor,k,2,{rolloutBasisPoints:0});assert.equal(await flags.evaluateBoolean(db,k,{userId:'user-a'}),false)
  result=await flags.setOverride(db,actor,k,result.definition.revision,{targetKind:'user',targetId:'user-a'},true)
  assert.equal((await flags.evaluateBooleanDetails(db,k,{userId:'user-a'})).reason,'user-target')
  result=await flags.setOverride(db,actor,k,result.definition.revision,{targetKind:'tenant',targetId:'tenant-a'},false)
  assert.deepEqual(await flags.evaluateBooleanDetails(db,k,{userId:'user-a',tenantId:'tenant-a'}),{value:false,reason:'tenant-target',revision:result.definition.revision})
  assert.equal(await flags.evaluateBoolean(db,k,{userId:'user-a',tenantId:'tenant-b'}),true)
  const unchanged=await flags.setOverride(db,actor,k,result.definition.revision,{targetKind:'tenant',targetId:'tenant-a'},false);assert.equal(unchanged.changed,false);assert.equal(unchanged.definition.revision,result.definition.revision)
  await assert.rejects(flags.removeOverride(db,actor,k,result.definition.revision-1,{targetKind:'tenant',targetId:'tenant-a'}),code('conflict'))
  const current=result.definition.revision
  await assert.rejects(db.transaction(async tx=>{await flags.updateDefinitionTx(tx,actor,k,current,{enabled:false});throw new Error('fixture rollback')}),/fixture rollback/)
  assert.equal((await flags.evaluateBooleanDetails(db,k,{userId:'user-a'})).revision,current)
  const updates=await Promise.allSettled([flags.updateDefinition(db,actor,k,current,{description:'first'}),flags.updateDefinition(db,actor,k,current,{description:'second'})]);assert.equal(updates.filter(r=>r.status==='fulfilled').length,1);assert(updates.some(r=>r.status==='rejected'&&code('conflict')(r.reason)))
  let revision=(await flags.evaluateBooleanDetails(db,k)).revision!
  result=await flags.updateDefinition(db,actor,k,revision,{enabled:false});revision=result.definition.revision
  assert.equal(await flags.evaluateBoolean(db,k,{userId:'user-a'}),false)
  const all=await flags.evaluateMany(db,[k,'unknown.flag'],{userId:'user-a'});assert.equal(all[k]!.reason,'disabled');assert.equal(all['unknown.flag']!.value,false)
  let interruptionCalls=0
  const interrupted=defineFeatureFlags({managementGuard:async()=>true,onChange:async tx=>{interruptionCalls++;await tx.execute(sql`SELECT pg_terminate_backend(pg_backend_pid())`)}})
  const interruptedKey=`connection.${randomUUID().replaceAll('-','')}`
  await assert.rejects(interrupted.createDefinition(db,actor,interruptedKey,{enabled:true,defaultValue:true}),code('unavailable'))
  assert.equal(interruptionCalls,1)
  assert.deepEqual(await flags.evaluateBooleanDetails(db,interruptedKey),{value:false,reason:'not-found'})
  const failing={transaction:async()=>{throw new Error('private fixture database address')}}
  assert.deepEqual(await flags.evaluateBooleanDetails(failing,k),{value:false,reason:'error',errorCode:'unavailable'})
  await assert.rejects(flags.updateDefinition(failing,actor,k,revision,{enabled:true}),code('unavailable'))
  const disabled=await flags.evaluateMany(db,[k],{tenantId:'different'});assert.equal(disabled[k]!.value,false)
  const list=await flags.listDefinitions(db,actor,{limit:1});assert.equal(list.items.length,1)
  const overrides=await flags.listOverrides(db,actor,k,{limit:1});assert(overrides.nextCursor);assert.equal((await flags.listOverrides(db,actor,k,{limit:1,cursor:overrides.nextCursor})).items.length,1)
  await assert.rejects(flags.listOverrides(db,actor,k,{cursor:`${overrides.nextCursor}=`}),code('invalid-input'))
  // One snapshot: a prior application transaction snapshot sees the whole old definition/override state.
  await db.transaction(async tx=>{
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    const before=await flags.evaluateManyTx(tx,[k],{userId:'user-a'})
    await flags.updateDefinition(db,actor,k,revision,{enabled:true})
    const after=await flags.evaluateManyTx(tx,[k],{userId:'user-a'})
    assert.deepEqual(after,before)
  })
  assert.equal(await flags.evaluateBoolean(db,k,{userId:'user-a'}),true)
  let unlock!:()=>void,announce!:()=>void
  const holding=new Promise<void>(resolve=>{announce=resolve}),release=new Promise<void>(resolve=>{unlock=resolve})
  const blocker=db.transaction(async tx=>{await tx.execute(sql`LOCK TABLE feature_flag_definition IN ACCESS EXCLUSIVE MODE`);announce();await release})
  await holding
  try{assert.deepEqual(await flags.evaluateBooleanDetails(db,k),{value:false,reason:'error',errorCode:'timeout'})}finally{unlock();await blocker}
  const [audits]=await db.select({count:sql<number>`count(*)::integer`}).from(fixtureAudit).where(eq(fixtureAudit.flagKey,k));assert(audits!.count>0)
  // Stored unsupported data must fail closed even when enabled/default are true.
  await db.update(flagDefinition).set({description:'x'.repeat(201)}).where(eq(flagDefinition.key,k))
  assert.deepEqual(await flags.evaluateBooleanDetails(db,k,{userId:'user-a'}),{value:false,reason:'error',errorCode:'configuration'})
  await db.update(flagDefinition).set({description:''}).where(eq(flagDefinition.key,k))
  const contexts=await Promise.all(Array.from({length:20},(_,n)=>flags.evaluateBoolean(db,k,{userId:'user-a',tenantId:n%2?'tenant-a':'tenant-b'})))
  assert(contexts.every((value,n)=>value===!(n%2)))
  console.info('[feature flags fixture] canonical vectors, precedence, revision/no-op, rollback, snapshots, safe failure and concurrent context isolation passed')
}finally{if(client instanceof pg.Pool)await client.end();else await client.end()}
