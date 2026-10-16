import { describe, expect, it } from 'vitest';
import { CardBox, layoutCards, linkPath, placeCards, rowAnchor } from './diagram-layout.util';

describe('layoutCards', () => {
  it('fills rows left to right and makes each row as tall as its tallest card', () => {
    // 640px fits two 220px cards with a 96px gap, 24px padding on the left and room for a link on the right.
    const layout = layoutCards([{ id: 1, rowCount: 2 }, { id: 2, rowCount: 5 }, { id: 3, rowCount: 1 }], 640);

    expect(layout.cards).toEqual([
      { id: 1, x: 24, y: 24, width: 220, height: 96 },
      { id: 2, x: 340, y: 24, width: 220, height: 180 },
      { id: 3, x: 24, y: 252, width: 220, height: 68 },
    ]);
    // Right edge keeps room for a link that loops out beside the last column of cards.
    expect(layout.width).toBe(624);
    expect(layout.height).toBe(344);
  });

  it('puts one card per row when the space is narrow', () => {
    const layout = layoutCards([{ id: 1, rowCount: 1 }, { id: 2, rowCount: 1 }], 100);

    expect(layout.cards.map(c => [c.x, c.y])).toEqual([[24, 24], [24, 140]]);
  });

  it('is wide enough for a link that loops out on the right of a single column', () => {
    const layout = layoutCards([{ id: 1, rowCount: 2 }, { id: 2, rowCount: 2 }], 100);
    const [top, bottom] = layout.cards;
    const control = Number(linkPath(top, 0, bottom, 0).d.split(' ')[4]);

    expect(control).toBeLessThanOrEqual(layout.width);
  });

  it('never lays out wider than the space it was given when more than one column fits', () => {
    const layout = layoutCards([{ id: 1, rowCount: 1 }, { id: 2, rowCount: 1 }], 600);

    expect(layout.width).toBeLessThanOrEqual(600);
  });

  it('is empty without cards', () => {
    expect(layoutCards([], 900)).toEqual({ cards: [], width: 0, height: 0 });
  });
});

describe('rowAnchor', () => {
  it('is the middle of a column row on the chosen edge', () => {
    expect(rowAnchor({ id: 1, x: 24, y: 24, width: 220, height: 96 }, 1, 'right')).toEqual({ x: 244, y: 106 });
  });
});

describe('linkPath', () => {
  const left: CardBox = { id: 1, x: 24, y: 24, width: 220, height: 96 };
  const right: CardBox = { id: 2, x: 340, y: 24, width: 220, height: 96 };
  const below: CardBox = { id: 3, x: 24, y: 252, width: 220, height: 68 };

  it('leaves the right edge and enters the left edge when the target is to the right', () => {
    expect(linkPath(left, 0, right, 0)).toEqual({
      d: 'M 244 78 C 308 78, 276 78, 340 78', mid: { x: 292, y: 78 },
      from: { x: 244, y: 78, side: 'right' }, to: { x: 340, y: 78, side: 'left' },
    });
  });

  it('leaves the left edge when the target is to the left', () => {
    expect(linkPath(right, 0, left, 0).d).toBe('M 340 78 C 276 78, 308 78, 244 78');
  });

  it('loops out on the right when both cards share a grid column', () => {
    expect(linkPath(left, 0, below, 0).d).toBe('M 244 78 C 308 78, 308 306, 244 306');
  });

  it('loops out on the right when a moved card overlaps the other across', () => {
    expect(linkPath(left, 0, { ...below, x: 100 }, 0).to.side).toBe('right');
  });
});

describe('placeCards', () => {
  it('puts a moved card at its saved place and grows the surface to hold it', () => {
    const layout = layoutCards([{ id: 1, rowCount: 1 }, { id: 2, rowCount: 1 }], 600);
    const placed = placeCards(layout, new Map([[2, { x: 900, y: 500 }]]));
    expect(placed.cards[0]).toEqual(layout.cards[0]);
    expect(placed.cards[1]).toMatchObject({ x: 900, y: 500 });
    expect(placed.width).toBe(900 + 220 + 64);
    expect(placed.height).toBe(500 + 68 + 24);
  });
});
