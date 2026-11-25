import { blackScholes } from "./pricing.js";
const day = 86400000;
export const addDays = (date, days) =>
  new Date(Date.parse(date) + days * day).toISOString().slice(0, 10);
export const daysBetween = (a, b) =>
  Math.round((Date.parse(b) - Date.parse(a)) / day);
export const units = (p) =>
  p.quantity * (p.type === "stock" ? 1 : p.multiplier);
export function model(
  p,
  book,
  spot = book.quotes[p.symbol],
  date = book.asOf,
  iv = p.iv,
) {
  if (p.type === "stock")
    return { price: spot, delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 };
  return blackScholes(
    p.type,
    spot,
    p.strike,
    Math.max(0, daysBetween(date, p.expiration)) / 365,
    iv,
    book.rate,
    book.dividend,
  );
}
export function mark(p, b) {
  return p.type !== "stock" && p.expiration > b.asOf && p.market != null
    ? p.market
    : model(p, b).price;
}
export const pnl = (p, b) => (mark(p, b) - p.entry) * units(p) - p.commission;
export function totals(b) {
  let stock = 0,
    options = 0,
    unrealized = 0;
  for (const p of b.positions) {
    const v = mark(p, b) * units(p);
    if (p.type === "stock") stock += v;
    else options += v;
    unrealized += pnl(p, b);
  }
  const realized = b.journal.reduce((s, e) => s + e.realized, 0);
  return {
    stock,
    options,
    unrealized,
    realized,
    nav: b.cash + stock + options,
  };
}
// Opening inventory is a snapshot. Trades after that move cash exactly once.
export function closePosition(b, id) {
  const p = b.positions.find((p) => p.id === id);
  if (!p) throw Error("持仓不存在");
  const price = mark(p, b),
    flow = price * units(p);
  return {
    ...b,
    cash: b.cash + flow,
    positions: b.positions.filter((x) => x.id !== id),
    journal: [
      ...b.journal,
      {
        date: b.asOf,
        event: "Close",
        openDate: p.open,
        symbol: p.symbol,
        type: p.type,
        quantity: p.quantity,
        cashflow: flow,
        realized: pnl(p, b),
      },
    ],
  };
}

export function yearProfit(b) {
  const year = b.asOf.slice(0, 4);
  const closed = b.journal.filter(
    (e) => e.event === "Close" && e.date.startsWith(year),
  );
  if (
    b.positions.some((p) => !p.open.startsWith(year)) ||
    closed.some((e) => !e.openDate?.startsWith(year))
  )
    return null;
  return (
    closed.reduce((s, e) => s + e.realized, 0) +
    b.positions.reduce((s, p) => s + pnl(p, b), 0)
  );
}
