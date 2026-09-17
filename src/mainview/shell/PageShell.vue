<script setup lang="ts">
/**
 * Exploration stage. Rhythm sets pace; presence of the workspace is shared.
 */
import { useId } from "vue";

withDefaults(
  defineProps<{
    title: string;
    /** Full identity for tooltip when `title` is compact or truncated. */
    titleHint?: string;
    question?: string;
    /** Document under Focus, when any. */
    regarding?: string;
    /** Quiet workspace identity when the title is not already the workspace. */
    within?: string;
    wide?: boolean;
    fill?: boolean;
    embedded?: boolean;
    /**
     * Writing Focus: reclaim shell padding/gap for the editor surface.
     * Owned here so rhythm styles cannot override from higher specificity.
     */
    writingFocus?: boolean;
    /**
     * Writing Focus + Document location main-panel: keep a compact identity
     * line without the normal header spacing.
     */
    quietIdentity?: boolean;
    /**
     * Interaction rhythm - coherent differentiation across questions.
     * calm: exists; browse: organize; immediate: recover; spatial: locate
     */
    rhythm?: "calm" | "browse" | "immediate" | "spatial";
  }>(),
  {
    rhythm: undefined,
  },
);

const titleId = useId();
</script>

<template>
  <div
    class="page-shell"
    :class="{
      'page-shell--fill': fill,
      'page-shell--embedded': embedded,
      'page-shell--writing-focus': writingFocus,
      'page-shell--quiet-identity': writingFocus && quietIdentity,
      [`page-shell--${rhythm}`]: Boolean(rhythm),
    }"
    role="region"
    :aria-labelledby="embedded ? undefined : titleId"
    :aria-label="embedded ? title : undefined"
  >
    <header
      v-if="!embedded || $slots.lead || $slots.header || $slots.toolbar"
      class="page-shell__header"
    >
      <div v-if="$slots.lead" class="page-shell__lead">
        <slot name="lead" />
      </div>

      <div v-if="!embedded" class="page-shell__heading">
        <p v-if="within" class="page-shell__within">{{ within }}</p>
        <p v-if="question" class="page-shell__question">{{ question }}</p>
        <h1 :id="titleId" class="page-shell__title" :title="titleHint || undefined">
          {{ title }}
        </h1>
        <p v-if="regarding" class="page-shell__regarding">{{ regarding }}</p>
      </div>

      <div v-if="$slots.header" class="page-shell__meta">
        <slot name="header" />
      </div>
      <div v-if="$slots.toolbar" class="page-shell__toolbar">
        <slot name="toolbar" />
      </div>
    </header>

    <div v-if="!fill" class="page-shell__body" :class="{ 'page-shell__body--wide': wide }">
      <div class="page-shell__answer">
        <slot />
      </div>
      <div v-if="$slots.continue" class="page-shell__continue">
        <slot name="continue" />
      </div>
    </div>
    <div v-else class="page-shell__fill">
      <div class="page-shell__fill-content">
        <slot />
      </div>
      <div v-if="$slots.continue" class="page-shell__continue page-shell__continue--fill">
        <slot name="continue" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/colors" as *;
@use "../styles/page-layout" as *;
@use "../styles/variables" as *;

.page-shell {
  @include page-shell;
  gap: 0;
  background: transparent;
}

/* Question and title shift gently - stage stays put; rhythms share one quiet motion. */
@media (prefers-reduced-motion: no-preference) {
  .page-shell--calm .page-shell__heading,
  .page-shell--browse .page-shell__heading,
  .page-shell--immediate .page-shell__lead,
  .page-shell--immediate .page-shell__heading,
  .page-shell--spatial .page-shell__heading {
    animation: presence-shift 140ms $ease-out both;
  }
}

@keyframes presence-shift {
  from {
    opacity: 0.92;
  }

  to {
    opacity: 1;
  }
}

.page-shell__header {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: $space-compact;
  padding-bottom: $space-related;
}

.page-shell__lead {
  display: flex;
  flex-direction: column;
  gap: $space-compact;
  min-width: 0;
}

.page-shell__heading {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
}

.page-shell__within {
  margin: 0;
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.3;
  max-width: 36rem;
}

.page-shell__question {
  @include page-question;
  max-width: 36rem;
}

.page-shell__title {
  @include page-title;
  font-size: $font-title;
  font-weight: 600;
}

.page-shell__regarding {
  margin: 0;
  color: $text-muted;
  font-size: $font-label;
  line-height: 1.35;
  max-width: 36rem;
}

.page-shell__meta {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
}

.page-shell__toolbar {
  flex-shrink: 0;
}

.page-shell__body {
  @include scroll-region;
  display: flex;
  flex-direction: column;
  gap: $space-section;
  padding-top: $space-block;

  > :deep(.page-shell__answer > *),
  > :deep(.page-shell__continue > *) {
    max-width: $page-max-width;
  }

  &--wide > :deep(.page-shell__answer > *),
  &--wide > :deep(.page-shell__continue > *) {
    max-width: none;
  }
}

.page-shell__answer {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.page-shell__continue {
  @include exploration-continue;
}

.page-shell--fill {
  padding-bottom: 0;
}

.page-shell--embedded {
  gap: 0;

  .page-shell__header {
    gap: $space-tight;
    padding-bottom: $space-compact;
  }

  .page-shell__question {
    display: none;
  }

  .page-shell__title {
    font-size: $font-lead;
    letter-spacing: -0.015em;
  }

  .page-shell__body {
    padding-top: $space-related;
  }
}

.page-shell__fill {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: 0 (-$panel-padding);
  padding: 0;
}

.page-shell__fill-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.page-shell__continue--fill {
  flex: 0 0 auto;
  max-width: none;
  margin-inline: $panel-padding;
  padding-block: $space-block $space-related;
}

/* -- Workspace: slow, calm, overview -- */
.page-shell--calm {
  /* The facts keep a reading measure, so on a wide display the column
   * would otherwise sit against the left edge with the rest of the stage
   * empty. Centring header and body together keeps the measure intact and
   * reads as a deliberate document rather than an unfinished layout. */
  .page-shell__header,
  .page-shell__body {
    width: 100%;
    max-width: $page-max-width;
    margin-inline: auto;
  }

  .page-shell__header {
    gap: $space-block;
    padding-top: $space-related;
    padding-bottom: $space-section;
  }

  .page-shell__heading {
    gap: $space-related;
  }

  .page-shell__within {
    order: -2;
  }

  .page-shell__title {
    order: -1;
    font-size: $font-display;
    font-weight: 600;
    letter-spacing: -0.032em;
    line-height: 1.15;
    max-width: 28rem;
  }

  .page-shell__question {
    max-width: 22rem;
    color: $text-muted;
    font-size: $font-control;
  }

  .page-shell__body {
    gap: $space-page;
    padding-top: $space-section;
  }

  .page-shell__continue {
    padding-top: $space-section;
  }
}

/* -- Organize: continuous browsing -- */
.page-shell--browse {
  .page-shell__header {
    gap: $space-tight;
    padding-bottom: $space-tight;
  }

  .page-shell__within {
    font-size: $font-micro;
  }

  .page-shell__question {
    font-size: $font-label;
    color: $text-muted;
  }

  .page-shell__title {
    font-size: $font-section;
    letter-spacing: -0.022em;
  }

  .page-shell__regarding {
    font-size: $font-caption;
  }

  .page-shell__body {
    gap: $space-block;
    padding-top: $space-related;
  }

  .page-shell__continue {
    padding-top: $space-block;
    font-size: $font-label;
  }

  .page-shell__toolbar {
    margin-top: $space-tight;
  }
}

/* -- Recover: query-first, dense, immediate -- */
.page-shell--immediate {
  .page-shell__header {
    gap: $space-related;
    padding-bottom: $space-tight;
  }

  .page-shell__lead {
    order: -1;
  }

  .page-shell__heading {
    gap: 2px;
  }

  .page-shell__within {
    font-size: $font-micro;
  }

  .page-shell__question {
    display: none;
  }

  .page-shell__title {
    font-size: $font-label;
    font-weight: 500;
    letter-spacing: 0;
    color: $text-muted;
    line-height: 1.3;
  }

  .page-shell__regarding {
    font-size: $font-caption;
    max-width: none;
  }

  .page-shell__body {
    gap: $space-compact;
    padding-top: $space-compact;
  }

  .page-shell__continue {
    padding-top: $space-block;
    font-size: $font-label;
  }
}

/* -- Locate: document-first, canvas-first -- */
.page-shell--spatial {
  .page-shell__header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "heading toolbar"
      "meta toolbar";
    align-items: start;
    column-gap: $space-block;
    row-gap: $space-tight;
    padding-bottom: $space-compact;
  }

  .page-shell__heading {
    grid-area: heading;
  }

  .page-shell__meta {
    grid-area: meta;
  }

  .page-shell__toolbar {
    grid-area: toolbar;
    align-self: start;
    justify-self: end;
  }

  .page-shell__within {
    font-size: $font-micro;
  }

  .page-shell__question {
    font-size: $font-label;
    color: $text-muted;
  }

  .page-shell__title {
    font-size: $font-section;
    letter-spacing: -0.024em;
  }

  .page-shell__regarding {
    font-size: $font-caption;
    max-width: 48rem;
    line-height: 1.4;
  }

  &.page-shell--fill .page-shell__fill {
    margin-top: $space-tight;
  }
}

/*
 * Writing Focus layout lives on PageShell so rhythm/header rules in this file
 * cannot win on specificity and reintroduce vertical gap above the editor.
 */
.page-shell.page-shell--writing-focus {
  gap: 0;
  padding: 0;
}

.page-shell.page-shell--writing-focus > .page-shell__header {
  display: none;
  gap: 0;
  margin: 0;
  padding: 0;
}

.page-shell.page-shell--writing-focus.page-shell--quiet-identity > .page-shell__header {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  /* Bottom padding stays 0 so identity sits against the editor surface. */
  padding: $space-tight $space-compact 0;
}

.page-shell.page-shell--writing-focus.page-shell--quiet-identity .page-shell__heading {
  gap: 0;
}

.page-shell.page-shell--writing-focus.page-shell--quiet-identity .page-shell__title {
  max-width: min(100%, 40rem);
  overflow: hidden;
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 500;
  font-family: $font-mono;
  letter-spacing: 0;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-shell.page-shell--writing-focus .page-shell__fill {
  margin: 0;
}

.page-shell.page-shell--writing-focus .page-shell__fill,
.page-shell.page-shell--writing-focus .page-shell__fill-content {
  gap: 0;
  min-height: 0;
}
</style>
