import threading
import time
import unittest

from market_data import MarketData


class MarketDataTest(unittest.TestCase):
    def test_shared_snapshot_survives_outage_and_recovers(self):
        key = ('TEST', 'spot')
        attempts = []
        started, release = threading.Event(), threading.Event()

        def fetch(*_):
            attempts.append(True)
            if len(attempts) == 1:
                started.set()
                release.wait(2)
            if len(attempts) == 2:
                raise OSError('offline')
            return dict(price=len(attempts), time=100)

        cache = MarketData(fetch, lambda: [key])
        try:
            self.assertTrue(started.wait(2))
            self.assertEqual(cache.read(key)['status'], 'loading')
            release.set()
            deadline = time.monotonic() + 2
            while cache.read(key)['status'] != 'ok' and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertEqual(cache.read(key)['price'], 1)
            self.assertEqual(len(attempts), 1)
            cache.refresh(key)
            self.assertEqual(cache.read(key)['status'], 'stale')
            self.assertEqual(cache.read(key)['price'], 1)
            self.assertEqual(cache.warnings(), ['TEST'])
            cache.refresh(key)
            self.assertEqual(cache.read(key)['price'], 3)
            self.assertEqual(cache.warnings(), [])
        finally:
            release.set()
            cache.close()
