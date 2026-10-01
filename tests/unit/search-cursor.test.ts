import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as source from '../../packages/nuxt-search/src/runtime/server'
import * as distributable from '@repo/nuxt-search/server'
import { project } from '../../server/database/schema'
import { invalidTokens, verifyCursorContract } from '../../fixtures/search-consumer/.fixture/cursor-contract'

for (const [name, codec] of [['source', source], ['distributable', distributable]] as const) {
  describe(`Search ${name} wire contract`, () => {
    it('matches canonical golden vectors and rejects alternate or malformed encodings', () => verifyCursorContract(codec))
    it('rejects invalid Unicode, query bounds and cursors before database access', async () => {
      const fetchRows = vi.fn().mockResolvedValue([])
      const columns = { vector: project.searchVector, updatedAt: project.updatedAt, id: project.id }
      for (const query of ['\0x', 'xx\ud800', 'xx\udfff', 'x', ' '.repeat(4), 'x'.repeat(257)]) {
        await expect(codec.searchRows(columns, eq(project.ownerId, 'owner'), { query }, fetchRows)).rejects.toMatchObject({ code: 'invalid-query' })
      }
      for (const cursor of invalidTokens) {
        await expect(codec.searchRows(columns, eq(project.ownerId, 'owner'), { query: 'valid', cursor }, fetchRows)).rejects.toMatchObject({ code: 'invalid-query' })
      }
      expect(fetchRows).not.toHaveBeenCalled()
      for (const query of ['  xx  ', '😀', '😀'.repeat(128)]) await codec.searchRows(columns, eq(project.ownerId, 'owner'), { query }, fetchRows)
      expect(fetchRows).toHaveBeenCalledTimes(3)
    })
  })
}
