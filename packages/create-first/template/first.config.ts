import { collection, defineConfig, text } from 'first';

export const notes = collection({
  title: text().min(1).max(160),
  body: text({ multiline: true }).default(''),
}, {
  label: 'Notes', title: 'title',
  access: { read: 'anyone', create: 'editor', update: 'editor', delete: 'editor' },
});

export default defineConfig({ name: '__ZERO_APP_NAME__', collections: { notes } });
