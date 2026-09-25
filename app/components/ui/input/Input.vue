<script setup lang="ts">
import type { HTMLAttributes, InputHTMLAttributes } from 'vue'
import { useVModel } from '@vueuse/core'
import { cn } from '@/lib/utils'

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes['class']
  type?: InputHTMLAttributes['type']
}>()
const emits = defineEmits<{ 'update:modelValue': [payload: string | number] }>()
const modelValue = useVModel(props, 'modelValue', emits, { passive: true, defaultValue: props.defaultValue })
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :type="type"
    :class="cn('flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm', props.class)"
  >
</template>
