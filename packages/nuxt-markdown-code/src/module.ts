import { addComponent, addServerImports, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: '@repo/nuxt-markdown-code', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup(_options, nuxt) {
    const resolver = createResolver(import.meta.url)
    addComponent({ name: 'MarkdownContent', export: 'MarkdownContent', filePath: resolver.resolve('./runtime/components/MarkdownContent') })
    addServerImports([{ name: 'parseMarkdown', from: resolver.resolve('./runtime/server/index') }])
    nuxt.options.css.push(resolver.resolve('./runtime/markdown-code.css'))
    // Merge at setup: Nuxt's vite:extendConfig uses shallow copies.
    nuxt.options.vite.plugins ??= []
    nuxt.options.vite.plugins.push({
      name: 'nuxt-markdown-server-boundary', enforce: 'pre',
      resolveId(id, _importer, options) {
        if (!options.ssr && (id === '@repo/nuxt-markdown-code/server' || /nuxt-markdown-code\/(?:dist|src)\/runtime\/server(?:\/|$)/.test(id))) {
          throw new Error('Markdown parsing and highlighting are server-only. Import /components or /types in Vue code.')
        }
      },
    })
  },
})
