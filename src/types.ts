export interface CategoryData {
  id: string;
  name: string;
  associations: string[];
}

export type CardType = 'category' | 'association';

export interface Card {
  id: string;
  type: CardType;
  text: string;
  categoryId: string;
  revealed: boolean;
}

export interface Field {
  id: number;
  cards: Card[];
}

export interface TableauColumn {
  id: number;
  cards: Card[]; // cards[0] = bottom of stack (dealt first), cards[n-1] = top (interactable)
}

export interface GameState {
  fields: Field[];
  tableau: TableauColumn[];
  deck: Card[];
  drawnCards: Card[]; // [0]=oldest … [n-1]=top (newest, interactive)
  discardPile: Card[];
  selectedCard: { card: Card; source: CardSource } | null;
  isWon: boolean;
  categoryAssocCounts: Record<string, number>; // categoryId → total assoc count in this game
  completedCategories: number; // how many categories fully collected and cleared
  totalCategories: number; // N chosen at game start
  movesLeft: number | null; // null = unlimited (easy); counts down each action (hard)
}

export type CardSource =
  | { type: 'field'; fieldId: number }
  | { type: 'drawn' }
  | { type: 'tableau'; columnId: number };
