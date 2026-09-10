<template>
  <div class="fact-group">
    <slot />
  </div>
</template>

<style scoped lang="scss">
@use "facts" as *;

.fact-group {
  @include fact-group;
}
</style>
