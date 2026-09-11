export function fmtMoney(n: number, dp = 0): string {
  const neg = n < 0;
  const v = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${neg ? '-' : ''}$${v}`;
}
export function fmtSigned(n: number, dp = 0): string {
  const v = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${n >= 0 ? '+' : '-'}$${v}`;
}
export function fmtPct(n: number, dp = 2): string { return `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`; }
export function fmtNum(n: number, dp = 2): string { return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
export function cx(...xs: Array<string | false | undefined>): string { return xs.filter(Boolean).join(' '); }
export function sparkPath(values: number[], w: number, h: number, pad = 2): string {
  if (values.length === 0) return '';
  if (values.length === 1) return `M ${pad} ${h / 2} L ${w - pad} ${h / 2}`;
  const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(pad + i * step).toFixed(1)} ${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`).join(' ');
}
export function tickersOf(companies: Record<string, { ticker: string }>): string[] { return Object.keys(companies); }
