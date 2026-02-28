import type { Card, CardSource, GameState, TableauColumn } from '../types';
import { addCoins, loadCoins, spendCoins } from '../settings';
import {
  canPlaceOnField,
  canPlaceSubstackOnField,
  canStackOnTableau,
  createGame,
  drawCard,
  isOutOfMoves,
  isStuck,
  moveDrawnToTableau,
  moveTableauCard,
  moveTableauSubstack,
  placeCard,
  placeSubstackOnField,
  selectCard,
} from '../game/GameEngine';

interface GameOptions {
  onMenu: () => void;
}

const TABLEAU_STEP   = 28; // px visible per non-top tableau card
const CARD_H         = 86; // must match CSS .tab-card height
const DRAWN_STEP     = 18; // px visible per non-top drawn card
const DRAG_THRESHOLD = 8;  // px before drag starts
const SAVE_KEY       = 'assoc-game-save';

export class GameUI {
  private state: GameState;
  private root: HTMLElement;
  private opts: GameOptions;

  constructor(root: HTMLElement, opts: GameOptions) {
    this.root = root;
    this.opts = opts;
    this.root.className = 'screen-game';
    this.state = loadSavedState() ?? createGame();
    this.render();
  }

  private setState(s: GameState) {
    const justWon = s.isWon && !this.state.isWon;
    this.state = s;
    if (s.isWon) {
      clearSavedState();
      if (justWon) addCoins(10);
    } else {
      persistState(s);
    }
    this.render();
  }

  // ─── Tap handlers ────────────────────────────────────────────────

  private handleDeckClick() {
    const { deck, drawnCards, discardPile } = this.state;
    if (deck.length === 0 && drawnCards.length === 0 && discardPile.length === 0) return;
    this.setState(drawCard(this.state));
  }

  private handleDrawnTopTap() {
    const { drawnCards } = this.state;
    if (drawnCards.length === 0) return;
    const top = drawnCards[drawnCards.length - 1];
    this.setState(selectCard(this.state, top, { type: 'drawn' }));
  }

  private handleFieldClick(fieldId: number) {
    const { selectedCard, fields } = this.state;
    if (!selectedCard) return;
    const field = fields.find((f) => f.id === fieldId)!;

    // Substack tap-move: when a non-top tableau card is selected
    if (selectedCard.source.type === 'tableau') {
      const src = selectedCard.source;
      const srcCol = this.state.tableau.find((c) => c.id === src.columnId)!;
      const cardIdx = srcCol.cards.findIndex((c) => c.id === selectedCard.card.id);
      const substackCount = srcCol.cards.length - cardIdx;
      if (substackCount > 1) {
        const substack = srcCol.cards.slice(cardIdx);
        if (canPlaceSubstackOnField(substack, field)) {
          this.setState(placeSubstackOnField(this.state, src.columnId, cardIdx, fieldId));
        } else {
          this.setState({ ...this.state, selectedCard: null });
        }
        return;
      }
    }

    if (canPlaceOnField(selectedCard.card, field)) {
      this.setState(placeCard(this.state, fieldId));
    } else {
      this.setState({ ...this.state, selectedCard: null });
    }
  }

  private handleTopFieldCardTap(card: Card, fieldId: number) {
    if (this.state.selectedCard) this.handleFieldClick(fieldId);
    else this.setState(selectCard(this.state, card, { type: 'field', fieldId }));
  }

  private handleTopTableauTap(card: Card, columnId: number) {
    if (this.state.selectedCard?.card.id === card.id) {
      // Re-tap selected card → deselect
      this.setState({ ...this.state, selectedCard: null });
    } else if (this.state.selectedCard) {
      this.handleMoveToTableau(columnId);
    } else {
      this.setState(selectCard(this.state, card, { type: 'tableau', columnId }));
    }
  }

  /** Move the currently selected card/substack to a tableau column, or deselect on mismatch. */
  private handleMoveToTableau(columnId: number) {
    const { selectedCard } = this.state;
    if (!selectedCard) return;
    // Category cards from the drawn pile cannot be placed on the tableau
    if (selectedCard.source.type === 'drawn' && selectedCard.card.type === 'category') {
      this.setState({ ...this.state, selectedCard: null });
      return;
    }
    const targetCol = this.state.tableau.find((c) => c.id === columnId);
    if (!targetCol || !canStackOnTableau(selectedCard.card, targetCol)) {
      this.setState({ ...this.state, selectedCard: null });
      return;
    }
    const src = selectedCard.source;
    if (src.type === 'tableau') {
      const srcCol = this.state.tableau.find((c) => c.id === src.columnId)!;
      const cardIdx = srcCol.cards.findIndex((c) => c.id === selectedCard.card.id);
      const substackCount = srcCol.cards.length - cardIdx;
      if (substackCount > 1) {
        this.setState(moveTableauSubstack(this.state, src.columnId, cardIdx, columnId));
      } else {
        this.setState(moveTableauCard(this.state, src.columnId, columnId));
      }
    } else if (src.type === 'drawn') {
      this.setState(moveDrawnToTableau(this.state, columnId));
    } else {
      this.setState({ ...this.state, selectedCard: null });
    }
  }

  // ─── Drag ────────────────────────────────────────────────────────

  /**
   * Attach pointer-based drag to any interactive card.
   * `source` identifies where the card lives so we can remove it on drop.
   * `onTap` is called if the gesture ends without drag (tap fallback).
   */
  private attachDrag(
    cardEl: HTMLElement,
    card: Card,
    source: CardSource,
    substackSize: number,
    substackEls: HTMLElement[],
    onTap: () => void,
  ) {
    let startX = 0, startY = 0;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let highlightedEl: Element | null = null;

    const fromColId = source.type === 'tableau' ? source.columnId : -1;

    const clearHighlight = () => {
      highlightedEl?.classList.remove('drag-over-valid');
      highlightedEl = null;
    };

    const updateHighlight = (x: number, y: number) => {
      clearHighlight();
      const under = document.elementFromPoint(x, y);
      if (!under) return;

      const colWrap = under.closest<HTMLElement>('[data-col-id]');
      if (colWrap) {
        const targetColId = Number(colWrap.dataset.colId);
        if (targetColId !== fromColId) {
          const col = this.state.tableau.find((c) => c.id === targetColId);
          const blocked = source.type === 'drawn' && card.type === 'category';
          if (col && !blocked && canStackOnTableau(card, col)) {
            colWrap.classList.add('drag-over-valid');
            highlightedEl = colWrap;
          }
        }
        return;
      }

      const fieldSlot = under.closest<HTMLElement>('[data-field-id]');
      if (fieldSlot) {
        const field = this.state.fields.find((f) => f.id === Number(fieldSlot.dataset.fieldId));
        if (field) {
          let valid = false;
          if (substackSize === 1) {
            valid = canPlaceOnField(card, field);
          } else if (source.type === 'tableau') {
            const srcCol = this.state.tableau.find((c) => c.id === fromColId);
            if (srcCol) {
              const fromIdx = srcCol.cards.length - substackSize;
              valid = canPlaceSubstackOnField(srcCol.cards.slice(fromIdx), field);
            }
          }
          if (valid) {
            fieldSlot.classList.add('drag-over-valid');
            highlightedEl = fieldSlot;
          }
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        ghost = buildGhost(card, cardEl, substackSize);
        document.body.appendChild(ghost);
        substackEls.forEach((e) => { e.style.opacity = '0.25'; });
      }
      e.preventDefault();
      const gw = ghost!.offsetWidth;
      const mainH = Number(ghost!.dataset.mainH) || ghost!.offsetHeight;
      ghost!.style.left = `${e.clientX - gw / 2}px`;
      ghost!.style.top  = `${e.clientY - mainH / 2}px`;
      updateHighlight(e.clientX, e.clientY);
    };

    const onUp = (e: PointerEvent) => {
      cardEl.removeEventListener('pointermove', onMove);
      cardEl.removeEventListener('pointerup', onUp);
      cardEl.removeEventListener('pointercancel', onCancel);
      clearHighlight();
      substackEls.forEach((e) => { e.style.opacity = ''; });

      if (dragging) {
        ghost?.remove(); ghost = null;
        this.handleDrop(card, source, substackSize, e.clientX, e.clientY);
        dragging = false;
      } else {
        onTap();
      }
    };

    const onCancel = () => {
      cardEl.removeEventListener('pointermove', onMove);
      cardEl.removeEventListener('pointerup', onUp);
      cardEl.removeEventListener('pointercancel', onCancel);
      clearHighlight();
      substackEls.forEach((e) => { e.style.opacity = ''; });
      ghost?.remove(); ghost = null;
      dragging = false;
    };

    cardEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      dragging = false;
      cardEl.setPointerCapture(e.pointerId);
      cardEl.addEventListener('pointermove', onMove, { passive: false });
      cardEl.addEventListener('pointerup', onUp, { once: true });
      cardEl.addEventListener('pointercancel', onCancel, { once: true });
    });
  }

  private handleDrop(card: Card, source: CardSource, substackSize: number, x: number, y: number) {
    const under = document.elementFromPoint(x, y);
    if (!under) return;

    // → Tableau column
    const colWrap = under.closest<HTMLElement>('[data-col-id]');
    if (colWrap) {
      const targetColId = Number(colWrap.dataset.colId);
      if (source.type === 'tableau' && source.columnId === targetColId) return;

      if (source.type === 'tableau') {
        if (substackSize > 1) {
          const srcCol = this.state.tableau.find((c) => c.id === source.columnId)!;
          const fromIdx = srcCol.cards.length - substackSize;
          this.setState(moveTableauSubstack(this.state, source.columnId, fromIdx, targetColId));
        } else {
          this.setState(moveTableauCard(this.state, source.columnId, targetColId));
        }
      } else if (source.type === 'drawn') {
        this.setState(moveDrawnToTableau(this.state, targetColId));
      }
      return;
    }

    // → Field
    const fieldSlot = under.closest<HTMLElement>('[data-field-id]');
    if (fieldSlot) {
      const targetFieldId = Number(fieldSlot.dataset.fieldId);
      if (substackSize > 1 && source.type === 'tableau') {
        const srcCol = this.state.tableau.find((c) => c.id === source.columnId)!;
        const fromIdx = srcCol.cards.length - substackSize;
        this.setState(placeSubstackOnField(this.state, source.columnId, fromIdx, targetFieldId));
      } else if (substackSize === 1) {
        this.setState(placeCard({ ...this.state, selectedCard: { card, source } }, targetFieldId));
      }
    }
  }

  // ─── Render ──────────────────────────────────────────────────────

  private render() {
    this.root.innerHTML = '';
    this.root.append(this.renderHeader(), this.renderMain());
    if (this.state.isWon) this.root.appendChild(this.renderWinScreen());
    else if (isOutOfMoves(this.state)) this.root.appendChild(this.renderLossScreen('moves'));
    else if (isStuck(this.state)) this.root.appendChild(this.renderLossScreen('stuck'));
  }

  private renderHeader(): HTMLElement {
    const h = el('header', 'game-header');
    const back = el('button', 'gh-btn'); back.textContent = '←'; back.onclick = () => this.opts.onMenu();

    const titleWrap = el('span', 'gh-title');
    const { completedCategories, totalCategories, movesLeft } = this.state;
    const progress = el('span', 'gh-progress'); progress.textContent = `${completedCategories} / ${totalCategories}`;
    titleWrap.appendChild(progress);
    if (movesLeft !== null) {
      const movesEl = el('span', movesLeft <= 10 ? 'gh-moves gh-moves--low' : 'gh-moves');
      movesEl.textContent = `${movesLeft} ходов`;
      titleWrap.appendChild(movesEl);
    }

    const coins = el('span', 'gh-coins');
    const pip = el('span', 'coin-pip');
    const cnt = el('span', 'gh-coins-count'); cnt.textContent = String(loadCoins());
    coins.append(pip, cnt);
    const reset = el('button', 'gh-btn'); reset.textContent = '↺'; reset.onclick = () => { clearSavedState(); this.setState(createGame()); };
    h.append(back, titleWrap, coins, reset);
    return h;
  }

  private renderMain(): HTMLElement {
    const main = el('div', 'game-main');
    main.append(this.renderLeft(), this.renderDeckCol());
    return main;
  }

  private renderLeft(): HTMLElement {
    const left = el('div', 'game-left');
    left.append(this.renderFields(), this.renderTableau());
    return left;
  }

  // ── Fields ───────────────────────────────────────────────────────

  private renderFields(): HTMLElement {
    const row = el('div', 'fields-row');
    this.state.fields.forEach((f) => row.appendChild(this.renderField(f)));
    return row;
  }

  private renderField(field: { id: number; cards: Card[] }): HTMLElement {
    const { selectedCard } = this.state;
    const slot = el('div', 'field-slot');
    slot.dataset.fieldId = String(field.id);
    if (selectedCard) {
      slot.classList.add(canPlaceOnField(selectedCard.card, field) ? 'field--can-drop' : 'field--no-drop');
    }
    slot.onclick = () => this.handleFieldClick(field.id);

    if (field.cards.length === 0) {
      slot.appendChild(el('div', 'field-placeholder'));
    } else {
      const catCard = field.cards[0];
      const topCard = field.cards[field.cards.length - 1];
      const assocCount = field.cards.length - 1; // number of association cards placed

      // Category name — always shown as header
      const catLabel = el('div', 'field-cat-label');
      catLabel.textContent = catCard.text;
      slot.appendChild(catLabel);

      // Top association card — shown below the category label
      if (topCard !== catCard) {
        const cardEl = el('div', 'field-top-assoc');
        cardEl.textContent = topCard.text;

        if (selectedCard?.card.id === topCard.id) cardEl.classList.add('field-top-assoc--selected');

        // Count badge: how many assoc cards are stacked (+N more below)
        if (assocCount > 1) {
          const badge = el('span', 'field-count-badge');
          badge.textContent = String(assocCount);
          cardEl.appendChild(badge);
        }

        cardEl.onclick = (e) => { e.stopPropagation(); this.handleTopFieldCardTap(topCard, field.id); };
        slot.appendChild(cardEl);
      }
    }
    return slot;
  }

  // ── Tableau ──────────────────────────────────────────────────────

  private renderTableau(): HTMLElement {
    const area = el('div', 'tableau-area');
    this.state.tableau.forEach((col) => area.appendChild(this.renderTableauCol(col)));
    return area;
  }

  private renderTableauCol(col: TableauColumn): HTMLElement {
    const wrap = el('div', 'tab-col-wrap');
    wrap.dataset.colId = String(col.id);
    const inner = el('div', 'tab-col');

    // Highlight column as a valid tap-move target when a card is selected
    const { selectedCard } = this.state;
    const drawnCategoryBlocked = selectedCard?.source.type === 'drawn' && selectedCard.card.type === 'category';
    if (selectedCard && !drawnCategoryBlocked && canStackOnTableau(selectedCard.card, col)) {
      wrap.classList.add('tap-target-valid');
    }

    if (col.cards.length === 0) {
      inner.classList.add('tab-col--empty');
      // Empty column: clicking anywhere on it moves the selected card there
      if (selectedCard && canStackOnTableau(selectedCard.card, col)) {
        inner.style.cursor = 'pointer';
        inner.addEventListener('click', () => this.handleMoveToTableau(col.id));
      }
    } else {
      inner.style.height = `${(col.cards.length - 1) * TABLEAU_STEP + CARD_H}px`;

      // Precompute selected substack range for this column
      const sel = this.state.selectedCard;
      let selectedStartIdx = -1;
      if (sel?.source.type === 'tableau' && sel.source.columnId === col.id) {
        selectedStartIdx = col.cards.findIndex((c) => c.id === sel.card.id);
      }

      // Pass 1: create and append all card elements
      const cardEls: HTMLElement[] = col.cards.map((card, idx) => {
        const isTop = idx === col.cards.length - 1;
        const isCat = card.type === 'category';

        if (!card.revealed) {
          const cardEl = el('div', 'tab-card tab-card--hidden');
          cardEl.style.top = `${idx * TABLEAU_STEP}px`;
          inner.appendChild(cardEl);
          return cardEl;
        }

        const cardEl = el('div', `tab-card ${isCat ? 'tab-card--cat' : 'tab-card--assoc'}`);
        cardEl.style.top = `${idx * TABLEAU_STEP}px`;
        cardEl.textContent = card.text;
        if (isTop) cardEl.classList.add('tab-card--top');
        // Highlight the selected card and every card above it (full substack)
        if (selectedStartIdx >= 0 && idx >= selectedStartIdx) cardEl.classList.add('tab-card--selected');
        inner.appendChild(cardEl);
        return cardEl;
      });

      // Pass 2: attach drag to all revealed cards, all can be tapped to select/move substack
      col.cards.forEach((card, idx) => {
        if (!card.revealed) return;
        const substackSize = col.cards.length - idx;
        const substackEls = cardEls.slice(idx); // this card + all above it
        this.attachDrag(cardEls[idx], card, { type: 'tableau', columnId: col.id }, substackSize, substackEls, () => {
          this.handleTopTableauTap(card, col.id);
        });
      });
    }
    wrap.appendChild(inner);
    return wrap;
  }

  // ── Deck column ──────────────────────────────────────────────────

  private renderDeckCol(): HTMLElement {
    const col = el('div', 'deck-col');
    col.append(this.renderDeckStack(), this.renderDrawnStack());
    return col;
  }

  private renderDeckStack(): HTMLElement {
    const { deck, drawnCards, discardPile } = this.state;
    const canRecycle = deck.length === 0 && (drawnCards.length > 0 || discardPile.length > 0);
    const totalLeft = deck.length + drawnCards.length + discardPile.length;

    const wrap = el('div', 'deck-wrap');
    const label = el('div', 'deck-label'); label.textContent = 'Колода';
    const stack = el('div', 'deck-stack');

    if (deck.length === 0 && !canRecycle) {
      // Truly empty — nothing left
      stack.classList.add('deck-stack--empty');
      const e = el('div', 'deck-empty-label'); e.textContent = '—'; stack.appendChild(e);
    } else if (canRecycle) {
      // Empty but recyclable — show recycle button
      const btn = el('div', 'deck-recycle');
      btn.textContent = '↺';
      const hint = el('span', 'deck-recycle-count'); hint.textContent = String(totalLeft);
      btn.appendChild(hint);
      btn.onclick = () => this.handleDeckClick();
      stack.appendChild(btn);
    } else {
      for (let i = Math.min(deck.length, 3) - 1; i >= 0; i--)
        stack.appendChild(el('div', `card-back card-back--${i}`));
      const top = el('div', 'card-back card-back--top');
      const cnt = el('span', 'deck-count'); cnt.textContent = String(deck.length);
      top.appendChild(cnt);
      top.onclick = () => this.handleDeckClick();
      stack.appendChild(top);
    }
    wrap.append(stack, label);
    return wrap;
  }

  /** Render the "open" drawn cards stack (up to 3, stacked with DRAWN_STEP overlap). */
  private renderDrawnStack(): HTMLElement {
    const { drawnCards, selectedCard } = this.state;
    const wrap = el('div', 'drawn-wrap');
    const label = el('div', 'deck-label'); label.textContent = 'Открытые';

    const container = el('div', 'drawn-stack');

    if (drawnCards.length === 0) {
      container.classList.add('drawn-stack--empty');
    } else {
      // height: oldest card at top=0, newest at bottom
      const totalH = (drawnCards.length - 1) * DRAWN_STEP + CARD_H;
      container.style.height = `${totalH}px`;

      drawnCards.forEach((card, idx) => {
        const isTop = idx === drawnCards.length - 1;
        const isCat = card.type === 'category';
        const cardEl = el('div', `drawn-card-item ${isCat ? 'drawn-card-item--cat' : 'drawn-card-item--assoc'}`);
        cardEl.style.top = `${idx * DRAWN_STEP}px`;
        cardEl.textContent = card.text;

        if (isTop) {
          cardEl.classList.add('drawn-card-item--top');
          if (selectedCard?.source.type === 'drawn') cardEl.classList.add('drawn-card-item--selected');
          this.attachDrag(cardEl, card, { type: 'drawn' }, 1, [cardEl], () => {
            this.handleDrawnTopTap();
          });
        }
        container.appendChild(cardEl);
      });
    }

    wrap.append(container, label);
    return wrap;
  }

  // ── Loss screen ──────────────────────────────────────────────────

  private renderLossScreen(reason: 'stuck' | 'moves'): HTMLElement {
    const screen = el('div', 'lose-screen');
    const title = el('div', 'lose-title');
    title.textContent = reason === 'moves' ? 'Ходы кончились' : 'Нет ходов';
    const sub = el('div', 'win-sub');
    sub.textContent = `Собрано ${this.state.completedCategories} из ${this.state.totalCategories} ${pluralCat(this.state.totalCategories)}`;

    if (reason === 'moves') {
      const coins = loadCoins();
      const canAfford = coins >= 50;
      const buyBtn = el('button', canAfford ? 'buy-moves-btn' : 'buy-moves-btn buy-moves-btn--disabled');
      const pipEl = el('span', 'coin-pip');
      const buyLabel = el('span', '');
      buyLabel.textContent = canAfford
        ? `−50 → +10 ходов`
        : `Нужно 50 монет (есть ${coins})`;
      buyBtn.append(pipEl, buyLabel);
      if (canAfford) {
        buyBtn.onclick = () => {
          if (spendCoins(50)) {
            this.setState({ ...this.state, movesLeft: (this.state.movesLeft ?? 0) + 10 });
          }
        };
      }
      screen.appendChild(buyBtn);
    }

    const restartBtn = el('button', 'menu-btn-play'); restartBtn.textContent = 'Заново';
    restartBtn.onclick = () => { clearSavedState(); this.setState(createGame()); };
    screen.append(sub, restartBtn);
    return screen;
  }

  // ── Win screen ───────────────────────────────────────────────────

  private renderWinScreen(): HTMLElement {
    const screen = el('div', 'win-screen');
    const title = el('div', 'win-title'); title.textContent = 'Победа!';
    const sub = el('div', 'win-sub');
    sub.textContent = `Собрано ${this.state.totalCategories} ${pluralCat(this.state.totalCategories)}`;
    const reward = el('div', 'win-coin-reward');
    const pip = el('span', 'coin-pip coin-pip--lg');
    const rewardText = el('span', ''); rewardText.textContent = '+10 монет';
    reward.append(pip, rewardText);
    const total = el('div', 'win-coin-total');
    total.textContent = `Итого: ${loadCoins()} монет`;
    const btn = el('button', 'menu-btn-play'); btn.textContent = 'Ещё раз';
    btn.onclick = () => this.setState(createGame());
    screen.append(title, sub, reward, total, btn);
    return screen;
  }
}

// ─── Persistence ──────────────────────────────────────────────────

function persistState(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded or private mode — silently ignore */ }
}

function loadSavedState(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<GameState>;
    // Validate shape — discard saves from older game versions
    if (
      !Array.isArray(s.fields) ||
      !Array.isArray(s.tableau) ||
      !Array.isArray(s.deck) ||
      !Array.isArray(s.drawnCards) ||
      typeof s.totalCategories !== 'number' ||
      typeof s.completedCategories !== 'number'
    ) return null;
    // Drop selection to avoid ghost-selected-card after reload
    // movesLeft defaults to null for saves from before difficulty was added
    const movesLeft = (s as GameState).movesLeft ?? null;
    return { ...(s as GameState), selectedCard: null, movesLeft };
  } catch {
    return null;
  }
}

function clearSavedState(): void {
  localStorage.removeItem(SAVE_KEY);
}

// ─── Module helpers ───────────────────────────────────────────────

function pluralCat(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'категория';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'категории';
  return 'категорий';
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls.trim();
  return e;
}

function buildGhost(card: Card, sourceEl: HTMLElement, substackSize: number): HTMLElement {
  const r = sourceEl.getBoundingClientRect();
  const typeClass = `tab-card--${card.type === 'category' ? 'cat' : 'assoc'}`;
  const shadowLayers = Math.min(substackSize - 1, 2); // up to 2 shadow cards
  const SHADOW_STEP = 5; // px each shadow is offset downward

  // Wrapper contains main card + shadow cards peeking below
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'fixed',
    width: `${r.width}px`,
    height: `${r.height + shadowLayers * SHADOW_STEP}px`,
    left: `${r.left}px`,
    top: `${r.top}px`,
    pointerEvents: 'none',
    zIndex: '999',
    transform: 'scale(1.06) rotate(2deg)',
    transformOrigin: 'center top',
    transition: 'none',
  });
  // Store main card height so onMove can centre on the main card, not the whole stack
  wrap.dataset.mainH = String(r.height);

  // Shadow cards (rendered first = visually behind)
  for (let i = shadowLayers; i >= 1; i--) {
    const s = document.createElement('div');
    s.className = `tab-card ${typeClass}`;
    Object.assign(s.style, {
      position: 'absolute',
      left: '0', right: '0',
      top: `${(shadowLayers - i + 1) * SHADOW_STEP}px`,
      height: `${r.height}px`,
      opacity: String(0.45 + i * 0.2),
    });
    wrap.appendChild(s);
  }

  // Main (top) card
  const main = document.createElement('div');
  main.className = `tab-card ${typeClass}`;
  main.textContent = card.text;
  Object.assign(main.style, {
    position: 'absolute',
    left: '0', right: '0',
    top: '0',
    height: `${r.height}px`,
    boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
  });

  if (substackSize > 1) {
    const badge = document.createElement('span');
    badge.className = 'ghost-badge';
    badge.textContent = `×${substackSize}`;
    main.appendChild(badge);
  }

  wrap.appendChild(main);
  return wrap;
}
