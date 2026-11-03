import node from '@astrojs/node';
import { defineConfig, fontProviders } from 'astro/config';
import { fileURLToPath } from 'node:url';
const shared = (file) => fileURLToPath(new URL('../shared/' + file, import.meta.url));
export default defineConfig({
  output: 'server', adapter: node({ mode: 'standalone' }),
  vite: { resolve: { alias: [
    { find: 'emdash/ui/comments', replacement: shared('comments.ts') },
    { find: 'emdash/ui/search', replacement: shared('LiveSearch.astro') },
    { find: 'emdash/ui', replacement: shared('ui.ts') },
    { find: 'emdash/page', replacement: shared('page.ts') },
    { find: 'emdash', replacement: shared('client.ts') },
  ] } },
  fonts: [
    { provider: fontProviders.fontsource(), name: 'Inter', cssVariable: '--font-body', weights: [400,500,600,700], fallbacks: ['sans-serif'] },
    { provider: fontProviders.fontsource(), name: 'JetBrains Mono', cssVariable: '--font-mono', weights: [400,500], fallbacks: ['monospace'] },
  ],
  devToolbar: { enabled: false },
});
