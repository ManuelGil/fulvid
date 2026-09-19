import { createRouter, createWebHashHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

export const APP_ROUTE_NAMES = {
  editor: "editor",
  search: "search",
  graph: "graph",
  settings: "settings",
} as const;

export type AppRouteName = (typeof APP_ROUTE_NAMES)[keyof typeof APP_ROUTE_NAMES];

const APP_ROUTES: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: { name: APP_ROUTE_NAMES.editor },
  },

  {
    path: "/editor",
    name: APP_ROUTE_NAMES.editor,
    component: () => import("../pages/editor/EditorPage.vue"),
  },
  {
    path: "/workspace",
    redirect: { name: APP_ROUTE_NAMES.editor },
  },
  {
    path: "/search",
    name: APP_ROUTE_NAMES.search,
    component: () => import("../pages/search/SearchPage.vue"),
  },

  {
    path: "/graph",
    name: APP_ROUTE_NAMES.graph,
    component: () => import("../pages/graph/GraphPage.vue"),
  },

  {
    path: "/settings",
    name: APP_ROUTE_NAMES.settings,
    component: () => import("../pages/settings/SettingsPage.vue"),
  },

  {
    path: "/:pathMatch(.*)*",
    redirect: "/editor",
  },
];

export function createAppRouter() {
  return createRouter({ history: createWebHashHistory(), routes: APP_ROUTES });
}
