import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'], conditions: ['zen-source', 'module', 'browser', 'development|production'] },
  // Zen exports its renderer as TSX. Dependency sources do not inherit this
  // app's tsconfig, so set the JSX runtime for both builds and dev bundling.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  optimizeDeps: { esbuildOptions: { jsx: 'automatic', jsxImportSource: 'react' } },
});
