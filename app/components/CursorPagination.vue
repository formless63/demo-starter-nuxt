<script setup lang="ts">
import { Button } from '@/components/ui/button'
defineProps<{ label: string, page: number, hasNext: boolean, pending?: boolean }>()
defineEmits<{ previous: [], next: [] }>()
</script>

<template>
  <nav :aria-label="label" class="flex items-center gap-2 text-sm">
    <Button type="button" size="sm" variant="outline" :disabled="pending || page <= 1" @click="$emit('previous')">Previous</Button>
    <span>Page {{ page }}</span>
    <Button type="button" size="sm" variant="outline" :disabled="pending || !hasNext" @click="$emit('next')">Next</Button>
  </nav>
</template>
