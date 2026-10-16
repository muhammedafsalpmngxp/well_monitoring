import { waitForDashboardRender } from './dashboard-render-ready.util';

export function wrapDashboardTitle(context: CanvasRenderingContext2D, title: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of title.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
    if (line) { lines.push(line); line = ''; }
    for (const character of word) {
      if (line && context.measureText(line + character).width > maxWidth) { lines.push(line); line = ''; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['Dashboard'];
}

export async function createDashboardExportHeader(title: string, host: HTMLElement, width = 3104): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  const context = canvas.getContext('2d')!;
  const fontSize = Math.round(width * 0.018);
  const padding = width * 0.018;
  const logoWidth = width * 0.18;
  const gap = width * 0.025;
  const titleWidth = width - 2 * (logoWidth + gap);
  context.font = `bold ${fontSize}px sans-serif`;
  const lines = wrapDashboardTitle(context, title, titleWidth);
  const lineHeight = fontSize * 1.25;
  const dateFontSize = Math.round(fontSize * 0.5);
  const dateGap = fontSize * 0.2;
  // Title lines + date line, measured exactly so the block can be centred on the same axis as the logos.
  const textHeight = lines.length * lineHeight + dateGap + dateFontSize * 1.25;
  canvas.height = Math.ceil(Math.max(width * 0.065, textHeight + padding * 2));
  const textTop = (canvas.height - textHeight) / 2;
  context.fillStyle = '#f8fafc';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#e4e7ec';
  context.lineWidth = Math.max(1, width / 1000);
  context.beginPath();
  context.roundRect(1, 1, canvas.width - 2, canvas.height - 2, width * 0.008);
  context.fill();
  context.stroke();
  context.fillStyle = '#1d2939';
  context.font = `bold ${fontSize}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  lines.forEach((line, index) => context.fillText(line, width / 2, textTop + index * lineHeight + (lineHeight - fontSize) / 2));
  context.fillStyle = '#667085';
  context.font = `${dateFontSize}px sans-serif`;
  const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
  context.fillText(`As on ${date}`, width / 2, textTop + lines.length * lineHeight + dateGap + dateFontSize * 0.125);

  for (const side of ['left', 'right']) {
    const logo = host.querySelector<HTMLElement>(`app-dashboard-branding .${side}`);
    if (!logo) continue;
    await waitForDashboardRender(() => !!logo.querySelector('img, [role="status"]'));
    const image = logo.querySelector('img');
    // No logo configured ("Logo Unavailable"): export without it rather than failing.
    if (!image) continue;
    await image.decode();
    const maxHeight = width * 0.035;
    const scale = Math.min(logoWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const imageWidth = image.naturalWidth * scale;
    const imageHeight = image.naturalHeight * scale;
    context.drawImage(image, side === 'left' ? padding : width - padding - imageWidth, (canvas.height - imageHeight) / 2, imageWidth, imageHeight);
  }
  return canvas;
}