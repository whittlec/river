# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## River Levels component 🔧

This project includes a `Levels` React component that fetches the Environment Agency CSV for station 8208 and renders a line chart showing water levels over time. The component distinguishes `observed` and `forecast` entries and renders the forecast as a dashed line.

Quick start:



Serving from a subpath

- All generated asset URLs and the manifest are now relative (e.g., `manifest.webmanifest`, `./icons/icon-192.svg`), so the built `dist/` can be served from a subpath (for example GitHub Pages at `https://<user>.github.io/<repo>/`). The service worker and its scope are also registered relative to the page to support subpath hosting.
- `url?: string` — override the CSV URL (defaults to the station CSV for 8208)
- `height?: number | string` — set chart height (pixels if number)
- `width?: number | string` — set chart width (pixels if number)
Caching:
- The component caches parsed data in `localStorage` (key derived from the CSV URL). The chart will use cached data by default and you can click **Refresh from server** to pull new CSV rows and merge them into the cache. When refreshing, observed rows overwrite forecast-only rows for the same timestamp.
UI indicators:
- The component now shows **Last refresh** (time) and **Cache** (approximate size in KB) next to the timestamp count.
Persistence:
 - The cache is persisted in `localStorage` and will be preserved across full page reloads (the component loads cached data on mount). Use **Refresh from server** to merge new rows without losing the existing cached data.

Data windowing:
- When refreshing, the component will keep at most **1 year** of merged data in the cache (older rows are discarded). The chart itself displays only the **last 2 weeks** of data for clarity.
Display window control:

- There's a control above the chart that lets you change the displayed window: **1d**, **7d**, **14d**, **30d**, or **All** (shows all cached rows, up to the 1-year cache limit). The selected window affects only the chart view — cached data remains intact.

Safe rowing level:

- The chart shows a horizontal **Safe rowing level** (default **1.9 m**) as a dashed line and a status indicator (Safe / Unsafe) based on the most recent measurement. You can override the level by passing the `safeLevel` prop to the `Levels` component.


