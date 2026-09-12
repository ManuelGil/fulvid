import type { ElectrobunConfig } from "electrobun";

const hasDeveloperId = Boolean(process.env.ELECTROBUN_DEVELOPER_ID);
const hasAppleIdNotarization = Boolean(
  process.env.ELECTROBUN_APPLEID &&
  process.env.ELECTROBUN_APPLEIDPASS &&
  process.env.ELECTROBUN_TEAMID,
);
const hasApiKeyNotarization = Boolean(
  process.env.ELECTROBUN_APPLEAPIISSUER &&
  process.env.ELECTROBUN_APPLEAPIKEY &&
  process.env.ELECTROBUN_APPLEAPIKEYPATH,
);

export default {
  app: {
    name: "Fulvid",
    identifier: "fulvid.imgil.dev",
    version: "0.4.0",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      // Signing and notarization use repository secrets in CI.
      // Without credentials, packages remain unsigned (local builds).
      codesign: hasDeveloperId,
      notarize: hasDeveloperId && (hasAppleIdNotarization || hasApiKeyNotarization),
      createDmg: true,
      // System webview (WKWebView / WebView2 / WebKitGTK), not bundled CEF.
      // Enabling CEF is a CSP, worker, and HMR review — see CONTRIBUTING.md.
      bundleCEF: false,
      // iconutil on macOS turns this iconset into AppIcon.icns. Not generated on Linux.
      icons: "assets/macos/fulvid.iconset",
    },
    linux: {
      bundleCEF: false,
      icon: "assets/fulvid.png",
    },
    win: {
      bundleCEF: false,
      icon: "assets/fulvid.ico",
    },
  },
} satisfies ElectrobunConfig;
