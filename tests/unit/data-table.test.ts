import { describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import DataTable from '../../packages/nuxt-data-table/src/runtime/components/DataTable.vue'

describe('mounted DataTable controlled pagination', () => {
  it('applies accepted Next/page-size changes and preserves rejected parent state', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const pagination = ref({ pageIndex: 0, pageSize: 2 })
    const accept = ref(true)
    const manual = ref(false)
    const globalFilter = ref('')
    const pageCount = ref(3)
    const data = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }]
    const columns = [{ accessorKey: 'name', header: 'Name' }]
    const app = createApp({
      setup: () => () => h(DataTable, {
        data,
        columns,
        rowId: (row: Record<string, unknown>) => String(row.id),
        pagination: pagination.value,
        globalFilter: globalFilter.value,
        manualFiltering: manual.value,
        manualPagination: manual.value,
        pageCount: pageCount.value,
        'onUpdate:pagination': (value) => { if (accept.value) pagination.value = value },
      }),
    })
    try {
      app.mount(host)
      await nextTick()
      const next = () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Next')!
      expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
      expect(next().disabled).toBe(false)
      next().click()
      await nextTick()
      await nextTick()
      expect(pagination.value.pageIndex).toBe(1)
      expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
      expect(host.querySelector('tbody')?.textContent).toContain('Gamma')
      expect(host.querySelector('nav')?.textContent).toContain('Page 2')
      expect(next().disabled).toBe(true)
      const size = host.querySelector('select')!
      size.value = '25'
      size.dispatchEvent(new Event('change', { bubbles: true }))
      await nextTick()
      await nextTick()
      expect(pagination.value).toEqual({ pageIndex: 0, pageSize: 25 })
      expect(host.querySelectorAll('tbody tr')).toHaveLength(3)
      pagination.value = { pageIndex: 0, pageSize: 2 }
      accept.value = false
      await nextTick()
      await nextTick()
      next().click()
      await nextTick()
      await nextTick()
      expect(pagination.value.pageIndex).toBe(0)
      expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
      expect(host.querySelector('nav')?.textContent).toContain('Page 1')
      globalFilter.value = 'Beta'
      await nextTick()
      await nextTick()
      expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
      expect(next().disabled).toBe(true)
      manual.value = true
      await nextTick()
      await nextTick()
      expect(host.querySelectorAll('tbody tr')).toHaveLength(3)
      expect(next().disabled).toBe(false)
      pageCount.value = 1
      await nextTick()
      await nextTick()
      expect(next().disabled).toBe(true)
      pageCount.value = 3
      manual.value = false
      await nextTick()
      await nextTick()
      expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
      expect(next().disabled).toBe(true)
      globalFilter.value = ''
      await nextTick()
      await nextTick()
      expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
      expect(next().disabled).toBe(false)
      pagination.value = { pageIndex: 0, pageSize: Infinity }
      await nextTick()
      await nextTick()
      expect(host.querySelectorAll('tbody tr')).toHaveLength(3)
      expect(host.querySelector('nav')?.textContent).toContain('Page 1')
      expect(next().disabled).toBe(true)

    }
    finally {
      app.unmount()
      host.remove()
    }
  })
})
