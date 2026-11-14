// The official template's own config, with EmDash's integration replaced by firstEmdash().
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';
import { firstEmdash } from '@first/astro/emdash';

export default defineConfig({ output: 'server', adapter: node({ mode: 'standalone' }), integrations: [firstEmdash()], devToolbar: { enabled: false } });
