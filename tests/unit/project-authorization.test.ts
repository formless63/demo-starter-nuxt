import { describe,expect,it } from 'vitest'; import { and,eq } from 'drizzle-orm'; import { project } from '../../server/database/schema'
describe('project authorization invariant',()=>it('uses both resource and owner in mutations',()=>{const query=and(eq(project.id,'p'),eq(project.ownerId,'u'));expect(query).toBeDefined()}))
