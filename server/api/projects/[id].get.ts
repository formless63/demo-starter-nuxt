import { and,eq } from 'drizzle-orm'; import { project } from '../../database/schema'
export default defineEventHandler(async event=>{const u=await requireUser(event); const [row]=await useDb().select().from(project).where(and(eq(project.id,getRouterParam(event,'id')!),eq(project.ownerId,u.id))).limit(1); if(!row) throw createError({statusCode:404,statusMessage:'Project not found'}); return row})
