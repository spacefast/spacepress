// The source lab needs these grammars only. Each official Shiki grammar includes
// its embedded-language dependencies (PHP includes HTML/JavaScript/CSS).
export const bundledLanguages = {
  typescript: () => import('@shikijs/langs/typescript'),
  javascript: () => import('@shikijs/langs/javascript'),
  php: () => import('@shikijs/langs/php'),
  sql: () => import('@shikijs/langs/sql'),
  json: () => import('@shikijs/langs/json'),
};
