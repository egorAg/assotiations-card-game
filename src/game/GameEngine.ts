import type { Card, CardSource, CategoryData, Field, GameState, TableauColumn } from '../types';
import cardsData from '../data/cards.json';
import { loadSettings } from '../settings';

/** Decrement movesLeft by 1 (no-op when unlimited). */
function spendMove(state: GameState): GameState {
  if (state.movesLeft === null) return state;
  return { ...state, movesLeft: Math.max(0, state.movesLeft - 1) };
}

const FIELD_COUNT = 4;
const TABLEAU_COLS = 4;
const MAX_DRAWN = 3;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom<T>(arr: T[], count: number): T[] {
  return shuffle(arr).slice(0, count);
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** Flip the top card of a card array to revealed. Returns a new array. */
function revealTop(cards: Card[]): Card[] {
  if (cards.length === 0) return cards;
  const last = cards[cards.length - 1];
  if (last.revealed) return cards;
  return [...cards.slice(0, -1), { ...last, revealed: true }];
}

export function createGame(): GameState {
  const { numCategories, difficulty } = loadSettings();
  const allCategories: CategoryData[] = cardsData.categories;

  const count = Math.min(numCategories, allCategories.length);
  const activeCategories = pickRandom(allCategories, count);

  const categoryCards: Card[] = activeCategories.map((cat) => ({
    id: makeId(), type: 'category' as const, text: cat.name, categoryId: cat.id, revealed: false,
  }));

  const associationCards: Card[] = activeCategories.flatMap((cat) =>
    cat.associations.map((text) => ({
      id: makeId(), type: 'association' as const, text, categoryId: cat.id, revealed: false,
    })),
  );

  const categoryAssocCounts: Record<string, number> = {};
  activeCategories.forEach((cat) => {
    categoryAssocCounts[cat.id] = cat.associations.length;
  });

  const fields: Field[] = Array.from({ length: FIELD_COUNT }, (_, i) => ({ id: i, cards: [] }));

  const pool = shuffle([...categoryCards, ...associationCards]);
  let cursor = 0;
  const tableau: TableauColumn[] = Array.from({ length: TABLEAU_COLS }, (_, col) => {
    const cardCount = col + 1;
    const cards = pool.slice(cursor, cursor + cardCount);
    cursor += cardCount;
    // Only the top card of each column starts revealed (like solitaire)
    const withReveal = cards.map((c, i) =>
      i === cards.length - 1 ? { ...c, revealed: true } : c,
    );
    return { id: col, cards: withReveal };
  });

  const deck = shuffle(pool.slice(cursor));

  return {
    fields, tableau, deck,
    drawnCards: [],
    discardPile: [],
    selectedCard: null,
    isWon: false,
    categoryAssocCounts,
    completedCategories: 0,
    totalCategories: count,
    movesLeft: difficulty === 'hard' ? count * 2 + 55 : null,
  };
}

/** Draw top deck card into the drawn stack (max MAX_DRAWN visible).
 *  If deck is empty, recycles drawnCards + discardPile back into the deck. */
export function drawCard(state: GameState): GameState {
  if (state.deck.length === 0) {
    const recyclable = [...state.drawnCards, ...state.discardPile];
    if (recyclable.length === 0) return state;
    return { ...state, deck: shuffle(recyclable), drawnCards: [], discardPile: [], selectedCard: null };
  }

  const [top, ...rest] = state.deck;
  let newDrawn = [...state.drawnCards, { ...top, revealed: true }];
  let newDiscard = state.discardPile;

  if (newDrawn.length > MAX_DRAWN) {
    newDiscard = [...newDiscard, newDrawn[0]];
    newDrawn = newDrawn.slice(1);
  }

  return spendMove({ ...state, deck: rest, drawnCards: newDrawn, discardPile: newDiscard, selectedCard: null });
}

/** Can a card be dropped onto a tableau column? */
export function canStackOnTableau(card: Card, targetCol: TableauColumn): boolean {
  if (targetCol.cards.length === 0) return true;
  const top = targetCol.cards[targetCol.cards.length - 1];
  return card.categoryId === top.categoryId;
}

/** Move top card of fromCol onto toCol. */
export function moveTableauCard(state: GameState, fromColId: number, toColId: number): GameState {
  if (fromColId === toColId) return state;
  const fromCol = state.tableau.find((c) => c.id === fromColId);
  if (!fromCol || fromCol.cards.length === 0) return state;
  const card = fromCol.cards[fromCol.cards.length - 1];
  const toCol = state.tableau.find((c) => c.id === toColId);
  if (!toCol || !canStackOnTableau(card, toCol)) return state;

  const newTableau = state.tableau.map((col) => {
    if (col.id === fromColId) return { ...col, cards: revealTop(col.cards.slice(0, -1)) };
    if (col.id === toColId) return { ...col, cards: [...col.cards, card] };
    return col;
  });
  return spendMove({ ...state, tableau: newTableau, selectedCard: null });
}

/** Move a sub-stack (cards[fromIdx..end]) from fromCol onto toCol. */
export function moveTableauSubstack(
  state: GameState,
  fromColId: number,
  fromIdx: number,
  toColId: number,
): GameState {
  if (fromColId === toColId) return state;
  const fromCol = state.tableau.find((c) => c.id === fromColId);
  if (!fromCol || fromIdx < 0 || fromIdx >= fromCol.cards.length) return state;
  const substack = fromCol.cards.slice(fromIdx);
  const toCol = state.tableau.find((c) => c.id === toColId);
  if (!toCol || !canStackOnTableau(substack[0], toCol)) return state;

  const newTableau = state.tableau.map((col) => {
    if (col.id === fromColId) return { ...col, cards: revealTop(col.cards.slice(0, fromIdx)) };
    if (col.id === toColId) return { ...col, cards: [...col.cards, ...substack] };
    return col;
  });
  return spendMove({ ...state, tableau: newTableau, selectedCard: null });
}

/** Move top drawn card onto a tableau column. */
export function moveDrawnToTableau(state: GameState, toColId: number): GameState {
  if (state.drawnCards.length === 0) return state;
  const card = state.drawnCards[state.drawnCards.length - 1];
  // Category cards from the drawn pile cannot be placed on the tableau
  if (card.type === 'category') return state;
  const toCol = state.tableau.find((c) => c.id === toColId);
  if (!toCol || !canStackOnTableau(card, toCol)) return state;

  const newTableau = state.tableau.map((col) =>
    col.id === toColId ? { ...col, cards: [...col.cards, card] } : col,
  );
  return spendMove({ ...state, drawnCards: state.drawnCards.slice(0, -1), tableau: newTableau, selectedCard: null });
}

export function canPlaceOnField(card: Card, field: Field): boolean {
  if (field.cards.length === 0) return card.type === 'category';
  if (card.type === 'category') return false;
  return card.categoryId === field.cards[0].categoryId;
}

/** Can a substack be placed entirely onto a field?
 *  All cards must share the same categoryId, and the bottom card must be field-compatible. */
export function canPlaceSubstackOnField(substack: Card[], field: Field): boolean {
  if (substack.length === 0) return false;
  const catId = substack[0].categoryId;
  if (!substack.every((c) => c.categoryId === catId)) return false;
  return canPlaceOnField(substack[0], field);
}

/** Move an entire substack from a tableau column onto a field. */
export function placeSubstackOnField(
  state: GameState,
  fromColId: number,
  fromIdx: number,
  targetFieldId: number,
): GameState {
  const fromCol = state.tableau.find((c) => c.id === fromColId);
  if (!fromCol || fromIdx < 0 || fromIdx >= fromCol.cards.length) return state;
  const substack = fromCol.cards.slice(fromIdx);
  const targetField = state.fields.find((f) => f.id === targetFieldId);
  if (!targetField || !canPlaceSubstackOnField(substack, targetField)) return state;

  const newTableau = state.tableau.map((col) =>
    col.id === fromColId ? { ...col, cards: revealTop(col.cards.slice(0, fromIdx)) } : col,
  );
  const newFields = state.fields.map((f) =>
    f.id === targetFieldId ? { ...f, cards: [...f.cards, ...substack] } : f,
  );
  const afterPlace: GameState = spendMove({ ...state, fields: newFields, tableau: newTableau, selectedCard: null });
  const afterClear = clearCompletedFields(afterPlace);
  return { ...afterClear, isWon: checkWin(afterClear) };
}

/** After placing cards, clear any field where the category is fully collected. */
function clearCompletedFields(state: GameState): GameState {
  let newCompleted = state.completedCategories;
  const newFields = state.fields.map((f) => {
    if (f.cards.length === 0) return f;
    const catCard = f.cards[0];
    if (catCard.type !== 'category') return f;
    const expected = state.categoryAssocCounts[catCard.categoryId] ?? 0;
    if (f.cards.length - 1 >= expected) {
      newCompleted++;
      return { ...f, cards: [] };
    }
    return f;
  });
  return { ...state, fields: newFields, completedCategories: newCompleted };
}

export function placeCard(state: GameState, targetFieldId: number): GameState {
  const { selectedCard, fields } = state;
  if (!selectedCard) return state;

  const targetField = fields.find((f) => f.id === targetFieldId);
  if (!targetField || !canPlaceOnField(selectedCard.card, targetField)) return state;

  let newFields = fields.map((f) => ({ ...f, cards: [...f.cards] }));
  let newDrawnCards = state.drawnCards;
  let newTableau = state.tableau.map((col) => ({ ...col, cards: [...col.cards] }));

  const src = selectedCard.source;
  if (src.type === 'drawn') {
    newDrawnCards = state.drawnCards.slice(0, -1);
  } else if (src.type === 'field') {
    const srcField = newFields.find((f) => f.id === src.fieldId)!;
    srcField.cards = srcField.cards.slice(0, -1);
  } else if (src.type === 'tableau') {
    const srcCol = newTableau.find((c) => c.id === src.columnId)!;
    srcCol.cards = revealTop(srcCol.cards.slice(0, -1));
  }

  newFields = newFields.map((f) =>
    f.id === targetFieldId ? { ...f, cards: [...f.cards, selectedCard.card] } : f,
  );

  const afterPlace: GameState = spendMove({
    ...state,
    fields: newFields,
    tableau: newTableau,
    drawnCards: newDrawnCards,
    selectedCard: null,
  });

  const afterClear = clearCompletedFields(afterPlace);
  return { ...afterClear, isWon: checkWin(afterClear) };
}

export function selectCard(state: GameState, card: Card, source: CardSource): GameState {
  if (state.selectedCard?.card.id === card.id) return { ...state, selectedCard: null };
  return { ...state, selectedCard: { card, source } };
}

function checkWin(state: GameState): boolean {
  return state.totalCategories > 0 && state.completedCategories >= state.totalCategories;
}

function hasBoardMoves(state: GameState): boolean {
  const drawnTop = state.drawnCards.length > 0 ? state.drawnCards[state.drawnCards.length - 1] : null;

  // Any card → field?
  for (const field of state.fields) {
    if (drawnTop && canPlaceOnField(drawnTop, field)) return true;
    for (const col of state.tableau) {
      if (col.cards.length === 0) continue;
      const top = col.cards[col.cards.length - 1];
      if (top.revealed && canPlaceOnField(top, field)) return true;
    }
  }

  // Any tableau → tableau?
  for (const fromCol of state.tableau) {
    const lowestRevIdx = fromCol.cards.findIndex((c) => c.revealed);
    if (lowestRevIdx === -1) continue;
    const bottomCard = fromCol.cards[lowestRevIdx];
    for (const toCol of state.tableau) {
      if (toCol.id === fromCol.id) continue;
      if (canStackOnTableau(bottomCard, toCol)) return true;
    }
  }

  // Drawn card → tableau?
  if (drawnTop) {
    for (const col of state.tableau) {
      if (canStackOnTableau(drawnTop, col)) return true;
    }
  }

  return false;
}

/** True when the move budget has been spent (hard mode only). */
export function isOutOfMoves(state: GameState): boolean {
  return !state.isWon && state.movesLeft !== null && state.movesLeft <= 0;
}

/** True when the deck is exhausted AND no moves remain on the board. */
export function isStuck(state: GameState): boolean {
  if (state.isWon) return false;
  if (state.deck.length > 0 || state.drawnCards.length > 0 || state.discardPile.length > 0) return false;
  return !hasBoardMoves(state);
}
