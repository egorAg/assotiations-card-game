import { applyTheme, loadSettings, saveSettings } from '../settings';
import type { Difficulty, Theme } from '../settings';

interface SettingsOptions {
  onBack: () => void;
}

export class SettingsScreen {
  constructor(root: HTMLElement, opts: SettingsOptions) {
    let settings = loadSettings();

    root.className = 'screen-settings';
    root.innerHTML = `
      <header class="settings-header">
        <button class="gh-btn" id="btn-back">←</button>
        <span class="settings-title">настройки</span>
      </header>
      <div class="settings-body">
        <div class="settings-row">
          <span class="settings-label">Количество категорий</span>
          <div class="settings-value" id="val">${settings.numCategories}</div>
          <input
            class="settings-slider"
            id="slider"
            type="range"
            min="4" max="50" step="1"
            value="${settings.numCategories}"
          />
          <span class="settings-hint">Сколько категорий войдёт в одну игру. Все их ассоциации попадают в колоду. Собери каждую — поле освободится для следующей.</span>
        </div>

        <div class="settings-row">
          <span class="settings-label">Сложность</span>
          <div class="diff-picker">
            <button class="diff-btn" data-diff="easy">Лёгкий</button>
            <button class="diff-btn" data-diff="hard">Сложный</button>
          </div>
          <span class="settings-hint">На сложном уровне количество ходов ограничено: кол-во категорий × 2 + 55.</span>
        </div>

        <div class="settings-row">
          <span class="settings-label">Тема</span>
          <div class="theme-picker">
            <button class="theme-btn theme-btn--dark"  data-theme="dark">
              <span class="theme-swatch theme-swatch--dark"></span>
              <span>Тёмная</span>
            </button>
            <button class="theme-btn theme-btn--light" data-theme="light">
              <span class="theme-swatch theme-swatch--light"></span>
              <span>Светлая</span>
            </button>
            <button class="theme-btn theme-btn--classic" data-theme="classic">
              <span class="theme-swatch theme-swatch--classic"></span>
              <span>Классик</span>
            </button>
          </div>
        </div>
      </div>
    `;

    root.querySelector('#btn-back')!.addEventListener('click', opts.onBack);

    const slider = root.querySelector<HTMLInputElement>('#slider')!;
    const val = root.querySelector<HTMLElement>('#val')!;

    slider.addEventListener('input', () => {
      settings = { ...settings, numCategories: Number(slider.value) };
      val.textContent = String(settings.numCategories);
      saveSettings(settings);
    });

    const diffBtns = root.querySelectorAll<HTMLElement>('.diff-btn');
    diffBtns.forEach((btn) => {
      if (btn.dataset.diff === settings.difficulty) btn.classList.add('diff-btn--active');
      btn.addEventListener('click', () => {
        const difficulty = btn.dataset.diff as Difficulty;
        settings = { ...settings, difficulty };
        saveSettings(settings);
        diffBtns.forEach((b) => b.classList.toggle('diff-btn--active', b === btn));
      });
    });

    const themeBtns = root.querySelectorAll<HTMLElement>('.theme-btn');
    themeBtns.forEach((btn) => {
      if (btn.dataset.theme === settings.theme) btn.classList.add('theme-btn--active');
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme as Theme;
        settings = { ...settings, theme };
        saveSettings(settings);
        applyTheme(theme);
        themeBtns.forEach((b) => b.classList.toggle('theme-btn--active', b === btn));
      });
    });
  }
}
