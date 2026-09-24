import { project } from '../../database/schema'
export default defineEventHandler(async event=>{const u=await requireUser(event); const body=await readProjectInput(event); const [created]=await useDb().insert(project).values({id:crypto.randomUUID(),ownerId:u.id,...body}).returning(); setResponseStatus(event,201); return created})
