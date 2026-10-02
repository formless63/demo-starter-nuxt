<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { onNuxtReady } from '#app'
import { computed, ref } from 'vue'
import { createFixture, initialMetrics, type UploadMode } from '../fixtures/browser'
const metrics = ref({ ...initialMetrics })
const fixture = createFixture(value => { metrics.value = value })
const alternate = createFixture(value => { metrics.value = value }, true)
const other = ref(false)
const mounted = ref(true)
const hydrated = ref(false)
const current = computed(() => other.value ? alternate : fixture)
function mode(event: Event) { current.value.setMode((event.target as HTMLSelectElement).value as UploadMode) }
onNuxtReady(() => { hydrated.value = true })
</script>

<template>
  <main :data-fixture-hydrated="hydrated">
    <h1>File UI browser fixture</h1>
    <fieldset>
      <legend>Fixture controls</legend>
      <label for="fixture-upload-mode">Next upload</label>
      <select id="fixture-upload-mode" @change="mode">
        <option value="ready">Complete</option><option value="fail">Fail before confirmation</option>
        <option value="committed-error">Lose response after commit</option><option value="pending">Return pending</option>
        <option value="wait">Wait until cancelled</option><option value="cancel-race">Ignore cancellation until resolved</option>
      </select>
      <button type="button" @click="current.finishUpload">Finish pending upload</button>
      <button type="button" @click="current.failList">Fail next refresh</button>
      <button type="button" @click="current.failRemove">Fail next removal</button>
      <button type="button" @click="current.delayList">Delay next refresh</button>
      <button type="button" @click="current.finishList">Finish delayed refresh</button>
      <button type="button" @click="fixture.finishUpload">Finish original scope upload</button>
      <button type="button" @click="other = !other">Switch client scope</button>
      <button type="button" @click="mounted = !mounted">Toggle file UI</button>
      <output aria-label="Upload calls">{{ metrics.uploads }}</output>
      <output aria-label="Removal calls">{{ metrics.removals }}</output>
      <output aria-label="Retry mismatches">{{ metrics.retryMismatches }}</output>
    </fieldset>
    <FileManager v-if="mounted" :client="current.client" :max-bytes="1024" />
  </main>
</template>
