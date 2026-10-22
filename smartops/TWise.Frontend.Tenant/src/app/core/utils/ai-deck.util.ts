import PptxGenJS from 'pptxgenjs';
import type { AiDeck } from '../services/ai.service';

/** A picture for a deck slide: a PNG data URL and its size in pixels. */
export interface DeckImage { data: string; width: number; height: number }

export function canvasImage(canvas: HTMLCanvasElement | null | undefined): DeckImage | null {
  return canvas?.width && canvas.height ? { data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height } : null;
}

/** A chart as drawn on the page: its Highcharts SVG painted on a canvas at twice its size, so the slide stays sharp. */
export async function svgChartImage(host: Element | null): Promise<DeckImage | null> {
  const svg = host?.querySelector('svg.highcharts-root') as SVGSVGElement | null;
  const box = svg?.getBoundingClientRect();
  if (!svg || !box?.width || !box.height) return null;
  try {
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', `${box.width}`);
    copy.setAttribute('height', `${box.height}`);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The chart could not be drawn.'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.width * 2);
    canvas.height = Math.round(box.height * 2);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasImage(canvas);
  } catch {
    return null;
  }
}

/**
 * Writes the AI slide deck: a title slide with the AI's headline, the Key figures (numbers the server checked against the
 * data), the KPI tiles when the page has them, one slide per chart (its picture on the left, the AI's title, bullets and
 * takeaway on the right) and a closing slide. Used by the dashboard view and the Dashboard Builder.
 */
export async function writeAiDeck(deck: AiDeck, page: { title: string; chartTitles: string[]; images: (DeckImage | null)[]; kpiTiles?: DeckImage | null }): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const W = 13.333333, H = 7.5, navy = '21409A', ink = '101828', muted = '475467', font = 'Calibri';
  const fit = (img: DeckImage, w: number, h: number) => { let iw = w, ih = img.height * w / img.width; if (ih > h) { iw = iw * h / ih; ih = h; } return { w: iw, h: ih }; };

  const title = pptx.addSlide();
  title.background = { color: 'F8FAFC' };
  title.addText(page.title, { x: 0.8, y: 2.2, w: W - 1.6, h: 1.2, fontSize: 36, bold: true, color: navy, fontFace: font });
  if (deck.headline) title.addText(deck.headline, { x: 0.8, y: 3.5, w: W - 1.6, h: 1.4, fontSize: 20, color: ink, fontFace: font });
  title.addText(new Date().toLocaleDateString(), { x: 0.8, y: H - 1, w: 6, h: 0.4, fontSize: 12, color: muted, fontFace: font });

  const figures = deck.keyFigures ?? [];
  if (figures.length) {
    const s = pptx.addSlide();
    s.background = { color: 'F8FAFC' };
    s.addText('Key figures', { x: 0.6, y: 0.4, w: W - 1.2, h: 0.7, fontSize: 24, bold: true, color: navy, fontFace: font });
    const cols = Math.min(3, figures.length), gap = 0.3, cardW = (W - 1.2 - gap * (cols - 1)) / cols, cardH = 2.3;
    figures.forEach((f, i) => {
      const x = 0.6 + (i % cols) * (cardW + gap), y = 1.5 + Math.floor(i / cols) * (cardH + gap);
      s.addShape(pptx.ShapeType.rect, { x, y, w: cardW, h: cardH, fill: { color: 'FFFFFF' }, line: { color: 'E4E7EC' } });
      s.addText(f.value, { x: x + 0.2, y: y + 0.2, w: cardW - 0.4, h: 0.9, fontSize: 32, bold: true, color: navy, fontFace: font });
      s.addText(f.label, { x: x + 0.2, y: y + 1.1, w: cardW - 0.4, h: 0.5, fontSize: 14, color: ink, fontFace: font });
      if (f.note) s.addText(f.note, { x: x + 0.2, y: y + 1.6, w: cardW - 0.4, h: 0.6, fontSize: 11, color: muted, fontFace: font, valign: 'top' });
    });
  }

  if (page.kpiTiles) {
    const s = pptx.addSlide();
    s.background = { color: 'F8FAFC' };
    s.addText(figures.length ? 'KPI tiles' : 'Key figures', { x: 0.6, y: 0.4, w: W - 1.2, h: 0.7, fontSize: 24, bold: true, color: navy, fontFace: font });
    const { w, h } = fit(page.kpiTiles, W - 1.2, H - 2);
    s.addImage({ data: page.kpiTiles.data, x: (W - w) / 2, y: 1.4, w, h });
  }

  deck.slides.forEach((slide, i) => {
    const s = pptx.addSlide();
    s.background = { color: 'F8FAFC' };
    s.addText(slide.title || page.chartTitles[i], { x: 0.6, y: 0.4, w: W - 1.2, h: 0.7, fontSize: 24, bold: true, color: navy, fontFace: font });
    const img = page.images[i];
    const imgBox = { x: 0.6, y: 1.3, w: 7.6, h: H - 2.1 };
    if (img) {
      const { w, h } = fit(img, imgBox.w, imgBox.h);
      s.addImage({ data: img.data, x: imgBox.x, y: imgBox.y, w, h });
    }
    const textX = imgBox.x + imgBox.w + 0.4, textW = W - textX - 0.6;
    if (slide.bullets.length)
      s.addText(slide.bullets.map(b => ({ text: b, options: { bullet: true, breakLine: true } })), { x: textX, y: 1.3, w: textW, h: 3.6, fontSize: 14, color: ink, fontFace: font, valign: 'top', paraSpaceAfter: 6 });
    if (slide.takeaway)
      s.addText(slide.takeaway, { x: textX, y: 5.1, w: textW, h: 1.6, fontSize: 13, italic: true, color: navy, fontFace: font, valign: 'top', fill: { color: 'EEF2FF' }, margin: 8 });
  });

  if (deck.closing) {
    const s = pptx.addSlide();
    s.background = { color: 'F8FAFC' };
    s.addText('In summary', { x: 0.8, y: 1.6, w: W - 1.6, h: 0.9, fontSize: 28, bold: true, color: navy, fontFace: font });
    s.addText(deck.closing, { x: 0.8, y: 2.7, w: W - 1.6, h: 3, fontSize: 18, color: ink, fontFace: font, valign: 'top' });
  }
  await pptx.writeFile({ fileName: `${page.title} - AI deck.pptx` });
}
