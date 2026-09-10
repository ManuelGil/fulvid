<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    text?: string;
    live?: boolean;
    /** Empty-state pacing - reassure (Workspace) vs invite vs direct (Search). */
    pace?: "reassure" | "invite" | "direct";
  }>(),
  { live: false, pace: "invite" },
);
</script>

<template>
  <section
    class="empty-state"
    :class="{ [`empty-state--${pace}`]: pace !== 'invite' }"
    :aria-live="live ? 'polite' : undefined"
  >
    <h2 class="empty-state__title">{{ title }}</h2>
    <div v-if="$slots.detail" class="empty-state__detail">
      <slot name="detail" />
    </div>
    <p v-if="text" class="empty-state__text">{{ text }}</p>
    <div v-if="$slots.action" class="empty-state__action">
      <slot name="action" />
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "../styles/page-layout" as *;
@use "../styles/variables" as *;

.empty-state {
  @include empty-state-block;
  max-width: 22rem;
  gap: $space-related;
  padding: $space-block 0;
}

.empty-state--reassure {
  max-width: 24rem;
  gap: $space-compact;
  padding: $space-block 0;

  .empty-state__title {
    font-size: $font-section;
    letter-spacing: -0.02em;
  }

  .empty-state__text {
    font-size: $font-control;
    line-height: 1.55;
    max-width: 20rem;
  }

  .empty-state__detail {
    margin-top: $space-compact;
  }

  .empty-state__action {
    margin-top: $space-compact;
  }
}

.empty-state--direct {
  max-width: 20rem;
  gap: $space-related;
  padding: $space-compact 0;

  .empty-state__title {
    font-size: $font-body;
    font-weight: 600;
  }

  .empty-state__text {
    font-size: $font-control;
    line-height: 1.45;
  }

  .empty-state__action {
    margin-top: $space-related;
  }
}

.empty-state__detail {
  min-width: 0;
}

.empty-state__title {
  @include empty-state-title;
  font-weight: 600;
}

.empty-state__text {
  @include empty-state-text;
  max-width: none;
}

.empty-state__action {
  display: flex;
  flex-wrap: wrap;
  gap: $space-related;
  margin-top: $space-related;

  :deep(button) {
    @include action-button;
  }

  :deep(button.is-quiet) {
    @include quiet-button;
  }
}
</style>
