<script setup lang="ts">
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-vue'
const mode = useColorMode()
const options = [{ value:'light', label:'Light', icon:IconSun }, { value:'dark', label:'Dark', icon:IconMoon }, { value:'system', label:'System', icon:IconDeviceDesktop }]
</script>
<template><label class="sr-only" for="theme">Theme</label><select id="theme" v-model="mode.preference" class="field !w-auto" aria-label="Theme"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select></template>
