#!/usr/bin/env python3
"""Local ThetaTree web server and SQLite watchlist storage (Python stdlib only)."""
from datetime import datetime
from market_data import MarketData
import argparse
import json
import math
import re
import sqlite3
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
SYMBOL = re.compile(r'^(NASDAQ|NYSE|AMEX|HKEX|SSE|SZSE):[A-Z0-9][A-Z0-9.-]{0,19}$')


MARKET_SYMBOLS = {
    'gold': 'XAU/USD', 'hsi': '^HSI', 'csi300': '000300.SS', 'ixic': '^IXIC', 'ndx': '^NDX', 'spx': '^GSPC',
    'wti': 'CL=F', 'brent': 'BZ=F', 'vix': '^VIX', 'usdcny': 'CNY=X', 'usdjpy': 'JPY=X',
}


INTERVALS = {'1d': '5m', '1mo': '1d', '3mo': '1d', '1y': '1d', '5y': '1wk', 'max': '1mo'}


def stock_symbol(code):
    exchange, ticker = code.split(':')
    if exchange == 'HKEX':
        return ticker.zfill(4) + '.HK'
    if exchange in ('SSE', 'SZSE'):
        return ticker.zfill(6) + ('.SS' if exchange == 'SSE' else '.SZ')
    return ticker.replace('.', '-')


def subscriptions(path):
    keys = {(symbol, '1mo') for symbol in MARKET_SYMBOLS.values()}
    with connect(path) as db:
        for (code,) in db.execute('SELECT symbol FROM watchlist_stocks'):
            keys.add((stock_symbol(code), '1mo'))
        document, = db.execute('SELECT document FROM options_workspace WHERE id=1').fetchone()
        if document:
            for asset in json.loads(document)['assets']:
                symbol = asset['config']['symbol']
                if symbol != 'SPCX':
                    keys.add((option_symbol(symbol), '1mo'))
    return keys


def option_symbol(symbol):
    return symbol.replace('.', '-') if re.fullmatch(r'[A-Z]+[.][AB]', symbol) else symbol


def fetch_quote(symbol, period):
    if symbol == 'XAU/USD' and period == '1mo':
        with urlopen('https://api.gold-api.com/price/XAU', timeout=10) as response:
            data = json.load(response)
        if data['symbol'] != 'XAU' or data['currency'] != 'USD' or not math.isfinite(data['price']) or data['price'] <= 0:
            raise ValueError('无效黄金现货价格')
        timestamp = datetime.fromisoformat(data['updatedAt'].replace('Z', '+00:00')).timestamp()
        return dict(price=data['price'], time=int(timestamp), source='Gold API', currency='USD')
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + quote(symbol, safe='')
    url += f'?interval={INTERVALS[period]}&range={period}'
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urlopen(request, timeout=10) as response:
        result = json.load(response)['chart']['result'][0]
    meta = result['meta']
    price, as_of = meta['regularMarketPrice'], meta['regularMarketTime']
    if meta['symbol'] != symbol or not math.isfinite(price) or type(as_of) is not int or as_of <= 0:
        raise ValueError('无效报价')
    quotes = result.get('indicators', {}).get('quote') or [{}]
    closes = quotes[0].get('close') or []
    history = [
        [timestamp, close] for timestamp, close in zip(result.get('timestamp') or [], closes)
        if type(timestamp) is int and isinstance(close, (int, float)) and math.isfinite(close)
    ]
    if len(history) < 1:
        raise ValueError('历史行情缺失')
    return dict(price=price, time=as_of, history=history, instrument=meta.get('instrumentType'), currency=meta.get('currency'),
                timezone=meta.get('exchangeTimezoneName') or 'UTC')


def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.execute('PRAGMA foreign_keys = ON')
    return db


def initialize(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS options_workspace (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                revision INTEGER NOT NULL DEFAULT 0,
                document TEXT
            );
            INSERT OR IGNORE INTO options_workspace(id) VALUES (1);
            CREATE TABLE IF NOT EXISTS watchlist_stocks (
                symbol TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                position INTEGER NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS watchlist_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                selected_symbol TEXT REFERENCES watchlist_stocks(symbol),
                revision INTEGER NOT NULL DEFAULT 0,
                initialized INTEGER NOT NULL DEFAULT 0
            );
            INSERT OR IGNORE INTO watchlist_state(id) VALUES (1);
        ''')


def snapshot(db):
    selected, revision, initialized = db.execute(
        'SELECT selected_symbol, revision, initialized FROM watchlist_state WHERE id=1'
    ).fetchone()
    items = [{'symbol': s, 'name': n} for s, n in db.execute(
        'SELECT symbol, name FROM watchlist_stocks ORDER BY position')]
    return dict(items=items, selected=selected or '', revision=revision, initialized=bool(initialized))


def validate(payload):
    if not isinstance(payload, dict):
        raise ValueError('请求必须为对象')
    items, selected, revision = payload.get('items'), payload.get('selected'), payload.get('revision')
    if not isinstance(items, list) or len(items) > 30 or type(revision) is not int or revision < 0:
        raise ValueError('列表最多30项，且需要有效版本号')
    symbols = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('无效股票')
        symbol, name = item.get('symbol'), item.get('name')
        if (not isinstance(symbol, str) or not SYMBOL.fullmatch(symbol) or symbol in symbols
                or not isinstance(name, str) or not name.strip() or len(name) > 60):
            raise ValueError('股票代码或名称无效，或存在重复代码')
        symbols.add(symbol)
    if not isinstance(selected, str) or (selected not in symbols if items else selected != ''):
        raise ValueError('选中股票必须在列表中')
    return items, selected, revision


def valid_workspace(store):
    def number(value, low=-math.inf, high=math.inf):
        return type(value) in (int, float) and low <= value <= high and math.isfinite(value)

    if not isinstance(store, dict) or store.get('version') != 1:
        return False
    assets = store.get('assets')
    if not isinstance(assets, list) or not 1 <= len(assets) <= 50:
        return False
    symbols = set()
    try:
        for item in assets:
            a, w = item['config'], item['workspace']
            symbol = a['symbol']
            if (not re.fullmatch(r'[A-Z0-9][A-Z0-9._-]{0,19}', symbol) or symbol in symbols
                    or not isinstance(a['name'], str) or not a['name'].strip() or len(a['name']) > 60
                    or not number(a['s'], 1, 10000) or not number(a['iv'], 15, 100)
                    or not number(a['gap'], .01, (a['s'] - .01) / 2)
                    or not number(a['min'], .01, a['s']) or not number(a['max'], a['s'], 20000)
                    or a['min'] >= a['max']):
                return False
            symbols.add(symbol)
            sc, b, c = w['scenario'], w['book'], w['calc']
            if (not number(sc['s'], a['min'], a['max']) or not number(sc['iv'], 15, 100)
                    or type(sc['days']) is not int or not 1 <= sc['days'] <= 60
                    or not number(sc['r'], -5, 30) or c['type'] not in ('call', 'put')
                    or not number(c['strike'], .01, 10000) or not number(b['realized'])
                    or not isinstance(b['legs'], list) or not isinstance(b['log'], list) or len(b['log']) > 60):
                return False
            ids = set()
            for leg in b['legs']:
                if (leg['type'] not in ('call', 'put', 'stock') or type(leg['id']) is not int
                        or not 0 < leg['id'] < 2**53-1 or leg['id'] in ids or type(leg['qty']) is not int
                        or not 0 < abs(leg['qty']) < 2**53 or not number(leg['entry'], 0, 100000)
                        or not number(leg['strike'], 0 if leg['type'] == 'stock' else .01, 10000)
                        or not isinstance(leg['tag'], str)):
                    return False
                ids.add(leg['id'])
            for event in b['log']:
                if (not isinstance(event['message'], str) or len(event['message']) > 1000
                        or not all(number(event[key]) for key in ('id', 's', 'iv', 'days'))):
                    return False
        return {'SPCX', 'TQQQ'} <= symbols and store['active'] in symbols
    except (KeyError, TypeError, OverflowError):
        return False


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ('/api/watchlist', '/api/workspace'):
            try:
                with connect(self.server.database) as db:
                    if self.path == '/api/workspace':
                        rev, doc = db.execute('SELECT revision, document FROM options_workspace WHERE id=1').fetchone()
                        self.reply(HTTPStatus.OK, dict(revision=rev, store=json.loads(doc) if doc else None))
                    else:
                        self.reply(HTTPStatus.OK, snapshot(db))
            except sqlite3.Error:
                self.reply(HTTPStatus.INTERNAL_SERVER_ERROR, {'error': '无法读取数据库'})
        elif self.path == '/api/market-status':
            self.reply(HTTPStatus.OK, {'symbols': self.server.market.warnings()})
        elif self.path.startswith('/api/stock/'):
            parts = self.path.split('/')
            if len(parts) != 5 or not SYMBOL.fullmatch(parts[3]) or parts[4] not in INTERVALS:
                self.reply(HTTPStatus.BAD_REQUEST, {'error': '股票代码或区间无效'})
                return
            self.reply(HTTPStatus.OK, self.server.market.read((stock_symbol(parts[3]), parts[4])))
        elif self.path.startswith(('/api/quote/', '/api/spot/')):
            spot_only = self.path.startswith('/api/spot/')
            if spot_only:
                symbol = self.path[len('/api/spot/'):]
                if symbol == 'SPCX' or not re.fullmatch(r'[A-Z0-9][A-Z0-9._-]{0,19}', symbol):
                    self.reply(HTTPStatus.BAD_REQUEST, {'error': '此标的不支持市场报价'})
                    return
                symbol = option_symbol(symbol)
            else:
                symbol = MARKET_SYMBOLS.get(self.path[len('/api/quote/'):])
            if symbol is None:
                self.reply(HTTPStatus.NOT_FOUND, {'error': '未知标的'})
                return
            data = self.server.market.read((symbol, '1mo'))
            if spot_only and 'price' in data:
                if data.get('currency') != 'USD' or data.get('instrument') not in ('ETF', 'EQUITY') or data['price'] <= 0:
                    data = dict(status='error', error='期权模型仅支持美元股票和 ETF')
                else:
                    data = {key: data[key] for key in ('price', 'time', 'status', 'error')}
                    data['symbol'] = symbol
            self.reply(HTTPStatus.OK, data)
        elif self.path in ('/', '/index.html'):
            body = (ROOT / 'index.html').read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            # Never expose SQLite files, source files or repository metadata.
            self.reply(HTTPStatus.NOT_FOUND, {'error': '未找到资源'})

    def do_PUT(self):
        if self.path not in ('/api/watchlist', '/api/workspace'):
            self.reply(HTTPStatus.NOT_FOUND, {'error': '未找到接口'})
            return
        # JSON-only, same-origin writes prevent unrelated sites modifying local data.
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host', ''):
            self.reply(HTTPStatus.FORBIDDEN, {'error': '不允许跨站修改'})
            return
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.reply(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {'error': '需要 application/json'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            workspace = self.path == '/api/workspace'
            if not 0 < length <= (32*1024*1024 if workspace else 16384):
                raise ValueError('请求大小无效')
            payload = json.loads(self.rfile.read(length))
            if workspace:
                if (not isinstance(payload, dict) or type(payload.get('revision')) is not int
                        or not 0 <= payload['revision'] < 2**63-1 or not valid_workspace(payload.get('store'))):
                    raise ValueError('无效期权工作区')
                document = json.dumps(payload['store'], ensure_ascii=False, allow_nan=False)
                revision = payload['revision']
            else:
                items, selected, revision = validate(payload)
        except (ValueError, UnicodeDecodeError):
            self.reply(HTTPStatus.BAD_REQUEST, {'error': '无效的保存数据'})
            return
        try:
            with connect(self.server.database) as db:
                if workspace:
                    updated = db.execute('UPDATE options_workspace SET document=?, revision=revision+1 '
                                         'WHERE id=1 AND revision=?', (document, revision)).rowcount
                    db.commit()
                    if updated:
                        self.reply(HTTPStatus.OK, dict(revision=revision+1))
                    else:
                        self.reply(HTTPStatus.CONFLICT, {'error': '其他页面已更新期权工作区，请刷新后继续'})
                    return
                db.execute('BEGIN IMMEDIATE')
                if snapshot(db)['revision'] != revision:
                    self.reply(HTTPStatus.CONFLICT, {'error': '列表已在其他页面更新，请重新读取后再修改'})
                    return
                db.execute('UPDATE watchlist_state SET selected_symbol=NULL WHERE id=1')
                db.execute('DELETE FROM watchlist_stocks')
                db.executemany('INSERT INTO watchlist_stocks(symbol,name,position) VALUES(?,?,?)',
                               [(i['symbol'], i['name'].strip(), p) for p, i in enumerate(items)])
                db.execute('UPDATE watchlist_state SET selected_symbol=?, revision=revision+1, initialized=1 WHERE id=1',
                           (selected or None,))
                result = snapshot(db)
            self.reply(HTTPStatus.OK, result)
        except sqlite3.Error:
            self.reply(HTTPStatus.INTERNAL_SERVER_ERROR, {'error': '无法保存数据库'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--db', type=Path, default=ROOT / 'data' / 'thetatree.sqlite3')
    args = parser.parse_args()
    initialize(args.db)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.database = args.db
    server.market = MarketData(fetch_quote, lambda: subscriptions(args.db))
    print(f'ThetaTree: http://127.0.0.1:{args.port}  SQLite: {args.db}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.market.close()


if __name__ == '__main__':
    main()
