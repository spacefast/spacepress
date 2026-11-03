const buttons = document.querySelectorAll("[data-theme]");
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie =
    theme === "system"
      ? "marketing-theme=;path=/;max-age=0;SameSite=Lax"
      : `marketing-theme=${theme};path=/;max-age=31536000;SameSite=Lax`;
  for (const button of buttons)
    button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
}
setTheme(
  document.cookie.match(/(?:^|; )marketing-theme=(light|dark)/)?.[1] ??
    "system",
);
for (const button of buttons)
  button.addEventListener("click", () => setTheme(button.dataset.theme));
