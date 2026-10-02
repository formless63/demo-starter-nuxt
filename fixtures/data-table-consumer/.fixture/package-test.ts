import { strict as assert } from 'node:assert'
import { ref } from 'vue'
import { createSortedRowModel, rowSelectionFeature, rowSortingFeature, tableFeatures, useTable } from '@tanstack/vue-table'

const data = ref([{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }, { id: 'c', name: 'Gamma' }])
const table = useTable({
  features: tableFeatures({ rowSortingFeature, rowSelectionFeature, sortedRowModel: createSortedRowModel() }),
  data,
  columns: [{ accessorKey: 'name', header: 'Name', enableSorting: true }],
  getRowId: row => row.id,
})
assert.deepEqual(table.getRowModel().rows.map(row => row.id), ['b', 'a', 'c'])
assert.equal(table.getRowModel().rows[0]?.getValue('name'), 'Beta')
table.getColumn('name')?.toggleSorting(false)
assert.deepEqual(table.getRowModel().rows.map(row => row.id), ['a', 'b', 'c'])
table.setRowSelection({ a: true })
assert.deepEqual(table.getSelectedRowModel().rows.map(row => row.id), ['a'])
data.value = [data.value[2]!, data.value[0]!, data.value[1]!]
assert.deepEqual(table.getRowModel().rows.map(row => row.id), ['a', 'b', 'c'])
console.log('data-table behavioral API assertions passed')

const port = 4317
const server = Bun.spawn(['bun', 'run', 'start'], { cwd: process.cwd(), env: { ...Bun.env, PORT: String(port) }, stdout: 'ignore', stderr: 'inherit' })
try {
  let response: Response | undefined
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/`)
    } catch { /* Retry only connection failures while the server starts. */ }
    if (response) break
    await Bun.sleep(200)
  }
  assert.ok(response, 'fixture server did not become ready')
  const html = await response.text()
  assert.equal(response.status, 200, `Packaged SSR returned HTTP ${response.status}: ${html.slice(-2000)}`)
  assert.match(html, /<table>/)
  assert.match(html, /Alpha/)
  assert.match(html, /Beta/)
  assert.match(html, /Select rows/)
  assert.match(html, /Select row a/)
  assert.match(html, /aria-label="Data table"/)
  console.log('data-table packaged SSR assertions passed')
} finally {
  server.kill()
  await server.exited
}
