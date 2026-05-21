export function desaturateHex(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = max === min ? 0 : l < 0.5
    ? (max - min) / (max + min)
    : (max - min) / (2 - max - min);

  s = Math.max(0, s - amount);

  const hue = max === min ? 0 : max === r
    ? ((g - b) / (max - min) + 6) % 6
    : max === g
    ? (b - r) / (max - min) + 2
    : (r - g) / (max - min) + 4;
  const h = hue / 6;

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${toHex(hue2rgb(h + 1/3))}${toHex(hue2rgb(h))}${toHex(hue2rgb(h - 1/3))}`;
}