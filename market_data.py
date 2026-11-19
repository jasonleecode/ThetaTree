"""Shared market snapshots, periodic upstream refresh and failure recovery."""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field


@dataclass
class Entry:
    data: dict = field(default_factory=dict)
    error: str = ''
    due: float = 0
    used: float = 0
    busy: bool = False
    failures: int = 0


class MarketData:
    def __init__(self, fetch, subscriptions, workers=6):
        self.fetch = fetch
        self.subscriptions = subscriptions
        self.entries = {}
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(workers)
        self.stop = threading.Event()
        self.workers = workers
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def read(self, key):
        with self.lock:
            if key not in self.entries and len(self.entries) >= 512:
                return {'error': '行情缓存繁忙，请稍后重试', 'status': 'error'}
            entry = self.entries.setdefault(key, Entry())
            entry.used = time.monotonic()
            status = ('stale' if entry.data else 'error') if entry.error else ('ok' if entry.data else 'loading')
            return {**entry.data, 'status': status, 'error': entry.error}

    def warnings(self):
        with self.lock:
            return sorted({symbol for (symbol, _), entry in self.entries.items() if entry.error})

    def refresh(self, key):
        data = None
        try:
            data = self.fetch(*key)
            error = ''
        except Exception as exc:
            code = getattr(exc, 'code', None)
            error = f'数据源返回 HTTP {code}' if code else '数据源连接失败或返回无效数据'
        with self.lock:
            entry = self.entries[key]
            if data is not None:
                entry.data = data
            entry.error = error
            entry.failures = min(5, entry.failures + 1) if error else 0
            interval = 15 if key[1] in ('spot', '1d', '1mo') else 300
            entry.due = time.monotonic() + (min(300, 10 * 2**entry.failures) if error else interval)
            entry.busy = False

    def run(self):
        pinned = set()
        next_scan = 0
        while not self.stop.is_set():
            now = time.monotonic()
            if now >= next_scan:
                try:
                    pinned = set(self.subscriptions())
                except Exception as exc:
                    print('无法读取行情订阅:', exc, flush=True)
                next_scan = now + 15
            with self.lock:
                for key in pinned:
                    self.entries.setdefault(key, Entry())
                for key, entry in list(self.entries.items()):
                    if key not in pinned and not entry.busy and now-entry.used > 120:
                        del self.entries[key]
                capacity = self.workers - sum(entry.busy for entry in self.entries.values())
                due = sorted((e.due, key) for key, e in self.entries.items() if not e.busy and e.due <= now)
                for _, key in due[:capacity]:
                    self.entries[key].busy = True
                    self.pool.submit(self.refresh, key)
            self.stop.wait(0.4)

    def close(self):
        self.stop.set()
        self.thread.join()
        self.pool.shutdown(wait=True)
