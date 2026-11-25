import { units } from "../core/portfolio.js";
export function insurance(b) {
  // Open inventory includes snapshots as well as later purchases. Closed legs
  // recover their entry outlay from proceeds minus realized P&L.
  const year = b.asOf.slice(0, 4);
  const current = b.positions.filter(
    (p) => p.type === "put" && p.quantity > 0 && p.open.startsWith(year),
  );
  const closed = b.journal.filter(
    (e) => e.event === "Close" && e.type === "put" && e.quantity > 0,
  );
  const spent =
    current.reduce((s, p) => s + p.entry * units(p) + p.commission, 0) +
    closed
      .filter((e) => (e.openDate ?? e.date).startsWith(year))
      .reduce((s, e) => s + e.cashflow - e.realized, 0);
  const proceeds = closed
    .filter((e) => e.date.startsWith(year))
    .reduce((s, e) => s + e.cashflow, 0);
  return {
    spent,
    proceeds,
    remaining: b.budget - spent,
    net: spent - proceeds,
  };
}
