const root = document.documentElement;
const buttons = document.querySelectorAll('[data-theme]');
function setTheme(theme) {
  const value = ['light', 'dark'].includes(theme) ? theme : 'system';
  root.classList.remove('light', 'dark');
  if (value !== 'system') root.classList.add(value);
  document.cookie = `theme=${value === 'system' ? '' : value}; path=/; max-age=${value === 'system' ? 0 : 31536000}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.theme === value));
}
for (const button of buttons) button.addEventListener('click', () => setTheme(button.dataset.theme));
