import type { H3Event } from 'h3'
export async function requireUser(event:H3Event) { const data=await useServerAuth().api.getSession!({headers:event.headers}); if(!data?.user) throw createError({statusCode:401,statusMessage:'Authentication required'}); return data.user }
