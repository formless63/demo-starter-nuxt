import { addComponent, createResolver, defineNuxtModule } from '@nuxt/kit'
export default defineNuxtModule({
  meta: { name: '@repo/nuxt-rich-text', configKey: 'richText', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  setup(_, nuxt) {
    const optimizeDeps = nuxt.options.vite.optimizeDeps ?? {}
    nuxt.options.vite.optimizeDeps = { ...optimizeDeps, include: [...new Set([...(optimizeDeps.include ?? []), '@tiptap/vue-3', '@tiptap/core', '@tiptap/pm/state', '@tiptap/starter-kit'])] }
    const resolver = createResolver(import.meta.url)
    for (const name of ['RichTextContent', 'RichTextEditor']) addComponent({ name, filePath: resolver.resolve(`./runtime/components/${name}.vue`) })
  },
})
