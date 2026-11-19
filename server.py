#!/usr/bin/env python3
"""Local ThetaTree web server and SQLite watchlist storage (Python stdlib only)."""
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
    'ixic': '^IXIC', 'ndx': '^NDX', 'spx': '^GSPC',
    'wti': 'CL=F', 'brent': 'BZ=F', 'vix': '^VIX', 'usdcny': 'CNY=X', 'usdjpy': 'JPY=X',
}


def fetch_quote(symbol):
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + quote(symbol, safe='') + '?interval=1d&range=1mo'
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
    return dict(price=price, time=as_of, history=history,
                timezone=meta.get('exchangeTimezoneName') or 'UTC')


def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.execute('PRAGMA foreign_keys = ON')
    return db


def initialize(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as db:
        db.executescript('''
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
        if self.path == '/api/watchlist':
            try:
                with connect(self.server.database) as db:
                    self.reply(HTTPStatus.OK, snapshot(db))
            except sqlite3.Error:
                self.reply(HTTPStatus.INTERNAL_SERVER_ERROR, {'error': '无法读取数据库'})
        elif self.path.startswith('/api/quote/'):
            symbol = MARKET_SYMBOLS.get(self.path[len('/api/quote/'):])
            if symbol is None:
                self.reply(HTTPStatus.NOT_FOUND, {'error': '未知标的'})
                return
            try:
                result = fetch_quote(symbol)
            except (OSError, ValueError, TypeError, IndexError, KeyError):
                self.reply(HTTPStatus.BAD_GATEWAY, {'error': '报价源暂时不可用'})
            else:
                self.reply(HTTPStatus.OK, result)
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
        if self.path != '/api/watchlist':
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
            if not 0 < length <= 16384:
                raise ValueError('请求大小无效')
            payload = json.loads(self.rfile.read(length))
            items, selected, revision = validate(payload)
        except (ValueError, UnicodeDecodeError):
            self.reply(HTTPStatus.BAD_REQUEST, {'error': '无效的观察列表数据'})
            return
        try:
            with connect(self.server.database) as db:
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
    print(f'ThetaTree: http://127.0.0.1:{args.port}  SQLite: {args.db}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
