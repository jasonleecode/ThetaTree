import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blackScholes, impliedVolatility } from "../js/core/pricing.js";
import { aggregate } from "../js/core/greeks.js";
import {
  addDays,
  daysBetween,
  model,
  mark,
  units,
  totals,
  pnl,
  closePosition,
} from "../js/core/portfolio.js";
import { payoff, expiryStats } from "../js/core/payoff.js";
import { risk } from "../js/core/risk.js";
import { validate } from "../js/core/storage.js";
import { roll } from "../js/strategy/roll.js";
import { wheel } from "../js/strategy/wheel.js";
import { insurance } from "../js/strategy/insurance.js";
import { stress, tail, leveragedPath } from "../js/strategy/antifragility.js";
import { alerts } from "../js/alerts/engine.js";
const b = JSON.parse(
  readFileSync(new URL("../data/demo.json", import.meta.url)),
);
const [stock, put] = b.positions;
const near = (actual, expected, tol = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tol, actual + " vs " + expected);

test("reference BSM prices, put-call parity with dividends and inversion", () => {
  near(blackScholes("call", 100, 100, 1, 0.2, 0.05).price, 10.45058357);
  for (const type of ["call", "put"]) {
    const value = blackScholes(type, 97, 100, 0.83, 0.48, 0.03, 0.02);
    near(impliedVolatility(type, 97, 100, 0.83, value.price, 0.03, 0.02), 0.48);
  }
  const args = [97, 100, 0.83, 0.48, 0.03, 0.02];
  near(
    blackScholes("call", ...args).price - blackScholes("put", ...args).price,
    97 * Math.exp(-0.02 * 0.83) - 100 * Math.exp(-0.03 * 0.83),
  );
  assert.equal(impliedVolatility("put", 100, 90, 1, 150), null);
});
test("finite differences verify delta gamma daily theta and vega/rho per percentage point", () => {
  for (const type of ["put", "call"]) {
    const price = (s, t, v, r) =>
        blackScholes(type, s, 100, t, v, r, 0.02).price,
      g = blackScholes(type, 100, 100, 1, 0.2, 0.04, 0.02),
      h = 0.0001;
    near(
      g.delta,
      (price(100 + h, 1, 0.2, 0.04) - price(100 - h, 1, 0.2, 0.04)) / (2 * h),
    );
    near(
      g.gamma,
      (price(100.01, 1, 0.2, 0.04) + price(99.99, 1, 0.2, 0.04) - 2 * g.price) /
        0.0001,
      1e-6,
    );
    near(
      g.vega,
      (price(100, 1, 0.2 + h, 0.04) - price(100, 1, 0.2 - h, 0.04)) /
        (2 * h * 100),
    );
    near(
      g.rho,
      (price(100, 1, 0.2, 0.04 + h) - price(100, 1, 0.2, 0.04 - h)) /
        (2 * h * 100),
    );
    near(
      g.theta,
      (price(100, 1 - h, 0.2, 0.04) - price(100, 1 + h, 0.2, 0.04)) /
        (2 * h * 365),
    );
  }
});
test("expiry, zero spot, zero volatility and extreme price limits", () => {
  assert.equal(blackScholes("put", 0, 30, 0, 0.5).price, 30);
  assert.equal(blackScholes("put", 30, 30, 0, 0).delta, -0.5);
  near(blackScholes("put", 0, 30, 1, 0.5).price, 30 * Math.exp(-0.04));
  near(
    blackScholes("call", 100, 90, 1, 0, 0.05).price,
    100 - 90 * Math.exp(-0.05),
  );
  for (const s of [1e-100, 1e100])
    for (const t of ["put", "call"])
      assert.ok(
        Object.values(blackScholes(t, s, 30, 1, 0.6)).every(Number.isFinite),
      );
  assert.throws(() => blackScholes("put", -1, 30, 1, 0.5));
});
test("demo snapshot net asset value, calendar days and marked holdings", () => {
  assert.equal(daysBetween(b.asOf, put.expiration), 365);
  assert.equal(addDays(b.asOf, 365), put.expiration);
  assert.equal(mark(put, b), 2);
  assert.notEqual(model(put, b).price, 2);
  assert.equal(totals(b).nav, 26400);
  assert.equal(totals(b).unrealized, -13800);
  assert.equal(units(stock), 600);
});
test("signed contract weights, custom multiplier, broker Greeks and opposite offsets", () => {
  const p = {
    ...put,
    multiplier: 10,
    quantity: -3,
    greeks: { delta: -0.2, gamma: 0.1, theta: -0.01, vega: 0.2, rho: -0.3 },
  };
  assert.deepEqual(aggregate([stock, p], b), {
    delta: 606,
    gamma: -3,
    theta: 0.3,
    vega: -6,
    rho: 9,
  });
  const opposite = { ...put, quantity: -put.quantity };
  assert.equal(aggregate([put, opposite], b).delta, 0);
  const closed = closePosition(
    { ...b, positions: [{ ...p, market: 1, commission: 2 }] },
    p.id,
  );
  assert.equal(closed.cash, -30);
  assert.equal(closed.journal[0].realized, 28);
});
test("close converts mark to cash and conserves net assets and total P&L after fees", () => {
  const before = {
      ...b,
      positions: [stock, { ...put, commission: 5, market: 3 }],
    },
    after = closePosition(before, put.id);
  assert.equal(totals(after).nav, totals(before).nav);
  assert.equal(
    totals(after).unrealized + totals(after).realized,
    totals(before).unrealized,
  );
  assert.equal(insurance(after).spent, 1205);
  assert.equal(insurance(after).proceeds, 1800);
  assert.throws(() => closePosition(after, put.id));
});
test("different maturities retain remaining time value and separate reference bases", () => {
  const early = { ...put, expiration: addDays(b.asOf, 30) },
    later = { ...put, expiration: addDays(b.asOf, 90) };
  const f = payoff([early, later], b, 30, early.expiration);
  near(
    f,
    (blackScholes("put", 30, 30, 60 / 365, 0.55, b.rate).price - 4) * 600,
  );
  assert.equal(expiryStats([early, later], b), null);
  const p = { ...put, market: 5, commission: 6 };
  near(payoff([p], b, 20, p.expiration, "cost"), 4794);
  near(payoff([p], b, 20, p.expiration, "mark"), 3000);
});
test("limits, breakeven, exact tail slopes and stress classification for 3/6/12 puts", () => {
  for (const [q, label, slope] of [
    [3, "Fragile", 300],
    [6, "Hedged", 0],
    [12, "Tail Convex", -600],
  ]) {
    const legs = [stock, { ...put, quantity: q }];
    near(tail(legs, b, "TQQQ", put.expiration).slope, slope);
    assert.equal(tail(legs, b, "TQQQ", put.expiration).label, label);
    assert.equal(stress(legs, b, "TQQQ", put.expiration, "cost").length, 10);
  }
  assert.deepEqual(expiryStats(b.positions, b), {
    maxProfit: Infinity,
    maxLoss: 22200,
    roots: [67],
  });
  const short = { ...put, type: "call", quantity: -1, entry: 2 };
  assert.equal(expiryStats([short], b).maxLoss, Infinity);
});
test("reserve and cover are symbol specific, daily reset incurs volatility loss", () => {
  const legs = [
    stock,
    { ...put, symbol: "QQQ" },
    { ...put, quantity: -2 },
    { ...put, type: "call", quantity: -7 },
  ];
  const r = risk(legs, b);
  assert.equal(r.reserve, -6000);
  assert.equal(r.coverage, 0);
  assert.equal(r.uncovered, 100);
  assert.deepEqual(wheel(b.positions), {
    shares: 600,
    putShares: 600,
    callShares: 0,
  });
  near(leveragedPath([0.1, -1 / 11]).at(-1), 1.3 * (1 - 3 / 11));
  assert.equal(leveragedPath([-0.4, 0.5]).at(-1), 0);
});
test("short roll cash credit is independent of realized profit", () => {
  const old = { ...put, quantity: -1, market: 4 },
    next = { ...old, strike: 29, entry: 5, market: null };
  const r = roll(old, next, b);
  assert.equal(r.realized, -200);
  assert.equal(r.net, 100);
  assert.equal(r.open, 500);
  assert.equal(r.close, -400);
  near(r.changes.delta, aggregate([next], b).delta - aggregate([old], b).delta);
});
test("strict roll reminder boundaries and validated JSON roundtrip", () => {
  for (const [d, expected] of [
    [90, undefined],
    [89, "INFO"],
    [60, "INFO"],
    [59, "WARNING"],
    [30, "WARNING"],
    [29, "CRITICAL"],
  ]) {
    const data = {
      ...b,
      positions: [stock, { ...put, expiration: addDays(b.asOf, d) }],
    };
    assert.equal(
      alerts(data).find((a) => a.title.endsWith("保护期限"))?.level,
      expected,
    );
  }
  assert.deepEqual(validate(JSON.parse(JSON.stringify(b))), b);
  for (const patch of [
    { quantity: 0 },
    { multiplier: -1 },
    { expiration: "2027-02-30" },
    { symbol: "FAKE" },
    { iv: -1 },
    { entry: null },
    { id: '"><' },
  ]) {
    assert.throws(() =>
      validate({ ...b, positions: [stock, { ...put, ...patch }] }),
    );
  }
});
test("zero-volatility ATM uses limiting delta and right-sided vega", () => {
  near(blackScholes("put", 100, 100, 1, 0, 0).delta, -0.5);
  near(blackScholes("call", 100, 100, 1, 0, 0).vega, 0.39894228);
});
test("profit alerts use market prices; missing entry references do not trigger change alerts", () => {
  const data = {
    ...b,
    positions: [stock, { ...put, market: 9, entrySpot: null, entryIv: null }],
  };
  assert.ok(alerts(data).some((a) => a.title.endsWith("保险兑现")));
  assert.ok(
    !alerts(data).some(
      (a) => a.title.endsWith("行权价复核") || a.title.endsWith("波动率复核"),
    ),
  );
  assert.ok(
    !alerts({ ...data, rules: { tailGain: 900, putGain: 800 } }).some((a) =>
      a.title.endsWith("保险兑现"),
    ),
  );
});
test("cross-symbol shock uses each original spot, full-year result requires year-opening marks for carry", async () => {
  const { shockedExposure } = await import("../js/core/risk.js");
  const { yearProfit } = await import("../js/core/portfolio.js");
  const p = { ...stock, symbol: "XYZ", quantity: 10, entry: 100 };
  const account = {
    ...b,
    positions: [stock, p],
    quotes: { TQQQ: 42, XYZ: 100 },
  };
  near(shockedExposure(account, -0.1), -2620);
  assert.equal(yearProfit(account), -13800);
  assert.equal(
    yearProfit({ ...account, positions: [{ ...stock, open: "2025-12-31" }] }),
    null,
  );
});
test("linear short stock has downside gains without tail convexity", () => {
  assert.equal(
    tail([{ ...stock, quantity: -600 }], b, "TQQQ", put.expiration).label,
    "Directional short",
  );
  assert.equal(tail([], b, "TQQQ", put.expiration).label, "No exposure");
});
