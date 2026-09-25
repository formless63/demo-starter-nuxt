<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { useVModel } from '@vueuse/core'
import { cn } from '@/lib/utils'

const props = defineProps<{ defaultValue?: string, modelValue?: string, class?: HTMLAttributes['class'] }>()
const emits = defineEmits<{ 'update:modelValue': [payload: string] }>()
const modelValue = useVModel(props, 'modelValue', emits, { passive: true, defaultValue: props.defaultValue })
</script>

<template>
  <textarea
    v-model="modelValue"
    data-slot="textarea"
    :class="cn('flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', props.class)"
  />
</template>
