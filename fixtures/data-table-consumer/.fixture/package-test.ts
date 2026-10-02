import { strict as assert } from 'node:assert'
assert.equal(typeof (await import('@repo/nuxt-data-table/runtime')).default, 'undefined')
console.log('data-table package runtime exports verified')
