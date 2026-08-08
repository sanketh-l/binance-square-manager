import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';

export function drawPriceChart(symbol, prices, outDir = '.') {
  const width = 800, height = 450;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const pad = { top: 50, right: 30, bottom: 50, left: 70 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  const points = prices.map(([t, p]) => ({ time: t, price: p }));
  let min = Infinity, max = -Infinity;
  for (const p of points) { if (p.price < min) min = p.price; if (p.price > max) max = p.price; }
  const range = max - min || 1;
  const margin = range * 0.08;
  min -= margin; max += margin;

  const pctChange = ((points[points.length - 1].price - points[0].price) / points[0].price) * 100;
  const isUp = pctChange >= 0;

  // Light background for better visibility
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Grid
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }
  for (let i = 0; i <= 6; i++) {
    const x = pad.left + (cw / 6) * i;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch); ctx.stroke();
  }

  const toX = (i) => pad.left + (i / (points.length - 1)) * cw;
  const toY = (p) => pad.top + ch - ((p - min) / (max - min)) * ch;

  // Area fill
  ctx.beginPath();
  ctx.moveTo(toX(0), pad.top + ch);
  for (let i = 0; i < points.length; i++) {
    ctx.lineTo(toX(i), toY(points[i].price));
  }
  ctx.lineTo(toX(points.length - 1), pad.top + ch);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
  grad.addColorStop(0, isUp ? 'rgba(0,200,83,0.15)' : 'rgba(255,23,68,0.15)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Price line
  ctx.beginPath();
  ctx.strokeStyle = isUp ? '#00a843' : '#e01b24';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  for (let i = 0; i < points.length; i++) {
    const x = toX(i), y = toY(points[i].price);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current price dot
  const lastX = toX(points.length - 1);
  const lastY = toY(points[points.length - 1].price);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
  ctx.fillStyle = isUp ? '#00a843' : '#e01b24';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Title
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${symbol.toUpperCase()} ${isUp ? '+' : ''}${pctChange.toFixed(2)}%`, width / 2, 32);

  // Y-axis labels
  ctx.font = '12px Arial';
  ctx.fillStyle = '#666666';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = min + ((max - min) / 4) * (4 - i);
    const priceStr = val < 0.01 ? val.toFixed(6) : val < 100 ? val.toFixed(4) : val.toFixed(2);
    ctx.fillText('$' + priceStr, pad.left - 8, pad.top + (ch / 4) * i + 4);
  }

  // X-axis labels
  ctx.fillStyle = '#666666';
  ctx.textAlign = 'center';
  const n = 6;
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i / (n - 1)) * (points.length - 1));
    const d = new Date(points[idx].time);
    ctx.fillText(d.getHours() + ':00', toX(idx), height - 12);
  }

  // Watermark
  ctx.fillStyle = '#cccccc';
  ctx.font = '10px Arial';
  ctx.textAlign = 'right';
  ctx.fillText('Binance Square Bot', width - 20, height - 15);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${symbol}_chart.png`);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  return filePath;
}