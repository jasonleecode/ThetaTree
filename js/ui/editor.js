import { field, select, esc, cash, line, number } from "./components.js";
import { names } from "../core/greeks.js";
import { model, daysBetween, addDays, mark, units } from "../core/portfolio.js";
import { impliedVolatility } from "../core/pricing.js";
export function editor(b, symbol, p) {
  const today = b.asOf,
    type = p?.type ?? "stock";
  return (
    "<h2>" +
    (p ? "编辑持仓" : "Add position") +
    '</h2><form id="positionForm" data-id="' +
    (p?.id ?? "") +
    '"><div class="formgrid">' +
    field(
      "Symbol",
      "symbol",
      p?.symbol ?? symbol,
      "text",
      'required maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]*"',
    ) +
    select(
      "Instrument",
      "type",
      [
        ["stock", "Stock"],
        ["put", "Put"],
        ["call", "Call"],
      ],
      type,
    ) +
    select(
      "Direction",
      "side",
      [
        ["1", "Long · 买入"],
        ["-1", "Short · 卖出"],
      ],
      p?.quantity < 0 ? -1 : 1,
    ) +
    field(
      "Quantity · 股或张",
      "qty",
      Math.abs(p?.quantity ?? 1),
      "number",
      'required min="1"',
    ) +
    field(
      "Underlying price · USD",
      "spot",
      b.quotes[symbol],
      "number",
      'required min=".000001"',
    ) +
    field(
      "Entry price · USD",
      "entry",
      p?.entry ?? 0,
      "number",
      'required min="0"',
    ) +
    field(
      "Commission · USD",
      "commission",
      p?.commission ?? 0,
      "number",
      'required min="0"',
    ) +
    field(
      "Open date",
      "open",
      p?.open ?? today,
      "date",
      'required max="' + today + '"',
    ) +
    '<div class="wide formgrid" id="optFields">' +
    field(
      "Contract multiplier",
      "multiplier",
      type === "stock" ? 100 : p.multiplier,
      "number",
      'required min="1"',
    ) +
    field(
      "Strike · USD",
      "strike",
      p?.strike ?? b.quotes[symbol],
      "number",
      'required min=".000001"',
    ) +
    field(
      "Expiration date",
      "expiration",
      p?.expiration ?? addDays(today, 365),
      "date",
      "required",
    ) +
    field("IV · %", "iv", (p?.iv ?? 0.55) * 100, "number", 'required min="0"') +
    field(
      "Market price · 留空采用模型",
      "market",
      p?.market,
      "number",
      'min="0"',
    ) +
    '<details><summary>开仓参考值（用于相对变化提醒）</summary><div class="formgrid">' +
    field(
      "开仓标的价格",
      "entrySpot",
      p?.entrySpot,
      "number",
      'min=".000001"',
    ) +
    field(
      "开仓 IV · %",
      "entryIv",
      p?.entryIv != null ? p.entryIv * 100 : null,
      "number",
      'min="0"',
    ) +
    '</div></details><details><summary>手动 Greeks · 每股 Long 合约口径</summary><div class="formgrid">' +
    names.map((k) => field(k, k, p?.greeks?.[k])).join("") +
    '</div></details><div id="estimate" class="wide note"></div></div></div><p class="note">' +
    (p
      ? "修正期初或已录入的持仓快照。参考价适用于同一标的全部持仓。"
      : "选择录入方式。期初快照不移动现金，开仓交易按输入成本扣款或收款。") +
    "</p>" +
    (!p
      ? select(
          "录入方式",
          "record",
          [
            ["snapshot", "期初持仓快照"],
            ["trade", "开仓交易（估值日）"],
          ],
          "snapshot",
        )
      : "") +
    '<div class="actions">' +
    (p
      ? '<button type="button" data-close="' +
        p.id +
        '">按当前估值平仓</button>'
      : "") +
    '<button type="button" data-dismiss>取消</button><button class="primary">保存持仓</button></div></form>'
  );
}
export function readPosition(form, b) {
  const f = new FormData(form),
    type = f.get("type"),
    num = (k) => Number(f.get(k));
  const p = {
    id: form.dataset.id || crypto.randomUUID(),
    type,
    symbol: f.get("symbol").trim().toUpperCase(),
    quantity: num("qty") * num("side"),
    entry: num("entry"),
    commission: num("commission"),
    open: f.get("open"),
    multiplier: 1,
  };
  if (type !== "stock")
    Object.assign(p, {
      multiplier: num("multiplier"),
      strike: num("strike"),
      iv: num("iv") / 100,
      market: f.get("market") === "" ? null : num("market"),
      expiration: f.get("expiration"),
      entrySpot: f.get("entrySpot") ? num("entrySpot") : null,
      entryIv: f.get("entryIv") ? num("entryIv") / 100 : null,
      greeks: Object.fromEntries(
        names.filter((k) => f.get(k) !== "").map((k) => [k, num(k)]),
      ),
    });
  return { p, spot: num("spot"), trade: f.get("record") === "trade" };
}
export function updateEstimate(form, b) {
  const opts = form.querySelector("#optFields"),
    stock = form.elements.type.value === "stock";
  opts.hidden = stock;
  opts.style.display = stock ? "none" : "grid";
  for (const input of opts.querySelectorAll("input")) input.disabled = stock;
  if (stock) return;
  try {
    const { p, spot } = readPosition(form, b),
      g = model(p, b, spot);
    const inferred =
      p.market === null
        ? null
        : impliedVolatility(
            p.type,
            spot,
            p.strike,
            daysBetween(b.asOf, p.expiration) / 365,
            p.market,
            b.rate,
            b.dividend,
          );
    opts.querySelector("#estimate").textContent =
      "欧式 BSM ≈ " +
      cash(g.price) +
      " · 市价反推 IV " +
      (inferred === null ? "—" : number(inferred * 100) + "%") +
      " · " +
      names.map((k) => k + " " + number(g[k])).join(" / ");
  } catch {
    opts.querySelector("#estimate").textContent = "输入完整合约参数以估值。";
  }
}
