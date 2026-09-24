import { desc, eq } from 'drizzle-orm'; import { project } from '../../database/schema'
export default defineEventHandler(async event=>{const u=await requireUser(event); return useDb().select().from(project).where(eq(project.ownerId,u.id)).orderBy(desc(project.updatedAt))})
