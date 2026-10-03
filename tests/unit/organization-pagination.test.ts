import { describe, expect, it } from 'vitest'
import { createApp, effectScope, h, nextTick, ref } from 'vue'
import { useCursorPagination } from '../../app/composables/useCursorPagination'
import { organizationRefreshKeys } from '../../app/utils/organization-refresh'
import CursorPagination from '../../app/components/CursorPagination.vue'

// Ordinary local state only: no auth clients, HTTP, database or fixture scripts.
describe('identity-scoped cursor navigation', () => {
  it('retains cursor history for previous pages and ignores empty/repeated next cursors', () => {
    const scope = effectScope()
    const pagination = scope.run(() => useCursorPagination(() => 'user-a:organization-a'))!
    try {
      pagination.next('page-2')
      pagination.next('page-2')
      pagination.next(undefined)
      expect(pagination.page.value).toBe(2)
      pagination.next('page-3')
      expect(pagination.page.value).toBe(3)
      pagination.previous()
      expect(pagination.cursor.value).toBe('page-2')
      pagination.previous()
      expect(pagination.cursor.value).toBeUndefined()
      pagination.previous()
      expect(pagination.page.value).toBe(1)
    }
    finally { scope.stop() }
  })
  it('clears history synchronously when either account or organization changes', () => {
    const account = ref('a'), organization = ref('one'), scope = effectScope()
    const pagination = scope.run(() => useCursorPagination(() => `${account.value}:${organization.value}`))!
    try {
      pagination.next('old-organization-cursor')
      organization.value = 'two'
      expect(pagination.cursor.value).toBeUndefined()
      expect(pagination.page.value).toBe(1)
      pagination.next('old-account-cursor')
      account.value = 'b'
      expect(pagination.cursor.value).toBeUndefined()
      expect(pagination.page.value).toBe(1)
      pagination.next('new-page')
      pagination.reset()
      expect(pagination.cursor.value).toBeUndefined()
    }
    finally { scope.stop() }
  })
})

describe('cursor controls', () => {
  it('disables invalid/pending navigation and emits only enabled actions', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const page = ref(1), pending = ref(false), hasNext = ref(true)
    let previousCalls = 0, nextCalls = 0
    const app = createApp({ setup: () => () => h(CursorPagination, {
      label: 'Member pages', page: page.value, pending: pending.value, hasNext: hasNext.value,
      onPrevious: () => previousCalls++, onNext: () => nextCalls++,
    }) })
    try {
      app.mount(host)
      await nextTick()
      const buttons = () => [...host.querySelectorAll('button')]
      expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Member pages')
      expect(buttons()[0]!.disabled).toBe(true)
      buttons()[1]!.click()
      expect(nextCalls).toBe(1)
      page.value = 2; pending.value = true
      await nextTick()
      expect(buttons().every(button => button.disabled)).toBe(true)
      pending.value = false; hasNext.value = false
      await nextTick()
      expect(buttons()[1]!.disabled).toBe(true)
      buttons()[0]!.click()
      expect(previousCalls).toBe(1)
    }
    finally { app.unmount(); host.remove() }
  })
})


describe('organization refresh namespace', () => {
  it('selects exact current-account keys and all its cursor pages only', () => {
    const keys = ['organization-current:a', 'organizations-switcher:a:first', 'organizations-switcher:a:cursor', 'organizations-settings:a:first', 'organization-current:ab', 'organizations-switcher:ab:first', 'organizations-settings:b:first', 'organization-notes:a:one', 'unrelated']
    expect(organizationRefreshKeys(keys, 'a')).toEqual(keys.slice(0, 4))
    expect(organizationRefreshKeys(keys, 'missing')).toEqual([])
    const opaqueKeys = ['organization-current:a', 'organizations-switcher:a:first', 'organization-current:a%3Ab', 'organizations-settings:a%3Ab:first']
    expect(organizationRefreshKeys(opaqueKeys, 'a:b')).toEqual(opaqueKeys.slice(2))
    expect(organizationRefreshKeys(opaqueKeys, 'a')).toEqual(opaqueKeys.slice(0, 2))
  })
})
