import { esc, panel } from "./components.js";

const MARKET_GROUPS = [
  {
    id: "indices",
    title: "股票指数",
    note: "美股 / 港股 / A股 · 指数点位",
    items: [
      ["NASDAQ:IXIC", "纳斯达克综合指数", "美股 · 点", "ixic"],
      ["NASDAQ:NDX", "纳斯达克100指数", "美股 · 点", "ndx"],
      ["SP:SPX", "标普500指数", "美股 · 点", "spx"],
      ["HSI:HSI", "恒生指数", "港股 · 点", "hsi"],
      ["SSE:000300", "沪深300指数", "A股 · 点", "csi300"],
    ],
  },
  {
    id: "commodities",
    title: "大宗商品",
    note: "黄金现货与原油期货，报价口径不同",
    items: [
      ["OANDA:XAUUSD", "黄金现货", "美元 / 盎司", "gold"],
      ["NYMEX:CL1!", "WTI 原油期货", "美元 / 桶", "wti"],
      ["ICEEUR:BRN1!", "布伦特原油期货", "美元 / 桶", "brent"],
    ],
  },
  {
    id: "fx",
    title: "外汇汇率",
    note: "每 1 美元可兑换的在岸人民币或日元数量",
    items: [
      ["FX_IDC:USDCNY", "美元兑人民币", "人民币 / 美元", "usdcny"],
      ["FX:USDJPY", "美元兑日元", "日元 / 美元", "usdjpy"],
    ],
  },
  {
    id: "volatility",
    title: "市场波动",
    note: "VIX 反映标普500未来30天的预期年化波动率",
    items: [["CBOE:VIX", "VIX 标普500波动率指数", "年化波动率 · %", "vix"]],
  },
];
const STOCK_WATCH_KEY = "thetatree.stock-watch.v1";
const STOCK_EXCHANGES = ["NASDAQ", "NYSE", "AMEX", "HKEX", "SSE", "SZSE"];
const DEFAULT_STOCKS = [
  { symbol: "NASDAQ:AAPL", name: "苹果" },
  { symbol: "NASDAQ:MSFT", name: "微软" },
  { symbol: "NASDAQ:NVDA", name: "英伟达" },
  { symbol: "NASDAQ:TQQQ", name: "TQQQ" },
];
function validWatchStock(item) {
  return (
    item &&
    typeof item.symbol === "string" &&
    /^(NASDAQ|NYSE|AMEX|HKEX|SSE|SZSE):[A-Z0-9][A-Z0-9.-]{0,19}$/.test(
      item.symbol,
    ) &&
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    item.name.length <= 60
  );
}
function loadStockWatch() {
  try {
    const raw = localStorage.getItem(STOCK_WATCH_KEY);
    if (!raw)
      return {
        items: DEFAULT_STOCKS,
        selected: DEFAULT_STOCKS[0].symbol,
        notice: "",
      };
    const data = JSON.parse(raw);
    if (
      data.version !== 1 ||
      !Array.isArray(data.items) ||
      data.items.length > 30 ||
      !data.items.every(validWatchStock) ||
      new Set(data.items.map((i) => i.symbol)).size !== data.items.length
    )
      throw new Error("Invalid watchlist");
    return {
      items: data.items,
      selected: data.items.some((i) => i.symbol === data.selected)
        ? data.selected
        : data.items[0]?.symbol || "",
      notice: "",
    };
  } catch {
    return {
      items: DEFAULT_STOCKS,
      selected: DEFAULT_STOCKS[0].symbol,
      notice: "无法恢复观察列表，已载入默认股票。",
    };
  }
}

const periods = {
  "1d": "日内",
  "1mo": "1个月",
  "3mo": "3个月",
  "1y": "1年",
  "5y": "5年",
  max: "全部",
};
const chartLink = (symbol) =>
  '<a target="_blank" rel="noopener noreferrer" href="https://www.tradingview.com/symbols/' +
  encodeURIComponent(symbol.replace(":", "-")) +
  '/">TradingView ↗</a>';
const stockPath = (code, period) => "/api/stock/" + code + "/" + period;
async function request(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  if (!response.ok)
    throw Error(
      (await response.json().catch(() => ({}))).error || "本地行情服务不可用",
    );
  return response.json();
}
let writeQueue = Promise.resolve();
function writeList(items, selected, revision) {
  const task = writeQueue.then(() =>
    request("/api/watchlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, selected, revision }),
    }),
  );
  writeQueue = task.catch(() => {});
  return task;
}
function plot(canvas, quote, name, period, compact) {
  const format = new Intl.DateTimeFormat("zh-CN", {
    timeZone: quote.timezone || "UTC",
    ...(period === "1d"
      ? { hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "numeric", day: "numeric" }),
  });
  const style = getComputedStyle(canvas),
    color = style.getPropertyValue("--green"),
    muted = style.getPropertyValue("--muted");
  const labels = quote.history.map(([t]) => format.format(t * 1000)),
    data = quote.history.map(([, p]) => p);
  const existing = Chart.getChart(canvas);
  if (existing) {
    existing.data.labels = labels;
    existing.data.datasets[0].data = data;
    existing.update("none");
    return;
  }
  new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: name,
          data,
          borderColor: color,
          backgroundColor: "rgba(72,190,145,.10)",
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { display: !compact, ticks: { maxTicksLimit: 5, color: muted } },
        y: {
          display: !compact,
          position: "right",
          ticks: { maxTicksLimit: 5, color: muted },
        },
      },
    },
  });
}
export function mountMarketWatch(root) {
  let activeGroup = MARKET_GROUPS[0],
    period = "1mo",
    list = null,
    saving = false,
    disposed = false,
    timer,
    controller;
  const cache = new Map();
  const $ = (selector) => root.querySelector(selector);
  const buttons = (entries, active, attr) =>
    entries
      .map(
        ([key, label]) =>
          '<button type="button" data-' +
          attr +
          '="' +
          key +
          '" aria-pressed="' +
          (key === active) +
          '" class="' +
          (key === active ? "selected" : "") +
          '">' +
          label +
          "</button>",
      )
      .join("");
  root.innerHTML =
    panel(
      "全球市场",
      '<div class="actions" id="market-tabs"></div><p class="note" id="market-note"></p><div class="market-grid" id="market-cards"></div><small role="status" id="market-status"></small>',
      "<button data-market-refresh>刷新行情</button>",
    ) +
    panel(
      "股票观察列表",
      '<p role="status" id="market-storage"></p><fieldset id="market-inputs" disabled><form class="market-form"><label>交易所<select name="exchange">' +
        STOCK_EXCHANGES.map((ex) => "<option>" + ex + "</option>").join("") +
        '</select></label><label>股票代码<input name="ticker" required maxlength="20" placeholder="AAPL"></label><label>显示名称（可选）<input name="label" maxlength="60" placeholder="苹果"></label><button class="primary">添加自选股</button></form><div id="market-stocks"></div></fieldset>',
      "<button data-market-read>重读列表</button>",
    );
  function destroyPlots(scope) {
    scope
      .querySelectorAll("canvas")
      .forEach((c) => Chart.getChart(c)?.destroy());
  }
  function quoteBox(path, name, period, compact, unit, digits) {
    return (
      '<div data-quote="' +
      esc(path) +
      '" data-name="' +
      esc(name) +
      '" data-range="' +
      period +
      '" data-digits="' +
      digits +
      '"><strong class="num market-price">加载中…</strong><small class="market-unit">' +
      esc(unit) +
      '</small><small class="market-time"></small><small class="market-error warn"></small>' +
      (compact === null
        ? ""
        : '<div hidden class="' +
          (compact ? "market-mini" : "chartbox") +
          '"><canvas role="img" aria-label="' +
          esc(name) +
          '走势"></canvas></div>') +
      "</div>"
    );
  }
  function groupView() {
    $("#market-tabs").innerHTML = buttons(
      MARKET_GROUPS.map((g) => [g.id, g.title + " · " + g.items.length]),
      activeGroup.id,
      "market-group",
    );
    $("#market-note").textContent = activeGroup.note;
    destroyPlots($("#market-cards"));
    $("#market-cards").innerHTML = activeGroup.items
      .map(
        ([code, name, unit, id]) =>
          '<article class="card"><div class="panelhead"><h3>' +
          name +
          "</h3>" +
          chartLink(code) +
          "</div>" +
          quoteBox(
            "/api/quote/" + id,
            name,
            "1mo",
            true,
            unit + " · " + (id === "gold" ? "Gold API" : "Yahoo Finance"),
            id === "usdcny" ? 4 : id === "usdjpy" ? 3 : 2,
          ) +
          "</article>",
      )
      .join("");
  }
  function stocksView() {
    destroyPlots($("#market-stocks"));
    const current = list.items.find((x) => x.symbol === list.selected);
    $("#market-stocks").innerHTML = list.items.length
      ? '<div class="market-split"><div>' +
        list.items
          .map(
            ({ symbol, name }) =>
              '<div class="market-stock"><div><button data-market-select="' +
              esc(symbol) +
              '" aria-pressed="' +
              (symbol === list.selected) +
              '">' +
              esc(name) +
              " · " +
              esc(symbol) +
              "</button>" +
              quoteBox(stockPath(symbol, "1mo"), name, "1mo", null, "", 2) +
              '</div><button aria-label="移除 ' +
              esc(name) +
              '" data-market-remove="' +
              esc(symbol) +
              '">移除</button></div>',
          )
          .join("") +
        "</div><div>" +
        (current
          ? '<div class="panelhead"><h3>' +
            esc(current.name) +
            " · " +
            esc(current.symbol) +
            "</h3>" +
            chartLink(current.symbol) +
            '</div><div class="actions">' +
            buttons(Object.entries(periods), period, "market-period") +
            "</div>" +
            quoteBox(
              stockPath(current.symbol, period),
              current.name,
              period,
              false,
              "Yahoo Finance",
              2,
            )
          : "") +
        "</div></div>"
      : '<p class="empty">观察列表为空，可添加第一只股票。</p>';
  }
  function paint(box, quote, error) {
    const got = Number.isFinite(quote?.price);
    box.querySelector(".market-price").textContent = got
      ? quote.price.toLocaleString("zh-CN", {
          minimumFractionDigits: +box.dataset.digits,
          maximumFractionDigits: +box.dataset.digits,
        }) +
        " " +
        (quote.currency || "")
      : error
        ? "—"
        : "加载中…";
    box.querySelector(".market-time").textContent = got
      ? new Date(quote.time * 1000).toLocaleString("zh-CN")
      : "";
    box.querySelector(".market-error").textContent = error
      ? (got ? "最近报价 · " : "") + error
      : "";
    const canvas = box.querySelector("canvas");
    if (canvas && quote?.history?.length >= 2) {
      canvas.parentElement.hidden = false;
      plot(
        canvas,
        quote,
        box.dataset.name,
        box.dataset.range,
        canvas.parentElement.classList.contains("market-mini"),
      );
    }
  }
  function refresh() {
    clearTimeout(timer);
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    async function poll() {
      const nodes = [...root.querySelectorAll("[data-quote]")];
      let loading = false;
      await Promise.all(
        [
          ...new Set(nodes.map((el) => el.dataset.quote)),
          "/api/market-status",
        ].map(async (path) => {
          let value,
            error = "";
          try {
            value = await request(path, { signal });
          } catch {
            error = "无法连接本地行情服务。请使用 python3 server.py 启动。";
          }
          if (signal.aborted) return;
          if (path === "/api/market-status") {
            $("#market-status").textContent =
              error ||
              (value.symbols?.length
                ? "行情更新异常：" +
                  value.symbols.join("、") +
                  "。后台正在重试。"
                : "报价时间以数据源为准，休市时显示最近报价。");
            return;
          }
          if (Number.isFinite(value?.price)) cache.set(path, value);
          loading ||= value?.status === "loading";
          nodes
            .filter((el) => el.dataset.quote === path)
            .forEach((el) =>
              paint(el, cache.get(path), error || value?.error || ""),
            );
        }),
      );
      if (!signal.aborted) timer = setTimeout(poll, loading ? 1200 : 5000);
    }
    poll();
  }
  function lock(value) {
    saving = value;
    $("#market-inputs").disabled = value || !list;
    $("[data-market-read]").disabled = value;
  }
  async function readList() {
    lock(true);
    $("#market-storage").textContent = "正在读取 SQLite…";
    try {
      await writeQueue;
      let data = await request("/api/watchlist");
      if (!data.initialized && !disposed) {
        const legacy = loadStockWatch();
        try {
          data = await writeList(legacy.items, legacy.selected, data.revision);
        } catch (e) {
          data = await request("/api/watchlist");
          if (!data.initialized) throw e;
        }
      }
      if (disposed) return;
      list = data;
      stocksView();
      refresh();
      $("#market-storage").textContent = "已同步至 SQLite";
    } catch (e) {
      if (!disposed)
        $("#market-storage").textContent =
          "读取失败，请使用 python3 server.py 启动服务后重读列表。";
    } finally {
      if (!disposed) lock(false);
    }
  }
  async function changeList(items, selected) {
    if (saving || !list) return false;
    lock(true);
    try {
      const updated = await writeList(items, selected, list.revision);
      if (disposed) return false;
      list = updated;
      stocksView();
      refresh();
      $("#market-storage").textContent = "已同步至 SQLite";
      return true;
    } catch (e) {
      if (!disposed)
        $("#market-storage").textContent =
          "保存失败：" + e.message + "。请重读列表后重试。";
      return false;
    } finally {
      if (!disposed) lock(false);
    }
  }
  root.onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const d = btn.dataset;
    if (d.marketGroup) {
      activeGroup = MARKET_GROUPS.find((g) => g.id === d.marketGroup);
      groupView();
      refresh();
    }
    if (d.marketPeriod) {
      period = d.marketPeriod;
      stocksView();
      refresh();
    }
    if ("marketRefresh" in d) refresh();
    if ("marketRead" in d) readList();
    if (d.marketSelect && d.marketSelect !== list.selected)
      changeList(list.items, d.marketSelect);
    if (d.marketRemove) {
      const items = list.items.filter((i) => i.symbol !== d.marketRemove);
      changeList(
        items,
        list.selected === d.marketRemove
          ? items[0]?.symbol || ""
          : list.selected,
      );
    }
  };
  root.onsubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!list || saving) return;
    const form = e.target,
      f = new FormData(form),
      code = f.get("ticker").trim().toUpperCase(),
      symbol = f.get("exchange") + ":" + code;
    const item = { symbol, name: f.get("label").trim() || code };
    if (
      !validWatchStock(item) ||
      list.items.some((i) => i.symbol === symbol) ||
      list.items.length >= 30
    ) {
      $("#market-storage").textContent =
        "请检查代码，列表最多 30 项且代码不能重复。";
      return;
    }
    if (await changeList([...list.items, item], symbol)) form.reset();
  };
  groupView();
  refresh();
  readList();
  return () => {
    disposed = true;
    controller?.abort();
    clearTimeout(timer);
    destroyPlots(root);
  };
}
