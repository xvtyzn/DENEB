/**
 * Browser-side export helpers. The core renderer produces an SVG string that is
 * already self-contained, so these only deal with turning it into a bitmap and
 * handing it to the user.
 */

export interface PngOptions {
  /** Multiplier applied to the SVG's intrinsic size. Default 2 (retina). */
  scale?: number;
  /** Painted behind the drawing; `null` keeps transparency. Default '#ffffff'. */
  background?: string | null;
}

function intrinsicSize(svg: string): { width: number; height: number } {
  const w = /\swidth="([\d.]+)"/.exec(svg);
  const h = /\sheight="([\d.]+)"/.exec(svg);
  if (w?.[1] && h?.[1]) return { width: Number(w[1]), height: Number(h[1]) };
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  if (vb?.[3] && vb[4]) return { width: Number(vb[3]), height: Number(vb[4]) };
  return { width: 600, height: 400 };
}

/** Rasterise an SVG string to a PNG data URL. Browser only. */
export async function svgToPngDataUrl(svg: string, options: PngOptions = {}): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('svgToPngDataUrl requires a browser environment.');
  }
  const scale = options.scale ?? 2;
  const background = options.background === undefined ? '#ffffff' : options.background;
  const { width, height } = intrinsicSize(svg);

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = new Image();
  image.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to rasterise the SVG.'));
    image.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadSVG(svg: string, filename = 'antibody.svg'): void {
  if (typeof document === 'undefined') throw new Error('downloadSVG requires a browser.');
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadPNG(
  svg: string,
  filename = 'antibody.png',
  options: PngOptions = {},
): Promise<void> {
  triggerDownload(await svgToPngDataUrl(svg, options), filename);
}
