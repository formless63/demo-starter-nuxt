# Internationalization evaluation

Native vue-i18n 11.4.13, verified against the current official npm listing on 2026-10-02, is selected for Nuxt/Vue Composition API integration. Official references: https://www.npmjs.com/package/vue-i18n and https://vue-i18n.intlify.dev/api/composition .

Explicit CLDR suffixes avoid treating Vue's ordinary pipe positions as universal language categories: https://vue-i18n.intlify.dev/guide/essentials/pluralization . The package validates the plain-text interpolation subset before native compilation, and uses fresh local engines instead of global locale mutation. The application keeps control of routing, document attributes, catalog fetching and persistence. No @nuxtjs/i18n route automation is required for this narrower contract.

Server-created initial formatting strings and pre-transport Unicode normalization provide one SSR/client model without assuming identical ICU builds. Generic package lifecycle and native browser acceptance remain completion gates, not waived by unit coverage.

Internationalization source `96c24efcfc7e6fa31381dc4839be80ef75293a7b` passed [all 26 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37052330442), including root native browser/production and packed install/types/build/provider/browser/removal/rebuild gates. It is completed, default-off and explicitly reference-enabled. This 25-capability composition includes accepted Flow / Canvas and the Rich Text focus fix from main `f1210c7c58dcebc24558042f34c39af9c03d1929`; full combined exact-head CI remains pending.
