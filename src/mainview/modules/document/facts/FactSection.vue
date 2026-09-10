<script setup lang="ts">
/** Shared titled section for a group of document facts. */
import { computed, useId } from "vue";

const props = withDefaults(
  defineProps<{
    title: string;
    headingLevel?: 2 | 3;
  }>(),
  {
    headingLevel: 2,
  },
);

const headingId = useId();
const headingTag = computed(() => (props.headingLevel === 3 ? "h3" : "h2"));
</script>

<template>
  <section class="fact-section" :aria-labelledby="headingId">
    <header class="fact-section__header">
      <component :is="headingTag" :id="headingId" class="fact-section__title">
        {{ title }}
      </component>
    </header>

    <div class="fact-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "facts" as *;
@use "../../../styles/variables" as *;

.fact-section {
  @include fact-section;
}

.fact-section__header {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
}

.fact-section__title {
  @include fact-title;
}

.fact-section__body {
  min-width: 0;
}
</style>
