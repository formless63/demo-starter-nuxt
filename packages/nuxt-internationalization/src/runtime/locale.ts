import { inject, onScopeDispose, provide, readonly, shallowRef, type InjectionKey, type ShallowRef } from 'vue'
import { createInternationalization, type I18nPayload, type I18nRuntime } from './i18n'
export type LocaleLoader = (locale: string, signal: AbortSignal) => Promise<I18nPayload>
const key: InjectionKey<Readonly<ShallowRef<I18nRuntime>>> = Symbol('internationalization')
export function provideInternationalization(runtime: ShallowRef<I18nRuntime>) { provide(key, runtime) }
export function useInternationalization() {
  const runtime = inject(key)
  if (!runtime) throw new Error('Internationalization provider required')
  return runtime
}
/** Stale loaders never touch a live composer, even when they ignore AbortSignal. */
export function useLocaleLoader(initial: I18nPayload, load: LocaleLoader) {
  const runtime = shallowRef(createInternationalization(initial))
  const status = shallowRef<'idle' | 'loading' | 'error'>('idle')
  let generation = 0
  let active = true
  let controller: AbortController | undefined
  const cancel = () => { generation++; controller?.abort(); controller = undefined; if (active) status.value = 'idle' }
  onScopeDispose(() => { active = false; cancel() })
  async function change(locale: string) {
    if (!active) return false
    const id = ++generation
    controller?.abort()
    const current = new AbortController()
    controller = current
    status.value = 'loading'
    try {
      const next = await load(locale, current.signal)
      if (!active || current.signal.aborted || generation !== id) return false
      const candidate = createInternationalization(next)
      if (candidate.payload.locale !== locale) { candidate.instance.dispose(); throw new Error('Unexpected locale') }
      if (!active || current.signal.aborted || generation !== id) { candidate.instance.dispose(); return false }
      const previous = runtime.value
      runtime.value = candidate
      status.value = 'idle'
      previous.instance.dispose()
      return true
    } catch {
      if (active && !current.signal.aborted && generation === id) status.value = 'error'
      return false
    }
  }
  onScopeDispose(() => runtime.value.instance.dispose())
  return { runtime, status: readonly(status), change, cancel }
}
