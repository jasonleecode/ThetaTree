import { rules } from "../alerts/rules.js";
import { names } from "./greeks.js";
const symbol = (s) =>
  typeof s === "string" && /^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(s);
const finite = Number.isFinite;
const date = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d\d-\d\d$/.test(s) &&
  finite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
function check(ok, message) {
  if (!ok) throw Error(message);
}
export function validate(b) {
  check(
    b?.version === 1 &&
      date(b.asOf) &&
      finite(b.cash) &&
      finite(b.rate) &&
      finite(b.dividend),
    "账户格式、日期或利率无效",
  );
  check(
    b.quotes &&
      Object.keys(b.quotes).length &&
      Object.entries(b.quotes).every(
        ([k, v]) => symbol(k) && finite(v) && v > 0,
      ),
    "标的报价无效",
  );
  check(
    Array.isArray(b.positions) && Array.isArray(b.journal),
    "持仓或日志无效",
  );
  const ids = new Set();
  for (const p of b.positions) {
    check(
      typeof p.id === "string" && /^[\w-]{1,80}$/.test(p.id) && !ids.has(p.id),
      "持仓 ID 无效或重复",
    );
    ids.add(p.id);
    check(
      symbol(p.symbol) &&
        Object.hasOwn(b.quotes, p.symbol) &&
        date(p.open) &&
        p.open <= b.asOf,
      "持仓标的或开仓日期无效",
    );
    check(
      ["stock", "put", "call"].includes(p.type) &&
        Number.isSafeInteger(p.quantity) &&
        p.quantity !== 0 &&
        finite(p.entry) &&
        p.entry >= 0 &&
        finite(p.commission) &&
        p.commission >= 0,
      "持仓类型、数量或成本无效",
    );
    if (p.type === "stock") check(p.multiplier === 1, "股票乘数应为 1");
    else
      check(
        date(p.expiration) &&
          p.expiration >= p.open &&
          finite(p.strike) &&
          p.strike > 0 &&
          finite(p.iv) &&
          p.iv >= 0 &&
          Number.isSafeInteger(p.multiplier) &&
          p.multiplier > 0 &&
          (p.market == null || (finite(p.market) && p.market >= 0)),
        "期权合约字段无效",
      );
    check(
      (p.entrySpot == null || (finite(p.entrySpot) && p.entrySpot > 0)) &&
        (p.entryIv == null || (finite(p.entryIv) && p.entryIv >= 0)),
      "开仓参考值无效",
    );
    check(
      !p.greeks ||
        names.every((k) => p.greeks[k] == null || finite(p.greeks[k])),
      "Greeks 数值无效",
    );
  }
  check(
    b.journal.every(
      (e) =>
        date(e.date) &&
        (e.openDate == null || (date(e.openDate) && e.openDate <= e.date)) &&
        e.date <= b.asOf &&
        symbol(e.symbol) &&
        ["Open", "Close"].includes(e.event) &&
        ["stock", "call", "put"].includes(e.type) &&
        Number.isSafeInteger(e.quantity) &&
        e.quantity !== 0 &&
        finite(e.cashflow) &&
        finite(e.realized),
    ),
    "交易记录无效",
  );
  check(
    Array.isArray(b.thresholds) &&
      b.thresholds.length === 3 &&
      b.thresholds.every(
        (v, i) =>
          Number.isInteger(v) && v > 0 && (!i || v < b.thresholds[i - 1]),
      ),
    "提醒天数须为递减正整数",
  );
  check(
    finite(b.budget) &&
      b.budget >= 0 &&
      finite(b.minimumCoverage) &&
      b.minimumCoverage >= 0 &&
      b.minimumCoverage <= 1,
    "保险参数无效",
  );
  check(
    !b.rules ||
      Object.keys(rules).every(
        (k) => b.rules[k] == null || (finite(b.rules[k]) && b.rules[k] >= 0),
      ),
    "提醒阈值无效",
  );
  return b;
}
let db;
function connect() {
  return (db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("ThetaTree-Portfolio", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("accounts");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
export async function load() {
  const conn = await connect();
  return new Promise((resolve, reject) => {
    const req = conn
      .transaction("accounts")
      .objectStore("accounts")
      .get("main");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function save(book, revision) {
  validate(book);
  const conn = await connect();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction("accounts", "readwrite"),
      store = tx.objectStore("accounts");
    const req = store.get("main");
    req.onsuccess = () => {
      if ((req.result?.revision ?? 0) !== revision) {
        tx.abort();
        return;
      }
      store.put({ book, revision: revision + 1 }, "main");
    };
    tx.oncomplete = () => resolve(revision + 1);
    tx.onabort = () =>
      reject(tx.error ?? Error("工作区已在其他页面更新，请刷新后重试"));
  });
}
