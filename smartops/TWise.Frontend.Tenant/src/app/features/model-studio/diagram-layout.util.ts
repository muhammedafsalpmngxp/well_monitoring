export const CARD_WIDTH = 220;
export const HEADER_HEIGHT = 40;
export const ROW_HEIGHT = 28;
const GAP_X = 96;
const GAP_Y = 48;
const PADDING = 24;
const CURVE = 64;
/** Room beside a card edge for a cardinality mark. */
const MARK = 16;

export interface Point { x: number; y: number; }
export interface CardBox { id: number; x: number; y: number; width: number; height: number; }
export interface DiagramLayout { cards: CardBox[]; width: number; height: number; }

/**
 * Places cards left to right in rows that fit the available width. Positions are computed on
 * every render and never stored.
 */
// ponytail: a table with hundreds of columns makes a very tall card; add a column filter per card if that happens.
export function layoutCards(cards: { id: number; rowCount: number }[], availableWidth: number): DiagramLayout {
  const perRow = Math.max(1, Math.floor((availableWidth - PADDING - Math.max(PADDING, CURVE) + GAP_X) / (CARD_WIDTH + GAP_X)));
  const boxes: CardBox[] = [];
  let y = PADDING;
  for (let start = 0; start < cards.length; start += perRow) {
    let tallest = 0;
    cards.slice(start, start + perRow).forEach((card, i) => {
      const height = HEADER_HEIGHT + card.rowCount * ROW_HEIGHT;
      boxes.push({ id: card.id, x: PADDING + i * (CARD_WIDTH + GAP_X), y, width: CARD_WIDTH, height });
      tallest = Math.max(tallest, height);
    });
    y += tallest + GAP_Y;
  }
  const columns = Math.min(perRow, cards.length);
  return {
    cards: boxes,
    // The right margin is CURVE wide so a link that loops out beside the last column is not clipped.
    width: columns === 0 ? 0 : PADDING + columns * CARD_WIDTH + (columns - 1) * GAP_X + Math.max(PADDING, CURVE),
    height: cards.length === 0 ? 0 : y - GAP_Y + PADDING,
  };
}

/** The middle of a column row, on the left or right edge of its card. */
export function rowAnchor(card: CardBox, rowIndex: number, side: 'left' | 'right'): Point {
  return {
    x: side === 'left' ? card.x : card.x + card.width,
    y: card.y + HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
  };
}

/** Where a line meets a card: the row's anchor and the edge it leaves from. */
export interface LinkEnd extends Point { side: 'left' | 'right'; }

/**
 * A curve from one column row to another, its midpoint, and both ends for the cardinality marks. A line leaves from
 * the facing edges when the cards stand apart, and loops out on the right when they overlap across.
 */
export function linkPath(from: CardBox, fromRow: number, to: CardBox, toRow: number): { d: string; mid: Point; from: LinkEnd; to: LinkEnd } {
  const apart = from.x + from.width + 2 * MARK < to.x || to.x + to.width + 2 * MARK < from.x;
  const fromSide = !apart || from.x < to.x ? 'right' : 'left';
  const toSide = !apart || from.x > to.x ? 'right' : 'left';
  const p0 = rowAnchor(from, fromRow, fromSide);
  const p3 = rowAnchor(to, toRow, toSide);
  const p1 = { x: p0.x + (fromSide === 'right' ? CURVE : -CURVE), y: p0.y };
  const p2 = { x: p3.x + (toSide === 'right' ? CURVE : -CURVE), y: p3.y };
  // The point of a cubic Bezier curve at t = 0.5.
  const mid = { x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8, y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8 };
  return {
    d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`, mid,
    from: { ...p0, side: fromSide }, to: { ...p3, side: toSide },
  };
}

/**
 * The layout with each moved card at its saved place, and the surface grown to hold them. Cards not moved keep
 * their grid place.
 */
// ponytail: a card added after others were moved takes its grid place and can land under a moved one; Auto arrange fixes it.
export function placeCards(layout: DiagramLayout, moved: ReadonlyMap<number, Point>): DiagramLayout {
  if (!moved.size) return layout;
  const cards = layout.cards.map(box => ({ ...box, ...(moved.get(box.id) ?? {}) }));
  return {
    cards,
    width: Math.max(layout.width, ...cards.map(box => box.x + box.width + CURVE)),
    height: Math.max(layout.height, ...cards.map(box => box.y + box.height + PADDING)),
  };
}
