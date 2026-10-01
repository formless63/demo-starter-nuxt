// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import * as source from '../../packages/nuxt-notifications/src/runtime/server'
import * as distributable from '@repo/nuxt-notifications/server'
import { validTitles, verifyNotificationContract } from '../../fixtures/notifications-consumer/.fixture/contract-vectors'

for (const [name, api] of [['source', source], ['distributable', distributable]] as const) {
  describe(`Notifications ${name} contract`, () => {
    it('shares strict create/list types and preserves bounded titles and metadata keys', async () => verifyNotificationContract(api))
  })
}
it('renders markup-looking titles as escaped plain text', async () => {
  const title = validTitles[1]!
  const rendered = await renderToString(createSSRApp({ render: () => h('span', title) }))
  expect(rendered).toBe('<span>  &lt;tag&gt; &amp; text  </span>')
})
