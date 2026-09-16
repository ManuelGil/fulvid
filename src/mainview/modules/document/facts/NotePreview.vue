<script setup lang="ts">
const props = defineProps<{
  title: string;
  path: string;
  summary?: string;
  selected?: boolean;
  /** Dotfile / hidden-path evidence - muted but fully interactive. */
  hidden?: boolean;
  /** Dense row for Search / browse lists. */
  compact?: boolean;
  /** Render as a non-focusable listbox option for an aria-activedescendant input. */
  listboxOption?: boolean;
}>();

defineEmits<{
  click: [];
}>();
</script>

<template>
  <component
    :is="props.listboxOption ? 'div' : 'button'"
    class="note-preview"
    :class="{
      'note-preview--selected': selected,
      'note-preview--hidden': hidden,
      'note-preview--compact': compact,
    }"
    :type="props.listboxOption ? undefined : 'button'"
    :role="props.listboxOption ? 'option' : undefined"
    @click="$emit('click')"
  >
    <span class="note-preview__title">
      <span v-if="hidden" class="note-preview__hidden-mark" aria-hidden="true">-</span>{{ title }}
    </span>
    <span v-if="summary || $slots.summary" class="note-preview__summary">
      <slot name="summary">{{ summary }}</slot>
    </span>
    <span class="note-preview__path">{{ path }}</span>
    <span v-if="$slots.footer" class="note-preview__fact">
      <slot name="footer" />
    </span>
  </component>
</template>

<style scoped lang="scss">
@use "../../../styles/colors" as *;
@use "../../../styles/variables" as *;
@use "../../../styles/object-layout" as *;

.note-preview {
  @include object-hover-row;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: $space-tight;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover .note-preview__title {
    color: $accent-text;
  }

  &--selected {
    @include object-selected-row;
  }

  &--selected .note-preview__title {
    color: $selection-foreground;
  }

  &--selected .note-preview__summary,
  &--selected .note-preview__path,
  &--selected .note-preview__fact,
  &--selected .note-preview__hidden-mark {
    color: $selection-foreground;
  }

  &--hidden {
    opacity: 0.64;
  }

  &--hidden .note-preview__path {
    font-style: italic;
  }

  &--compact {
    gap: 2px;
    padding-block: $space-related;

    .note-preview__title {
      font-size: $font-control;
      line-height: 1.25;
    }

    .note-preview__summary {
      display: -webkit-box;
      font-size: $font-caption;
      line-height: 1.35;
    }

    .note-preview__path {
      font-size: $font-micro;
    }

    .note-preview__fact {
      font-size: $font-micro;
      line-height: 1.3;
    }
  }
}

.note-preview__title {
  overflow: hidden;
  font-size: $font-body;
  font-weight: 500;
  line-height: 1.3;
  letter-spacing: -0.015em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-preview__hidden-mark {
  margin-right: 0.35em;
  color: $text-muted;
  font-weight: 700;
}

.note-preview__summary {
  color: $text-secondary;
  font-size: $font-control;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.note-preview__path {
  overflow: hidden;
  color: $text-muted;
  font-size: $font-caption;
  font-family: $font-mono;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-preview__fact {
  color: $text-muted;
  font-size: $font-caption;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}

.note-preview--hidden.note-preview--selected {
  opacity: 1;
}

@media (forced-colors: active) {
  .note-preview--hidden {
    opacity: 1;
  }

  .note-preview:hover .note-preview__title,
  .note-preview:hover .note-preview__summary,
  .note-preview:hover .note-preview__path,
  .note-preview:hover .note-preview__fact,
  .note-preview:hover .note-preview__hidden-mark {
    color: HighlightText;
  }
}
</style>
