<script setup lang="ts">
/** Supporting evidence line. */
withDefaults(
  defineProps<{
    text: string;
    live?: boolean;
  }>(),
  {
    live: false,
  },
);
</script>

<template>
  <p class="fact-evidence" :aria-live="live ? 'polite' : undefined">
    {{ text }}
  </p>
</template>

<style scoped lang="scss">
@use "facts" as *;

.fact-evidence {
  @include fact-evidence;
}
</style>
