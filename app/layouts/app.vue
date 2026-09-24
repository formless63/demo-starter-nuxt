<script setup lang="ts">
import { IconFolder, IconLogout, IconMenu2 } from '@tabler/icons-vue'
const { user, signOut } = useAuth()
const mobile = ref(false)
</script>
<template>
  <div class="min-h-screen md:grid md:grid-cols-[240px_1fr]">
    <aside :class="['border-r border-[var(--line)] p-4 md:block', mobile ? 'block' : 'hidden']">
      <NuxtLink class="mb-8 block font-bold" to="/app">Nuxt Starter</NuxtLink>
      <nav><NuxtLink class="flex items-center gap-2 rounded-lg p-2 hover:bg-gray-500/10" to="/app/projects"><IconFolder :size="18" />Projects</NuxtLink></nav>
    </aside>
    <section><header class="flex h-16 items-center gap-3 border-b border-[var(--line)] px-4"><button class="md:hidden" aria-label="Toggle navigation" @click="mobile=!mobile"><IconMenu2 /></button><span class="ml-auto text-sm text-[var(--muted)]">{{ user?.name || user?.email }}</span><ThemeSelector /><button class="btn btn-secondary" @click="signOut"><IconLogout :size="16" />Logout</button></header><main class="mx-auto max-w-5xl p-5 md:p-8"><slot /></main></section>
  </div>
</template>
