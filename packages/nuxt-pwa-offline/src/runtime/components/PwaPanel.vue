<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRuntimeConfig } from '#imports'
import { createPwaController, type PwaClientConfig } from '../client'

const config = useRuntimeConfig().public.pwaOffline as PwaClientConfig
const controller = createPwaController(config)
const state = shallowRef(controller.getServerSnapshot())
const hydrated = ref(false)
let unsubscribe: (() => void) | undefined
onMounted(() => {
  unsubscribe = controller.subscribe(() => { state.value = controller.getSnapshot() })
  state.value = controller.getSnapshot()
  hydrated.value = true
})
onBeforeUnmount(() => { unsubscribe?.(); hydrated.value = false })
</script>

<template>
  <section aria-label="Public offline support" :data-pwa-hydrated="hydrated">
    <p>Only a public offline notice and two icons are saved. Account content needs a connection.</p>
    <p role="status">{{ state.online ? 'Online' : 'Offline' }} · {{ state.status }} {{ state.message }}</p>
    <button :disabled="!hydrated || state.status === 'registering' || state.status === 'unsupported'" @click="controller.register()">Enable offline notice</button>
    <button :disabled="!hydrated || !state.canInstall" @click="controller.install()">Install app</button>
    <button :disabled="!hydrated || !['ready', 'waiting'].includes(state.status)" @click="controller.checkUpdate()">Check for updates</button>
    <button :disabled="!hydrated || state.status !== 'waiting'" @click="controller.later()">Later</button>
    <p v-if="!state.canInstall">Installation availability is controlled by your browser. Its menu may offer installation.</p>
  </section>
</template>
