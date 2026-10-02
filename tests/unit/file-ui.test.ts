import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, shallowRef } from 'vue'
import FileManager from '../../packages/nuxt-file-ui/src/runtime/components/FileManager.vue'
import type { FileClient } from '../../packages/nuxt-file-ui/src/runtime/client'
import type { FileView } from '../../packages/nuxt-file-ui/src/runtime/contract'

const cleanups = new Set<() => void>()
afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  cleanups.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
async function flush() {
  for (let index = 0; index < 5; index++) await nextTick()
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function receipt(id = 'report', state: FileView['state'] = 'ready'): FileView {
  return { id, name: `${id}.txt`, type: 'text/plain', size: 12, state }
}
function makeClient(files: FileView[] = []) {
  return {
    list: vi.fn<FileClient['list']>().mockResolvedValue(files),
    upload: vi.fn<FileClient['upload']>().mockImplementation(async file => ({ ...receipt(), name: file.name, type: file.type, size: file.size })),
    remove: vi.fn<FileClient['remove']>().mockImplementation(async id => receipt(id, 'removed')),
    downloadUrl: vi.fn<FileClient['downloadUrl']>().mockImplementation(id => `/api/files/download?id=${encodeURIComponent(id)}`),
  }
}
type Props = { client?: FileClient; endpoint?: string; maxBytes?: number; label?: string }
function mount(initial: Props) {
  const props = shallowRef(initial)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ setup: () => () => h(FileManager, props.value) })
  app.mount(host)
  let active = true
  const unmount = () => {
    if (!active) return
    active = false
    app.unmount()
    host.remove()
    cleanups.delete(unmount)
  }
  cleanups.add(unmount)
  return { host, props, unmount }
}
function button(host: HTMLElement, name: string) {
  const element = [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => (value.getAttribute('aria-label') ?? value.textContent?.trim()) === name)
  expect(element, `Expected a button named ${name}`).toBeTruthy()
  return element!
}
function choose(host: HTMLElement, file = new File(['report'], 'report.txt', { type: 'text/plain' })) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return file
}
function submit(host: HTMLElement) {
  const event = new Event('submit', { bubbles: true, cancelable: true })
  host.querySelector('form')!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
}
function output(host: HTMLElement) { return host.querySelector('output')!.textContent }
function row(host: HTMLElement, state: FileView['state']) { return host.querySelector<HTMLTableRowElement>(`tr[data-file-state="${state}"]`) }

describe('mounted native Vue FileManager', () => {
  it('has accessible loading, empty, refresh failure and recovery states', async () => {
    const list = deferred<FileView[]>()
    const client = makeClient()
    client.list.mockReturnValueOnce(list.promise)
    const { host } = mount({ client, label: 'Private documents' })
    expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id)
    expect(host.querySelector('caption')?.textContent).toBe('Private documents')
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(host.querySelector('label')?.htmlFor).toBe(input.id)
    for (const id of input.getAttribute('aria-describedby')!.split(' ')) expect(document.getElementById(id)).toBeTruthy()
    expect(host.querySelector('output')?.getAttribute('aria-live')).toBe('polite')
    expect(host.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(button(host, 'Refresh files').disabled).toBe(true)
    expect(button(host, 'Upload file').disabled).toBe(true)
    list.resolve([])
    await flush()
    expect(host.textContent).toContain('No files to display.')
    expect(output(host)).toBe('0 files loaded.')
    expect(button(host, 'Refresh files').disabled).toBe(false)
    client.list.mockRejectedValueOnce(new Error('private backend diagnostic'))
    button(host, 'Refresh files').click()
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not refresh files')
    expect(host.textContent).not.toContain('private backend diagnostic')
    client.list.mockResolvedValueOnce([receipt()])
    button(host, 'Refresh files').click()
    await flush()
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(output(host)).toBe('1 file loaded.')
    expect(row(host, 'ready')).toBeTruthy()
  })

  it('renders server states, escaped metadata and attachment-only download controls', async () => {
    const ready = { ...receipt('safe'), name: '<img src=x onerror=alert(1)>.txt' }
    const client = makeClient([receipt('uploading', 'uploading'), ready, receipt('cleanup', 'cleanup-pending'), receipt('removed', 'removed'), receipt('unsafe')])
    client.downloadUrl.mockImplementation(id => id === 'unsafe' ? 'javascript:alert(1)' : `/download?id=${id}`)
    const { host } = mount({ client })
    await flush()
    expect(host.querySelectorAll('th[scope="col"]')).toHaveLength(4)
    expect(host.querySelectorAll('th[scope="row"]')).toHaveLength(5)
    expect(row(host, 'uploading')?.textContent).toContain('Awaiting upload confirmation')
    expect(row(host, 'cleanup-pending')?.textContent).toContain('Cleanup pending')
    expect(row(host, 'removed')?.textContent).toContain('Removed')
    expect(row(host, 'removed')?.querySelector('button, a')).toBeNull()
    expect(row(host, 'uploading')?.querySelector('a')).toBeNull()
    expect(row(host, 'cleanup-pending')?.querySelector('a')).toBeNull()
    expect(button(host, 'Retry removal of cleanup.txt')).toBeTruthy()
    expect(host.querySelectorAll('a')).toHaveLength(1)
    const download = host.querySelector('a')!
    expect(download.getAttribute('href')).toBe('/download?id=safe')
    expect(download.getAttribute('download')).toBe(ready.name)
    expect(download.getAttribute('aria-label')).toBe(`Download ${ready.name}`)
    expect(host.textContent).toContain(ready.name)
    expect(host.textContent).toContain('Download unavailable')
    expect(host.querySelector('img, iframe, object, embed')).toBeNull()
    expect(host.querySelectorAll('details summary')).toHaveLength(5)
    expect(client.downloadUrl.mock.calls.map(([id]) => id)).toEqual(['safe', 'unsafe'])
  })

  it('rejects oversized files before transport and rechecks a changed limit', async () => {
    const client = makeClient()
    const { host, props } = mount({ client, maxBytes: 4 })
    await flush()
    choose(host, new File(['12345'], 'large.txt'))
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Choose a file no larger than 4 bytes.')
    expect(button(host, 'Upload file').disabled).toBe(true)
    submit(host)
    expect(client.upload).not.toHaveBeenCalled()
    choose(host, new File(['1234'], 'small.txt'))
    await flush()
    props.value = { client, maxBytes: 2 }
    await flush()
    submit(host)
    await flush()
    expect(client.upload).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Choose a file no larger than 2 bytes.')
  })

  it('serializes submissions and reports success only after a ready receipt', async () => {
    const upload = deferred<FileView>()
    const client = makeClient()
    client.upload.mockReturnValueOnce(upload.promise)
    const { host } = mount({ client })
    await flush()
    const file = choose(host)
    submit(host)
    submit(host)
    expect(client.upload).toHaveBeenCalledTimes(1)
    await flush()
    expect(button(host, 'Upload file').disabled).toBe(true)
    expect(button(host, 'Refresh files').disabled).toBe(true)
    expect(button(host, 'Clear selection').disabled).toBe(true)
    expect(host.querySelector<HTMLInputElement>('input')?.disabled).toBe(true)
    expect(output(host)).toBe('Uploading report.txt…')
    expect(row(host, 'ready')).toBeNull()
    upload.resolve({ ...receipt(), name: file.name })
    await flush()
    expect(row(host, 'ready')).toBeTruthy()
    expect(output(host)).toBe('Uploaded report.txt.')
    expect(host.textContent).toContain('No file selected.')
    expect(button(host, 'Upload file').disabled).toBe(true)
  })

  it('retries uncertain responses with the exact original File and immutable token', async () => {
    const client = makeClient()
    client.upload.mockRejectedValueOnce(new Error('response lost'))
    const { host } = mount({ client })
    await flush()
    const file = choose(host)
    submit(host)
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('The server may still have received it')
    expect(button(host, 'Retry upload').disabled).toBe(false)
    submit(host)
    await flush()
    const [first, second] = client.upload.mock.calls
    expect(first![0]).toBe(file)
    expect(second![0]).toBe(first![0])
    expect(first![1]).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(second![1]).toBe(first![1])
    expect(second![2]).not.toBe(first![2])
    expect(output(host)).toBe('Uploaded report.txt.')
    choose(host, file)
    submit(host)
    await flush()
    expect(client.upload.mock.calls[2]![1]).not.toBe(first![1])
  })

  it('keeps cancellation uncertain and locked until settlement, then retains a safe retry', async () => {
    const upload = deferred<FileView>()
    const client = makeClient()
    client.upload.mockReturnValueOnce(upload.promise)
    const { host } = mount({ client })
    await flush()
    const file = choose(host)
    submit(host)
    await flush()
    button(host, 'Cancel upload').click()
    await flush()
    expect(client.upload.mock.calls[0]![2].aborted).toBe(true)
    expect(output(host)).toContain('Waiting for this request to settle')
    expect(button(host, 'Cancelling…').disabled).toBe(true)
    expect(button(host, 'Upload file').disabled).toBe(true)
    choose(host, new File(['different'], 'replacement.txt'))
    submit(host)
    await flush()
    expect(client.upload).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Selected: report.txt')
    upload.reject(new DOMException('Aborted', 'AbortError'))
    await flush()
    expect(output(host)).toContain('Upload cancelled locally. The server may still have received it.')
    expect(row(host, 'removed')).toBeNull()
    expect(button(host, 'Retry upload').disabled).toBe(false)
    submit(host)
    await flush()
    expect(client.upload.mock.calls[1]![0]).toBe(file)
    expect(client.upload.mock.calls[1]![1]).toBe(client.upload.mock.calls[0]![1])
    expect(client.upload.mock.calls[1]![2].aborted).toBe(false)
  })

  it('honors a ready server response that arrives despite local cancellation', async () => {
    const upload = deferred<FileView>()
    const client = makeClient()
    client.upload.mockReturnValueOnce(upload.promise)
    const { host } = mount({ client })
    await flush()
    choose(host)
    submit(host)
    await flush()
    button(host, 'Cancel upload').click()
    upload.resolve(receipt())
    await flush()
    expect(row(host, 'ready')).toBeTruthy()
    expect(output(host)).toBe('The server confirmed the upload completed despite local cancellation.')
    expect(host.textContent).toContain('No file selected.')
    expect(button(host, 'Upload file').disabled).toBe(true)
  })

  it.each(['uploading', 'cleanup-pending', 'removed'] as const)('does not call an upload successful for a %s receipt', async (state) => {
    const client = makeClient()
    client.upload.mockResolvedValue(receipt('report', state))
    const { host } = mount({ client })
    await flush()
    const file = choose(host)
    submit(host)
    await flush()
    expect(row(host, state)).toBeTruthy()
    expect(output(host)).not.toContain('Uploaded')
    expect(host.querySelector('a[download]')).toBeNull()
    expect(button(host, 'Retry upload').disabled).toBe(false)
    submit(host)
    await flush()
    expect(client.upload.mock.calls[1]![0]).toBe(file)
    expect(client.upload.mock.calls[1]![1]).toBe(client.upload.mock.calls[0]![1])
  })

  it('retains cleanup-pending receipts and confirms removal only after the server does', async () => {
    const removal = deferred<FileView>()
    const client = makeClient([receipt()])
    client.remove.mockReturnValueOnce(removal.promise)
    const { host } = mount({ client })
    await flush()
    const remove = button(host, 'Remove report.txt')
    remove.click()
    remove.click()
    expect(client.remove).toHaveBeenCalledTimes(1)
    await flush()
    expect(button(host, 'Remove report.txt').disabled).toBe(true)
    expect(button(host, 'Refresh files').disabled).toBe(true)
    expect(output(host)).toBe('Removing report.txt…')
    removal.resolve(receipt('report', 'cleanup-pending'))
    await flush()
    expect(row(host, 'cleanup-pending')).toBeTruthy()
    expect(output(host)).toContain('Removal is pending storage cleanup')
    expect(host.querySelector('a[download]')).toBeNull()
    button(host, 'Retry removal of report.txt').click()
    await flush()
    expect(client.remove.mock.calls).toEqual([['report'], ['report']])
    expect(row(host, 'removed')).toBeTruthy()
    expect(output(host)).toBe('Removed report.txt.')
    expect(row(host, 'removed')?.querySelector('button')).toBeNull()
  })

  it('preserves last confirmed state on removal and refresh failures', async () => {
    const client = makeClient([receipt()])
    client.remove.mockRejectedValueOnce(new Error('sensitive removal error'))
    const { host } = mount({ client })
    await flush()
    button(host, 'Remove report.txt').click()
    await flush()
    expect(row(host, 'ready')).toBeTruthy()
    expect(row(host, 'removed')).toBeNull()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Removal could not be confirmed')
    expect(host.textContent).not.toContain('sensitive removal error')
    client.list.mockRejectedValueOnce(new Error('refresh failure'))
    button(host, 'Refresh files').click()
    await flush()
    expect(row(host, 'ready')).toBeTruthy()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('displayed list may be out of date')
  })

  it('aborts an older list and prevents its late response from overwriting an upload', async () => {
    const list = deferred<FileView[]>()
    const client = makeClient()
    client.list.mockReturnValueOnce(list.promise)
    const { host } = mount({ client })
    const signal = client.list.mock.calls[0]![0]!
    choose(host)
    submit(host)
    await flush()
    expect(signal.aborted).toBe(true)
    expect(row(host, 'ready')?.textContent).toContain('report.txt')
    list.resolve([receipt('stale')])
    await flush()
    expect(host.textContent).not.toContain('stale.txt')
    expect(output(host)).toBe('Uploaded report.txt.')
  })

  it('clears file identity on deliberate clear while keeping the uncertainty warning', async () => {
    const client = makeClient()
    client.upload.mockRejectedValueOnce(new Error('lost response'))
    const { host } = mount({ client })
    await flush()
    const file = choose(host)
    submit(host)
    await flush()
    button(host, 'Clear selection').click()
    await flush()
    expect(output(host)).toContain('earlier upload is still unconfirmed')
    expect(button(host, 'Upload file').disabled).toBe(true)
    expect(host.querySelector('[role="alert"]')).toBeNull()
    choose(host, file)
    submit(host)
    await flush()
    expect(client.upload.mock.calls[1]![1]).not.toBe(client.upload.mock.calls[0]![1])
  })

  it('aborts and isolates in-flight uploads when the client scope changes', async () => {
    const upload = deferred<FileView>()
    const first = makeClient([receipt('private-old')])
    first.upload.mockReturnValueOnce(upload.promise)
    const second = makeClient([receipt('new-account')])
    const { host, props } = mount({ client: first })
    await flush()
    choose(host)
    submit(host)
    await flush()
    props.value = { client: second }
    await flush()
    expect(first.upload.mock.calls[0]![2].aborted).toBe(true)
    expect(host.textContent).not.toContain('private-old.txt')
    expect(host.textContent).toContain('new-account.txt')
    expect(host.textContent).toContain('No file selected.')
    expect(button(host, 'Upload file').disabled).toBe(true)
    upload.resolve(receipt('late-private'))
    await flush()
    expect(host.textContent).not.toContain('late-private.txt')
    expect(output(host)).toBe('1 file loaded.')
  })

  it('ignores non-cancellable remove results from the previous client scope', async () => {
    const removal = deferred<FileView>()
    const first = makeClient([receipt('old')])
    first.remove.mockReturnValueOnce(removal.promise)
    const second = makeClient([receipt('new')])
    const { host, props } = mount({ client: first })
    await flush()
    button(host, 'Remove old.txt').click()
    props.value = { client: second }
    await flush()
    removal.resolve(receipt('old', 'removed'))
    await flush()
    expect(host.textContent).toContain('new.txt')
    expect(host.textContent).not.toContain('old.txt')
    expect(output(host)).toBe('1 file loaded.')
  })

  it('aborts an old scope list and ignores late errors', async () => {
    const list = deferred<FileView[]>()
    const first = makeClient()
    first.list.mockReturnValueOnce(list.promise)
    const second = makeClient([receipt('current')])
    const { host, props } = mount({ client: first })
    props.value = { client: second }
    await flush()
    expect(first.list.mock.calls[0]![0]?.aborted).toBe(true)
    list.reject(new Error('stale error'))
    await flush()
    expect(host.textContent).toContain('current.txt')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('uses the default or overridden endpoint and isolates endpoint changes', async () => {
    const oldList = deferred<Response>()
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify([receipt('new-endpoint')]), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const { host, props } = mount({})
    await flush()
    expect(fetcher.mock.calls[0]![0]).toBe('/api/files/list')
    button(host, 'Refresh files').click()
    await flush()
    props.value = { endpoint: '/custom/files' }
    await flush()
    expect((fetcher.mock.calls[1]![1]?.signal as AbortSignal).aborted).toBe(true)
    expect(fetcher.mock.calls[2]![0]).toBe('/custom/files/list')
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/custom/files/download?id=new-endpoint')
    oldList.resolve(new Response(JSON.stringify([receipt('old-endpoint')]), { status: 200 }))
    await flush()
    expect(host.textContent).not.toContain('old-endpoint.txt')
    expect(host.textContent).toContain('new-endpoint.txt')
  })

  it('aborts list/upload lifetimes on unmount and consumes late rejections', async () => {
    const list = deferred<FileView[]>()
    const listing = makeClient()
    listing.list.mockReturnValueOnce(list.promise)
    const first = mount({ client: listing })
    first.unmount()
    expect(listing.list.mock.calls[0]![0]?.aborted).toBe(true)
    list.reject(new Error('list rejected after unmount'))
    const upload = deferred<FileView>()
    const uploading = makeClient()
    uploading.upload.mockReturnValueOnce(upload.promise)
    const second = mount({ client: uploading })
    await flush()
    choose(second.host)
    submit(second.host)
    await flush()
    second.unmount()
    expect(uploading.upload.mock.calls[0]![2].aborted).toBe(true)
    upload.reject(new Error('upload rejected after unmount'))
    await flush()
    expect(document.querySelector('.file-manager')).toBeNull()
  })

  it('consumes late removal rejection after unmount', async () => {
    const removal = deferred<FileView>()
    const client = makeClient([receipt()])
    client.remove.mockReturnValueOnce(removal.promise)
    const { host, unmount } = mount({ client })
    await flush()
    button(host, 'Remove report.txt').click()
    unmount()
    removal.reject(new Error('removal rejected after unmount'))
    await flush()
    expect(document.querySelector('.file-manager')).toBeNull()
  })
})
