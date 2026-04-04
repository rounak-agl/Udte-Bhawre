// renderer/design-system/tokens.js

const PFTokens = {
  colors: {
    surfacePrimary: 'var(--pf-color-surface-primary)',
    surfaceSecondary: 'var(--pf-color-surface-secondary)',
    surfaceTertiary: 'var(--pf-color-surface-tertiary)',
    textPrimary: 'var(--pf-color-text-primary)',
    textSecondary: 'var(--pf-color-text-secondary)',
    accentPrimary: 'var(--pf-color-accent-primary)',
    border: 'var(--pf-color-border)',
  },
  spacing: {
    xs: 'var(--pf-spacing-xs)',
    sm: 'var(--pf-spacing-sm)',
    md: 'var(--pf-spacing-md)',
    lg: 'var(--pf-spacing-lg)',
    xl: 'var(--pf-spacing-xl)',
  },
  radius: {
    sm: 'var(--pf-radius-sm)',
    md: 'var(--pf-radius-md)',
    lg: 'var(--pf-radius-lg)',
    full: 'var(--pf-radius-full)',
  }
};

const ThemeManager = {
  applyTheme(themeName) {
    if (themeName === 'Midnight' || themeName === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (themeName === 'Moss') {
      document.documentElement.setAttribute('data-theme', 'moss');
    } else if (themeName === 'Peach') {
      document.documentElement.setAttribute('data-theme', 'peach');
    } else if (themeName === 'Cloud') {
      document.documentElement.setAttribute('data-theme', 'cloud');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  },
  
  toggleDarkMode(isDark) {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
};

window.PFTokens = PFTokens;
window.ThemeManager = ThemeManager;
