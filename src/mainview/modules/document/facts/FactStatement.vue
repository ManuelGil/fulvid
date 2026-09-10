<template>
  <div class="fact-statement">
    <p class="fact-statement__text">
      <slot />
    </p>
  </div>
</template>

<style scoped lang="scss">
@use "facts" as *;
@use "../../../styles/variables" as *;

.fact-statement {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
}

.fact-statement__text {
  @include fact-statement;
}
</style>
