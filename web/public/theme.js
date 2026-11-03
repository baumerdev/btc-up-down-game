// Applies the theme before the first render, to avoid a flash (DECISIONS.md #17).
// A separate file because the CSP forbids inline scripts. Same rule as useTheme() in preferences.ts.
;(() => {
  let choice = null
  try {
    choice = localStorage.getItem('theme')
  } catch {}
  const dark =
    choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
})()
