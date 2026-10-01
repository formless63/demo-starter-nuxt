import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq } from 'drizzle-orm'
import { defineFeatureFlags } from '@repo/nuxt-feature-flags/server'
import { defineAuthorization } from '@repo/nuxt-authorization/server'
import { flagDefinition, member, organization, organizationNote, roleAssignment, session, user } from '../../server/database/schema'

test('tenant boundaries, independent policy and private flags hold in HTTP and browser', async ({ request, page, baseURL }) => {
  const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter', { max: 4 })
  const db = drizzle(client)
  const prefix=crypto.randomUUID(),owner=`${prefix}-owner`,reader=`${prefix}-reader`,outsider=`${prefix}-outsider`,orgA=`${prefix}-a`,orgB=`${prefix}-b`
  const secret=process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars'
  const cookieName=process.env.PLAYWRIGHT_BASE_URL?'__Secure-better-auth.session_token':'better-auth.session_token'
  const tokens=new Map<string,string>()
  const flags=defineFeatureFlags({managementGuard:async actor=>actor.userId===owner})
  const policy=defineAuthorization({actions:[{id:'dashboard.beta.read'}],roles:[{id:'dashboard-reader',actions:['dashboard.beta.read']}]},{managementGuard:async actor=>actor.userId===owner})
  const previous=await db.select().from(flagDefinition).where(eq(flagDefinition.key,'beta.dashboard'))
  const headers=(id:string)=>({cookie:`${cookieName}=${encodeURIComponent(tokens.get(id)!)}`,origin:baseURL!})
  try {
    await db.insert(user).values([owner,reader,outsider].map(id=>({id,name:id===owner?'Fixture owner':'Fixture user',email:`${id}@example.test`,emailVerified:true})))
    await db.insert(organization).values([{id:orgA,name:'Fixture organization A',slug:`fixture-${prefix}-a`},{id:orgB,name:'Fixture organization B',slug:`fixture-${prefix}-b`}])
    await db.insert(member).values([{id:`${prefix}-owner-a`,organizationId:orgA,userId:owner,role:'owner'},{id:`${prefix}-owner-b`,organizationId:orgB,userId:owner,role:'owner'},{id:`${prefix}-reader`,organizationId:orgA,userId:reader,role:'member'}])
    for(const id of [owner,reader,outsider]) {const token=crypto.randomUUID();await db.insert(session).values({id:crypto.randomUUID(),token,userId:id,expiresAt:new Date(Date.now()+600000),activeOrganizationId:orgA});tokens.set(id,`${token}.${createHmac('sha256',secret).update(token).digest('base64')}`)}
    expect((await request.get(`/api/organizations/${orgA}/notes`)).status()).toBe(401)
    const created=await request.post(`/api/organizations/${orgA}/notes`,{headers:headers(owner),data:{title:'Organization A note'}})
    expect(created.status()).toBe(201)
    const note=await created.json()
    expect((await request.post(`/api/organizations/${orgA}/notes`,{headers:headers(reader),data:{title:'Forbidden'}})).status()).toBe(403)
    expect((await request.get(`/api/organizations/${orgA}/notes`,{headers:headers(outsider)})).status()).toBe(404)
    expect((await request.patch(`/api/organizations/${orgB}/notes/${note.id}`,{headers:headers(owner),data:{title:'Cross tenant'}})).status()).toBe(404)
    expect((await request.get(`/api/organizations/${orgB}/notes`,{headers:headers(owner)})).status()).toBe(200)
    const simultaneous=await Promise.all([request.get(`/api/organizations/${orgA}/notes`,{headers:headers(reader)}),request.get(`/api/organizations/${orgB}/notes`,{headers:headers(owner)})])
    expect((await simultaneous[0]!.json()).map((row:{id:string})=>row.id)).toEqual([note.id]);expect(await simultaneous[1]!.json()).toEqual([])
    const initial=await flags.evaluateBooleanDetails(db,'beta.dashboard')
    if(initial.reason==='not-found')await flags.createDefinition(db,{userId:owner},'beta.dashboard',{enabled:false})
    let revision=(await flags.evaluateBooleanDetails(db,'beta.dashboard')).revision!
    const changed=await flags.updateDefinition(db,{userId:owner},'beta.dashboard',revision,{enabled:true,defaultValue:true,rolloutBasisPoints:null});revision=changed.definition.revision
    const projection=await request.get('/api/feature-flags?userId=forged&tenantId=forged&keys=private.flag',{headers:headers(owner)})
    expect(projection.status()).toBe(200);expect(projection.headers()['cache-control']).toBe('private, no-store');expect(await projection.json()).toEqual({'beta.dashboard':true})
    expect((await request.get('/api/dashboard/beta',{headers:headers(owner)})).status()).toBe(403)
    const assignment={scope:{kind:'user' as const,id:owner},userId:owner,roleId:'dashboard-reader'}
    await policy.grantRole(db,{userId:owner,scope:{kind:'user',id:owner}},assignment)
    expect((await request.get('/api/dashboard/beta',{headers:headers(owner)})).status()).toBe(200)
    expect((await request.get('/api/dashboard/beta',{headers:headers(reader)})).status()).toBe(403)
    await policy.revokeRole(db,{userId:owner,scope:{kind:'user',id:owner}},assignment)
    expect((await request.get('/api/dashboard/beta',{headers:headers(owner)})).status()).toBe(403)
    await page.context().addCookies([{name:cookieName,value:encodeURIComponent(tokens.get(owner)!),url:baseURL!}])
    const projected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/feature-flags' && response.status() === 200)
    await page.goto('/app/projects')
    expect(await (await projected).json()).toEqual({ 'beta.dashboard': true })
    await expect(page.getByRole('region',{name:'Beta dashboard preview'})).toBeVisible()
    await page.getByRole('button',{name:'Read preview'}).click()
    await expect(page.getByRole('status')).toContainText('separate read-only permission')
    await flags.setOverride(db,{userId:owner},'beta.dashboard',revision,{targetKind:'tenant',targetId:orgB},false)
    await page.getByLabel('Organization',{exact:true}).selectOption(orgB)
    await expect(page.getByRole('region',{name:'Beta dashboard preview'})).toHaveCount(0)
    await page.goto(`/app/organizations/${orgA}`)
    await expect(page.getByRole('heading',{name:'Organization notes',exact:true})).toBeVisible()
    await expect(page.getByText('Organization A note',{exact:true})).toBeVisible()
    // Revocation invalidates tenant authority despite retained active selection and assignment.
    await db.delete(member).where(eq(member.id,`${prefix}-reader`))
    expect((await request.get(`/api/organizations/${orgA}/notes`,{headers:headers(reader)})).status()).toBe(404)
    expect(await (await request.get('/api/organizations/current',{headers:headers(reader)})).json()).toEqual({active:null})
  }
  finally {
    const current=await flags.evaluateBooleanDetails(db,'beta.dashboard')
    if(current.revision){let r=current.revision;const removed=await flags.removeOverride(db,{userId:owner},'beta.dashboard',r,{targetKind:'tenant',targetId:orgB});r=removed.definition.revision;const old=previous[0];await flags.updateDefinition(db,{userId:owner},'beta.dashboard',r,old?{enabled:old.enabled,defaultValue:old.defaultValue,rolloutBasisPoints:old.rolloutBasisPoints,description:old.description}:{enabled:false,defaultValue:false,rolloutBasisPoints:null})}
    await db.delete(roleAssignment).where(and(eq(roleAssignment.scopeKind,'user'),eq(roleAssignment.scopeId,owner)))
    for(const id of [orgA,orgB]){await db.delete(organizationNote).where(eq(organizationNote.organizationId,id));await db.delete(member).where(eq(member.organizationId,id));await db.delete(organization).where(eq(organization.id,id))}
    for(const id of [owner,reader,outsider])await db.delete(user).where(eq(user.id,id))
    await client.end()
  }
})
