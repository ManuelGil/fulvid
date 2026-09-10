/**
 * Search Page selection only. Not `documentSession.activeId` and not Focus.
 * Opening a hit still goes through `openOrActivate`.
 */
import { ref } from "vue";

export type SelectedSearchContext = {
  title: string;
  path: string;
  line: number;
  snippet: string;
  matchCount: number;
};

export const selectedSearchContext = ref<SelectedSearchContext | null>(null);
