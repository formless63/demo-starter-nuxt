import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { defineFeatureFlags, FeatureFlagsError } from '@repo/nuxt-feature-flags/server'
import { defineAuthorization, AuthorizationError } from '@repo/nuxt-authorization/server'
import { user } from '../server/database/schema'

// This explicit command is restricted to disposable local fixtures; never run at startup.
const [operation, operator, subject, expectedRaw, enabledRaw] = process.argv.slice(2).filter(value => value !== '--local-fixture')
const url = process.env.DATABASE_URL
if (!process.argv.includes('--local-fixture') || !url || !['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname) || !operator || !subject) {
  console.error('Use --local-fixture with a loopback disposable database, operation, explicit operator and subject IDs.'); process.exit(2)
}
const client=new pg.Pool({connectionString:url,max:1}),db=drizzle(client),actor={userId:operator},scope={kind:'user' as const,id:subject}
try {
  const known=await db.select({id:user.id}).from(user).where(eq(user.id,operator));const target=await db.select({id:user.id}).from(user).where(eq(user.id,subject));if(!known.length||!target.length)throw new AuthorizationError('invalid-input')
  const flags=defineFeatureFlags({managementGuard:async supplied=>supplied.userId===operator})
  const policy=defineAuthorization({actions:[{id:'dashboard.beta.read'}],roles:[{id:'dashboard-reader',actions:['dashboard.beta.read']}]},{managementGuard:async(supplied,targetScope)=>supplied.userId===operator&&targetScope.kind==='user'&&targetScope.id===subject})
  if(operation==='seed')await flags.createDefinition(db,actor,'beta.dashboard',{description:'Local optional dashboard preview',enabled:false})
  else if(operation==='toggle'){if(!['true','false'].includes(enabledRaw??''))throw new FeatureFlagsError('invalid-input');await flags.updateDefinition(db,actor,'beta.dashboard',Number(expectedRaw),{enabled:enabledRaw==='true',defaultValue:true})}
  else if(operation==='grant')await policy.grantRole(db,{...actor,scope:{kind:'user',id:operator}},{scope,userId:subject,roleId:'dashboard-reader'})
  else if(operation==='revoke')await policy.revokeRole(db,{...actor,scope:{kind:'user',id:operator}},{scope,userId:subject,roleId:'dashboard-reader'})
  else throw new AuthorizationError('invalid-input')
  console.info('[identity fixture] requested local operation completed')
}
catch(error){console.error(error instanceof FeatureFlagsError||error instanceof AuthorizationError?error.toJSON():{code:'unavailable',message:'Local fixture operation failed.',retryable:true});process.exitCode=1}
finally{await client.end()}
