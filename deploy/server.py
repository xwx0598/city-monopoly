#!/usr/bin/env python3
"""Monopoly LAN server (drop-in replacement for `python -m http.server`).

Why: the stock http.server sends no Cache-Control headers, so browsers
heuristically cache index.html and keep serving a stale page after updates.
This server marks HTML as always-revalidate (no-cache) so every refresh
picks up the latest build; other static files also revalidate (cheap on LAN).
"""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8686


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # no-cache = store but revalidate every time (ETag/Last-Modified)
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    addr = ("0.0.0.0", PORT)
    print(f"Serving {ROOT}")
    print(f"  Local: http://localhost:{PORT}")
    print("  LAN:   http://<your-ip>:%d  (run ipconfig to find it)" % PORT)
    print("  Close this window to stop the server.")
    ThreadingHTTPServer(addr, Handler).serve_forever()
