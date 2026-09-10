/**
 * Vue adapter: Focus (and virtual/standalone fallback) → Graph Core inputs.
 *
 * Graph does not read `activeId`. Tests use `graphActiveTargetFromInputs`.
 */
import { computed } from "vue";

import { activeBuffer } from "../../editor/document/documentBuffers";
import { contextNotes, validatedFocus, workspace } from "../../../app/workspaceState";
import {
  graphActiveTargetFromInputs,
  type GraphActiveTarget,
} from "./graphActiveDocumentProjection";

export const graphActiveTarget = computed((): GraphActiveTarget | null =>
  graphActiveTargetFromInputs(
    validatedFocus.value,
    activeBuffer.value,
    workspace.value?.path ?? null,
    contextNotes.value,
  ),
);
