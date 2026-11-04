// @ts-check
import eslintJs from '@eslint/js';
import configPrettier from 'eslint-config-prettier';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import pluginTypeScript from 'typescript-eslint';

const config = [
  // Base
  {
    ignores: [
      '**/build/',
      '**/release/',
      '**/bin/',
      '**/dist/',
      '**/obj/',
      '**/out/',
      '**/.next/',
      '**/node_modules/',
      '**/.agents/',
      '**/plugins-src/',
      '**/.claude/',
      '**/.trae/',
    ],
  },

  // TypeScript
  {
    name: 'eslint/recommended',
    rules: eslintJs.configs.recommended.rules,
  },
  ...pluginTypeScript.configs.recommended,

  // React
  {
    name: 'react/jsx-runtime',
    plugins: {
      react: pluginReact,
    },
    rules: pluginReact.configs['jsx-runtime'].rules,
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    name: 'react-hooks/recommended',
    plugins: {
      'react-hooks': pluginReactHooks,
    },
    rules: pluginReactHooks.configs.recommended.rules,
  },

  // Prettier
  {
    name: 'prettier/config',
    ...configPrettier,
  },

  // Project custom rules
  {
    name: 'project-custom',
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Next.js config file - enable Node.js globals
  {
    name: 'next-config',
    files: ['next.config.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        exports: 'readonly',
      },
    },
  },
];

export default config;
