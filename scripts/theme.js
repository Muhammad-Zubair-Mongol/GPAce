// Legacy scripts/theme.js facade - delegates to canonical themeManager
function setTheme(theme) {
    if (typeof window !== 'undefined' && window.themeManager?.setTheme) {
        return window.themeManager.setTheme(theme);
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.body?.classList?.toggle('light-theme', theme === 'light');
    try { localStorage.setItem('theme', theme); } catch {}
}

function toggleTheme() {
    if (typeof window !== 'undefined' && window.themeManager?.toggleTheme) {
        return window.themeManager.toggleTheme();
    }
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    return newTheme;
}

if (typeof window !== 'undefined') {
    window.setTheme = setTheme;
    window.toggleTheme = toggleTheme;
}
