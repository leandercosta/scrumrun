"use strict";

const js = require("@eslint/js");

const nodeGlobals = {
  require: "readonly",
  module: "readonly",
  exports: "readonly",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  global: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  clearImmediate: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  atob: "readonly",
  btoa: "readonly",
  crypto: "readonly",
  SharedArrayBuffer: "readonly",
  Atomics: "readonly",
  Int32Array: "readonly",
  DataView: "readonly"
};

module.exports = [
  js.configs.recommended,
  {
    ignores: ["node_modules/", "coverage/", ".scrumrun/"]
  },
  {
    files: ["eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: nodeGlobals
    }
  },
  {
    files: ["bin/**/*.js", "lib/**/*.js", "tests/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: nodeGlobals
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-console": "off",
      "no-control-regex": "off",
      "preserve-caught-error": "warn",
      "no-useless-assignment": "warn",
      "quotes": ["warn", "double"],
      "semi": ["warn", "never"],
      "indent": ["warn", 2]
    }
  }
];
