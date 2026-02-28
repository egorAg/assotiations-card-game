import { MenuScreen } from './ui/MenuScreen';
import { GameUI } from './ui/GameUI';
import { SettingsScreen } from './ui/SettingsScreen';
import { applyTheme, loadSettings } from './settings';

type Screen = 'menu' | 'game' | 'settings';

export class App {
  private root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    applyTheme(loadSettings().theme);
    this.show('menu');
  }

  private show(screen: Screen) {
    this.root.innerHTML = '';

    if (screen === 'menu') {
      new MenuScreen(this.root, {
        onPlay: () => this.show('game'),
        onSettings: () => this.show('settings'),
      });
    } else if (screen === 'game') {
      new GameUI(this.root, {
        onMenu: () => this.show('menu'),
      });
    } else {
      new SettingsScreen(this.root, {
        onBack: () => this.show('menu'),
      });
    }
  }
}
