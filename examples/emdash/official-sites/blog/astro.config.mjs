// The official template's own config, with EmDash's integration replaced by tpEmdash(): the
// template's `emdash` imports read the TypedPress site at TP_URL. Fonts come from the installed
// @fontsource packages (../fonts.mjs): the build fetches no font, as the upstream Google provider
// and Astro's Fontsource provider do.
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';
import { tpEmdash } from '@typedpress/astro/emdash';
import { installedFonts } from '../fonts.mjs';

const local = installedFonts();

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [tpEmdash({ pagesAt: '/pages/' })],
  fonts: [
    { provider: local, name: 'Inter', cssVariable: '--font-body', weights: [400, 500, 600, 700], fallbacks: ['sans-serif'] },
    { provider: local, name: 'JetBrains Mono', cssVariable: '--font-mono', weights: [400, 500], fallbacks: ['monospace'] },
  ],
  devToolbar: { enabled: false },
});
