<script setup lang="ts">
/**
 * Presentation only: renders a known `IconName` from `appIcons.ts`.
 * Not an icon registry, extension API, or place to load arbitrary components.
 * Monaco Codicons are remapped separately in monacoLucideIcons.ts.
 */
import { computed } from "vue";

import { APP_ICONS, type IconName } from "./appIcons";

export type { IconName };

const props = withDefaults(
  defineProps<{
    name: IconName;
    size?: number;
  }>(),
  { size: 16 },
);

const icon = computed(() => APP_ICONS[props.name]);
const filled = computed(() => props.name === "dirty");
</script>

<template>
  <component
    :is="icon"
    class="app-icon"
    :size="size"
    :style="{ '--app-icon-base-size': `${size}px` }"
    :stroke-width="filled ? 0 : 1.75"
    :fill="filled ? 'currentColor' : 'none'"
    aria-hidden="true"
  />
</template>

<style scoped>
.app-icon {
  display: block;
  flex-shrink: 0;
  width: calc(var(--app-icon-base-size) * var(--ui-icon-scale, 1));
  height: calc(var(--app-icon-base-size) * var(--ui-icon-scale, 1));
}
</style>
