const loaders = {
  'github-dark-high-contrast': () => import('shiki/themes/github-dark-high-contrast.mjs'),
  'github-light-high-contrast': () => import('shiki/themes/github-light-high-contrast.mjs'),
};
export const themes = {getTheme(name) {
  const load = loaders[name];
  return load ? {load} : undefined;
}};
