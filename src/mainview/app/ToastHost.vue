<script setup lang="ts">
import { toasts } from "./notify";
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-relevant="additions">
    <p
      v-for="toast in toasts"
      :key="toast.id"
      class="toast"
      :class="`toast--${toast.tone}`"
      role="status"
    >
      {{ toast.message }}
    </p>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/colors" as *;
@use "../styles/variables" as *;

.toast-host {
  position: fixed;
  z-index: 40;
  right: $space-block;
  bottom: $space-block;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: $space-related;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  margin: 0;
  max-width: min(22rem, calc(100vw - 2rem));
  padding: $space-compact $space-block;
  border: 1px solid $border-subtle;
  border-radius: $radius;
  background: color-mix(in srgb, $surface-elevated 94%, $background);
  box-shadow: $shadow-soft;
  color: $text-primary;
  font-size: $font-control;
  line-height: 1.35;
  cursor: default;
  animation: toast-in 160ms $ease-out;

  &--success {
    border-color: color-mix(in srgb, $success-text 35%, $border-subtle);
  }
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

:global(html[data-reduced-motion="true"]) .toast {
  animation: none;
}
</style>
