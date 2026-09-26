/**
 * Linux WebView launch env for local Electrobun runners.
 *
 * `GDK_BACKEND=x11` avoids a blank window when an inherited Wayland GDK
 * backend paints only the body background. Skip with `FULVID_KEEP_GDK_BACKEND=1`.
 *
 * `WEBKIT_DISABLE_COMPOSITING_MODE=1` helps the packaged `views://` path
 * (`bun run start` / `bun run dev`) against GLXBadWindow. Do **not** enable
 * it for Vite HMR (`http://127.0.0.1:5173`): on Linux/WebKitGTK that flag
 * prevents the page JS from evaluating (no `[vite] connected`, white window).
 */
export type LinuxWebViewEnvOptions = {
  /**
   * When true (default), set `WEBKIT_DISABLE_COMPOSITING_MODE=1` if unset.
   * Pass false for the HMR HTTP loader path.
   */
  disableCompositing?: boolean;
};

export function linuxWebViewPaintEnv(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  options: LinuxWebViewEnvOptions = {},
): Record<string, string> {
  if (platform !== "linux") {
    return {};
  }

  const disableCompositing = options.disableCompositing ?? true;
  const next: Record<string, string> = {};

  if (disableCompositing && env.WEBKIT_DISABLE_COMPOSITING_MODE === undefined) {
    next.WEBKIT_DISABLE_COMPOSITING_MODE = "1";
  }
  if (env.FULVID_KEEP_GDK_BACKEND === undefined) {
    next.GDK_BACKEND = "x11";
  }

  return next;
}

/**
 * Env object for `Bun.spawn` of local Electrobun runners.
 * Windows/macOS: copy of `env` unchanged (no Linux paint keys added or removed).
 * Linux HMR (`disableCompositing: false`): also clears inherited compositing disable.
 */
export function electrobunDevProcessEnv(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  options: LinuxWebViewEnvOptions = {},
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...env,
    ...linuxWebViewPaintEnv(platform, env, options),
  };
  if (platform === "linux" && options.disableCompositing === false) {
    delete next.WEBKIT_DISABLE_COMPOSITING_MODE;
  }
  return next;
}
