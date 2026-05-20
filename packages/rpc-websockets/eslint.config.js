"use strict"

const tseslint = require("@typescript-eslint/eslint-plugin")
const tsparser = require("@typescript-eslint/parser")
const js = require("@eslint/js")

module.exports = [
    js.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                sourceType: "module",
            },
            globals: {
                // Node.js globals
                require: "readonly",
                module: "readonly",
                exports: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                process: "readonly",
                console: "readonly",
                Buffer: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                // Browser globals
                window: "readonly",
                WebSocket: "readonly",
                WebSocketEventMap: "readonly",
                AddEventListenerOptions: "readonly",
                // Node types (handled by TypeScript, not eslint)
                NodeJS: "readonly",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            // Disable no-undef — TypeScript already enforces this more accurately
            "no-undef": "off",
            "brace-style": ["error", "allman", { "allowSingleLine": true }],
            "indent": ["error", 4],
            "linebreak-style": ["error", "unix"],
            "quotes": ["error", "double"],
            "semi": ["error", "never"],
            "comma-spacing": ["error"],
            "comma-style": ["error"],
            "func-call-spacing": ["error"],
            "key-spacing": ["error"],
            "keyword-spacing": ["error"],
            "lines-around-comment": ["error", { "beforeBlockComment": false, "afterBlockComment": false }],
            "max-len": ["error", 100],
            "new-cap": ["error"],
            "no-console": 0,
            "no-multiple-empty-lines": ["error", { "max": 1 }],
            "no-tabs": ["error"],
            "no-trailing-spaces": ["error"],
            "no-whitespace-before-property": ["error"],
            "operator-linebreak": ["error"],
            "semi-spacing": ["error", { "before": false, "after": true }],
            "space-before-blocks": ["error"],
            "space-in-parens": ["error"],
            "space-infix-ops": ["error"],
            "space-unary-ops": ["error"],
            "spaced-comment": ["error"],
            "arrow-parens": ["error"],
            "arrow-spacing": ["error"],
            "no-duplicate-imports": ["error"],
            "prefer-const": ["error"],
            "no-cond-assign": 0,
            "no-unused-vars": "off",
            // TypeScript-specific rules
            "@typescript-eslint/no-unused-vars": ["error", {
                "varsIgnorePattern": "^_",
                "argsIgnorePattern": "^_",
                "caughtErrorsIgnorePattern": "^_",
            }],
            // Preserve pre-upgrade behaviour: any was allowed before
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
]