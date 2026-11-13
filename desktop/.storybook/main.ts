import { fileURLToPath } from 'node:url';
import { mergeConfig, type UserConfig } from 'vite';

export default {
  stories: ['../src/**/*.stories.ts'],
  framework: '@storybook/react-vite',
  staticDirs: ['../public'],
  viteFinal: (config: UserConfig) => mergeConfig(config, {
    // The pinned archive ships source, and zen-stories replaces Vite's
    // export conditions. Resolve these source-only entries explicitly.
    resolve: { alias: [
      { find: /^@satoramoto\/zen\/view\/react$/, replacement: fileURLToPath(new URL('../node_modules/@satoramoto/zen/src/library/view-react.ts', import.meta.url)) },
      { find: /^@satoramoto\/zen\/view$/, replacement: fileURLToPath(new URL('../node_modules/@satoramoto/zen/src/library/view.ts', import.meta.url)) },
    ] },
  }),
};
