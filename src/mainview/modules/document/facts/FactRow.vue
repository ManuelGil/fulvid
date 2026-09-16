<script setup lang="ts">
/** Key/value row. Absent values are omitted rather than shown as errors. */
import { computed } from "vue";
import type { DocumentFact } from "./documentFacts";

// Recognize common absent markers, including an en dash users may paste from documents.
const ABSENT_VALUE =
  /^(-|–|N\/A|None|None declared|Unknown|No data|No value|Empty|No references)$/i;

const props = defineProps<{
  fact: DocumentFact;
}>();

const isPresent = computed(() => {
  const value = props.fact.value.trim();
  if (!value) {
    return false;
  }
  return !ABSENT_VALUE.test(value);
});
</script>

<template>
  <div v-if="isPresent" class="fact-row" role="group">
    <span class="fact-row__label">{{ fact.label }}</span>
    <span class="fact-row__value">{{ fact.value }}</span>
  </div>
</template>

<style scoped lang="scss">
@use "facts" as *;

.fact-row {
  @include fact-row;
}

.fact-row__label {
  @include fact-label;
}

.fact-row__value {
  @include fact-value;
}
</style>
