// The official template's own config, with EmDash's integration replaced by spEmdash().
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';
import { spEmdash } from '@spacepress/astro/emdash';

export default defineConfig({ output: 'server', adapter: node({ mode: 'standalone' }), integrations: [spEmdash()], devToolbar: { enabled: false } });
