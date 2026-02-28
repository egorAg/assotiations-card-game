export type Theme = 'dark' | 'light' | 'classic';
export type Difficulty = 'easy' | 'hard';

export interface Settings {
  numCategories: number; // how many categories to include in one game
  theme: Theme;
  difficulty: Difficulty;
}

const SETTINGS_KEY = 'assoc-settings';
const DEFAULTS: Settings = { numCategories: 8, theme: 'dark', difficulty: 'easy' };

export function applyTheme(theme: Theme): void {
  const cl = document.documentElement.classList;
  cl.remove('theme-light', 'theme-classic');
  if (theme !== 'dark') cl.add(`theme-${theme}`);
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ── Coins ────────────────────────────────────────────────────────

const COINS_KEY = 'assoc-coins';

export function loadCoins(): number {
  try {
    return parseInt(localStorage.getItem(COINS_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function addCoins(amount: number): number {
  const newTotal = loadCoins() + amount;
  try { localStorage.setItem(COINS_KEY, String(newTotal)); } catch {}
  return newTotal;
}

/** Deduct coins. Returns true on success, false if balance is insufficient. */
export function spendCoins(amount: number): boolean {
  const current = loadCoins();
  if (current < amount) return false;
  try { localStorage.setItem(COINS_KEY, String(current - amount)); } catch {}
  return true;
}
