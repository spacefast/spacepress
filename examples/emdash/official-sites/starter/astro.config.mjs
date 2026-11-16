// The official template's own config, with EmDash's integration replaced by tpEmdash(): the
// template's `emdash` imports read the TypedPress site at TP_URL. Fonts come from Fontsource (no
// network fetch at build time, as the upstream Google provider needs).
import node from '@astrojs/node';
import { defineConfig, fontProviders } from 'astro/config';
import { tpEmdash } from '@typedpress/astro/emdash';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [tpEmdash({ pagesAt: '/' })],
  fonts: [
    { provider: fontProviders.fontsource(), name: 'Inter', cssVariable: '--font-body', weights: [400, 500, 600, 700], fallbacks: ['sans-serif'] },
    { provider: fontProviders.fontsource(), name: 'JetBrains Mono', cssVariable: '--font-mono', weights: [400, 500], fallbacks: ['monospace'] },
  ],
  devToolbar: { enabled: false },
});
