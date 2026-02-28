import { loadCoins } from '../settings';

interface MenuOptions {
  onPlay: () => void;
  onSettings: () => void;
}

export class MenuScreen {
  constructor(root: HTMLElement, opts: MenuOptions) {
    root.className = 'screen-menu';
    root.innerHTML = `
      <div class="menu-bg">
        <div class="menu-glow"></div>
      </div>
      <div class="menu-content">
        <div class="menu-title-wrap">
          <span class="menu-title">assotiations</span>
          <span class="menu-subtitle">карточная игра</span>
        </div>
        <div class="menu-btn-group">
          <button class="menu-btn-play" id="btn-play">Играть</button>
          <button class="menu-btn-settings" id="btn-settings">Настройки</button>
        </div>
      </div>
    `;

    root.querySelector('#btn-play')!.addEventListener('click', opts.onPlay);
    root.querySelector('#btn-settings')!.addEventListener('click', opts.onSettings);

    const coinWrap = document.createElement('div');
    coinWrap.className = 'menu-coins';
    coinWrap.innerHTML = `<span class="coin-pip"></span><span>${loadCoins()}</span>`;
    root.appendChild(coinWrap);
  }
}
