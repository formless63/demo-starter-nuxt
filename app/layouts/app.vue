<script setup lang="ts">
import { IconFolder, IconLogout, IconMenu2 } from '@tabler/icons-vue'
import { authClient } from '~~/lib/auth-client'
import { Button } from '@/components/ui/button'

const mobileNavigationOpen = ref(false)
const { data: session } = await authClient.useSession(useFetch)

async function signOut() {
  await authClient.signOut()
  await navigateTo('/')
}
</script>

<template>
  <div class="min-h-screen md:grid md:grid-cols-[240px_1fr]">
    <aside
      :class="[
        'border-r bg-card p-4 md:block',
        mobileNavigationOpen ? 'block' : 'hidden',
      ]"
    >
      <NuxtLink class="mb-8 block font-bold" to="/app">
        Nuxt Starter
      </NuxtLink>
      <nav>
        <NuxtLink
          class="flex items-center gap-2 rounded-lg p-2 hover:bg-accent"
          to="/app/projects"
        >
          <IconFolder :size="18" />
          Projects
        </NuxtLink>
      </nav>
    </aside>

    <section>
      <header class="flex h-16 items-center gap-3 border-b px-4">
        <Button
          class="md:hidden"
          size="icon"
          variant="ghost"
          aria-label="Toggle navigation"
          @click="mobileNavigationOpen = !mobileNavigationOpen"
        >
          <IconMenu2 />
        </Button>
        <span class="ml-auto text-sm text-muted-foreground">
          {{ session?.user.name || session?.user.email }}
        </span>
        <ThemeSelector />
        <Button variant="outline" @click="signOut">
          <IconLogout :size="16" />
          Logout
        </Button>
      </header>

      <main class="mx-auto max-w-5xl p-5 md:p-8">
        <slot />
      </main>
    </section>
  </div>
</template>
