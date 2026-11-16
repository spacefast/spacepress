// The official template's own config, with EmDash's integration replaced by tpEmdash().
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';
import { tpEmdash } from '@typedpress/astro/emdash';

export default defineConfig({ output: 'server', adapter: node({ mode: 'standalone' }), integrations: [tpEmdash()], devToolbar: { enabled: false } });
