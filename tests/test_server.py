import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


class WatchlistAPITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / 'test.sqlite3'
        server.initialize(self.database)
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.http.database = self.database
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:' + str(self.http.server_port)

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, method='GET', payload=None, path='/api/watchlist', headers=None):
        req = Request(self.base + path, method=method,
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers=headers or {'Content-Type': 'application/json'})
        try:
            response = urlopen(req)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def payload(self, revision=0):
        return {'revision': revision, 'selected': 'NASDAQ:AAPL', 'items': [
            {'symbol': 'NASDAQ:AAPL', 'name': '苹果'},
            {'symbol': 'HKEX:700', 'name': '腾讯'}]}

    def test_roundtrip_order_selection_and_restart(self):
        self.assertFalse(self.request()[1]['initialized'])
        payload = self.payload()
        payload['items'].reverse()
        status, saved = self.request('PUT', payload)
        self.assertEqual(status, 200)
        self.assertEqual(saved['revision'], 1)
        server.initialize(self.database)
        restored = self.request()[1]
        self.assertEqual(restored, saved)
        self.assertEqual(restored['items'], payload['items'])
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM watchlist_stocks').fetchone()[0], 2)

    def test_empty_list_remains_initialized(self):
        self.request('PUT', self.payload())
        status, saved = self.request('PUT', {'revision': 1, 'items': [], 'selected': ''})
        self.assertEqual(status, 200)
        self.assertEqual(saved['items'], [])
        self.assertTrue(saved['initialized'])

    def test_stale_revision_does_not_overwrite(self):
        self.request('PUT', self.payload())
        self.assertEqual(self.request('PUT', self.payload())[0], 409)
        self.assertEqual(self.request()[1]['revision'], 1)

    def test_invalid_payloads_do_not_modify_database(self):
        for payload in [None, {}, {'items': [], 'selected': '', 'revision': True},
                        {**self.payload(), 'selected': 'NYSE:OTHER'},
                        {**self.payload(), 'items': self.payload()['items'] * 2},
                        {**self.payload(), 'items': [{'symbol': "NASDAQ:AAPL'; DROP TABLE x", 'name': 'x'}]}]:
            self.assertEqual(self.request('PUT', payload)[0], 400)
        self.assertFalse(self.request()[1]['initialized'])

    def test_options_workspace_roundtrip_and_conflict(self):
        path = '/api/workspace'
        self.assertEqual(self.request(path=path), (200, {'revision': 0, 'store': None}))
        assets = []
        for symbol in ['SPCX', 'TQQQ', 'CUSTOM']:
            config = dict(symbol=symbol, name=symbol, s=100, min=65, max=135, iv=45, gap=5)
            leg = dict(id=1, type='put', strike=95, qty=-2, entry=2.35, tag='custom')
            workspace = dict(scenario=dict(s=97.43, iv=52, days=21, r=3.75),
                             calc=dict(type='call', strike=105),
                             book=dict(legs=[leg], realized=-25, mode='custom', log=[]))
            assets.append(dict(config=config, workspace=workspace))
        store = dict(version=1, active='CUSTOM', assets=assets)
        payload = dict(revision=0, store=store)
        self.assertEqual(self.request('PUT', payload, path), (200, {'revision': 1}))
        self.assertEqual(self.request('PUT', payload, path)[0], 409)
        server.initialize(self.database)
        self.assertEqual(self.request(path=path), (200, dict(revision=1, store=store)))
        assets[0]['workspace']['book']['legs'][0]['qty'] = 0
        self.assertEqual(self.request('PUT', dict(revision=1, store=store), path)[0], 400)
        restored = self.request(path=path)[1]
        self.assertEqual(restored['revision'], 1)
        self.assertEqual(restored['store']['assets'][0]['workspace']['book']['legs'][0]['qty'], -2)
        self.assertFalse(self.request()[1]['initialized'])

    def test_protect_files_and_cross_origin_writes(self):
        for path in ['/data/thetatree.sqlite3', '/.git/config', '/server.py', '/not-found']:
            self.assertEqual(self.request(path=path)[0], 404)
        self.assertEqual(self.request('PUT', self.payload(), headers={
            'Content-Type': 'application/json', 'Origin': 'https://example.com'})[0], 403)


if __name__ == '__main__':
    unittest.main()
