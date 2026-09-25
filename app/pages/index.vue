<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { safeRedirectPath } from '@/lib/safe-redirect'

definePageMeta({ layout: 'default' })

const config = useRuntimeConfig()
const route = useRoute()
const email = ref('')
const magicLinkSent = ref(false)
const callbackURL = computed(() => safeRedirectPath(route.query.redirect))
const { data: session } = await authClient.useSession(useFetch)

if (session.value) {
  await navigateTo(callbackURL.value)
}

async function signInWithGitHub() {
  await authClient.signIn.social({ provider: 'github', callbackURL: callbackURL.value })
}

async function signInWithOidc() {
  await authClient.signIn.social({ provider: 'oidc', callbackURL: callbackURL.value })
}

async function requestMagicLink() {
  await authClient.signIn.magicLink({ email: email.value, callbackURL: callbackURL.value })
  magicLinkSent.value = true
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-lg items-center p-6">
    <section class="w-full space-y-5">
      <p class="font-semibold text-primary">Nuxt full-stack starter</p>
      <h1 class="text-4xl font-bold">A practical base for your next project.</h1>
      <p class="text-muted-foreground">
        Nuxt 4, PostgreSQL, Better Auth, and one complete feature—ready to extend.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Choose any provider configured for this deployment.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          <Button class="w-full" @click="signInWithGitHub">
            Continue with GitHub
          </Button>
          <Button class="w-full" variant="outline" @click="signInWithOidc">
            Continue with OIDC
          </Button>

          <form
            v-if="config.public.magicLinkEnabled"
            class="flex gap-2"
            @submit.prevent="requestMagicLink"
          >
            <Input v-model="email" type="email" required placeholder="you@example.com" />
            <Button type="submit">Email link</Button>
          </form>
          <p v-if="magicLinkSent" role="status">Check your inbox.</p>
        </CardContent>
      </Card>
    </section>
  </div>
</template>
