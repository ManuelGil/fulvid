import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

const typeScriptFiles = [
  "src/**/*.ts",
  "vite.config.ts",
  "electrobun.config.ts",
  "hutch.config.ts",
  "env.d.ts",
];

const vueFiles = ["src/**/*.vue"];

const scriptFiles = ["scripts/**/*.ts", "packaging/**/*.ts", "**/*.test.ts"];

const sharedTypeScriptRules = {
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { prefer: "type-imports", fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
    },
  ],
  "@typescript-eslint/require-await": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-console": ["warn", { allow: ["warn", "error"] }],
  "no-debugger": "error",
  "no-duplicate-imports": "off",
};

const sharedVueRules = {
  "vue/attribute-hyphenation": ["error", "always"],
  "vue/component-name-in-template-casing": ["error", "PascalCase"],
  "vue/define-emits-declaration": ["error", "type-based"],
  "vue/define-props-declaration": ["error", "type-based"],
  "vue/no-mutating-props": "error",
  "vue/no-unused-vars": "error",
  "vue/no-v-html": "off",
  "vue/multi-word-component-names": "off",
  "vue/prefer-true-attribute-shorthand": "error",
  "vue/require-default-prop": "off",
};

export default tseslint.config(
  {
    ignores: [
      ".hutch/**",
      ".cottontail-tmp/**",
      "dist/**",
      "node_modules/**",
      "build/**",
      "artifacts/**",
      "coverage/**",
    ],
  },
  eslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  eslintConfigPrettier,
  {
    files: typeScriptFiles,
    ignores: ["**/*.test.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: sharedTypeScriptRules,
  },
  {
    files: vueFiles,
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parser: vueParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...sharedTypeScriptRules,
      ...sharedVueRules,
    },
  },
  {
    files: scriptFiles,
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.bun,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/bun/index.ts", "scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/mainview/modules/editor/EditorToolbar.vue"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
  {
    files: ["src/mainview/pages/editor/EditorPage.vue"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
    },
  },
);
