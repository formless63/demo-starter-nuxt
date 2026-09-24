<script setup lang="ts">
definePageMeta({ layout: 'default' })
const { client, user } = useAuth(); const config = useRuntimeConfig(); const email = ref(''); const sent = ref(false)
if (user.value) await navigateTo('/app/projects')
async function github() { await client.signIn.social({ provider:'github', callbackURL:'/app/projects' }) }
async function oidc() { await client.signIn.social({ provider:'oidc', callbackURL:'/app/projects' }) }
async function magic() { await client.signIn.magicLink({ email:email.value, callbackURL:'/app/projects' }); sent.value=true }
</script>
<template><div class="mx-auto flex min-h-screen max-w-lg items-center p-6"><section class="w-full space-y-5"><p class="font-semibold text-blue-600">Nuxt full-stack starter</p><h1 class="text-4xl font-bold">A practical base for your next project.</h1><p class="text-[var(--muted)]">Nuxt 4, PostgreSQL, Better Auth, and one complete feature—ready to extend.</p><div class="card space-y-3"><h2 class="text-lg font-semibold">Sign in</h2><button class="btn w-full justify-center" @click="github">Continue with GitHub</button><button class="btn btn-secondary w-full justify-center" @click="oidc">Continue with OIDC</button><form v-if="config.public.magicLinkEnabled" class="flex gap-2" @submit.prevent="magic"><input v-model="email" class="field" type="email" required placeholder="you@example.com"><button class="btn">Email link</button></form><p v-if="sent" role="status">Check your inbox.</p></div></section></div></template>
