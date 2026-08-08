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

  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#21262d';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }

  const toX = (i) => pad.left + (i / (points.length - 1)) * cw;
  const toY = (p) => pad.top + ch - ((p - min) / (max - min)) * ch;

  ctx.beginPath();
  ctx.strokeStyle = isUp ? '#00c853' : '#ff1744';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  for (let i = 0; i < points.length; i++) {
    const x = toX(i), y = toY(points[i].price);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX(points.length - 1), toY(points[points.length - 1].price));
  ctx.lineTo(toX(points.length - 1), pad.top + ch);
  ctx.lineTo(toX(0), pad.top + ch);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
  grad.addColorStop(0, isUp ? 'rgba(0,200,83,0.2)' : 'rgba(255,23,68,0.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`$${symbol.toUpperCase()} ${isUp ? '+' : ''}${pctChange.toFixed(2)}%`, width / 2, 32);

  ctx.font = '12px Arial';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = min + ((max - min) / 4) * (4 - i);
    const priceStr = val < 0.01 ? val.toFixed(6) : val < 100 ? val.toFixed(4) : val.toFixed(2);
    ctx.fillText('$' + priceStr, pad.left - 6, pad.top + (ch / 4) * i + 4);
  }

  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'center';
  const n = 6;
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i / (n - 1)) * (points.length - 1));
    const d = new Date(points[idx].time);
    ctx.fillText(d.getHours() + ':00', toX(idx), height - 10);
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${symbol}_chart.png`);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  return filePath;
}