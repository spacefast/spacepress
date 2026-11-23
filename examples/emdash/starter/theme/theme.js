(() => {
  const controls = document.querySelectorAll('[data-theme]');
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    for (const button of controls) button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  }
  let preference = 'system';
  try { preference = localStorage.getItem('spacepress-publication-theme') ?? 'system'; } catch {}
  apply(['light', 'dark', 'system'].includes(preference) ? preference : 'system');
  for (const button of controls) button.addEventListener('click', () => {
    apply(button.dataset.theme);
    try { localStorage.setItem('spacepress-publication-theme', button.dataset.theme); } catch {}
  });
})();
