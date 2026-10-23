"""Mimics Claude's artifact viewer for testing the Clicky Lite demo.

  python3 tests/sandbox_server.py            # site on :8765 (with a strict CSP), host on :8766

The site is served with a CSP like the viewer's. The host page on a second port loads
demo/index.html in a sandboxed iframe: no allow-same-origin by default (opaque origin),
or with it when the host URL has ?same=1.
"""
import http.server, os, sys, threading, socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_PORT = int(os.environ.get('SITE_PORT', 8765))
HOST_PORT = int(os.environ.get('HOST_PORT', 8766))
CSP = ("default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
       "img-src 'self' data: blob:; connect-src 'self'")

class Site(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass

HOST = """<!doctype html><meta charset="utf-8"><title>Sandbox host</title>
<style>html,body{margin:0;height:100%%}iframe{border:0;width:100%%;height:100%%;display:block}</style>
<iframe id="f" sandbox="allow-scripts allow-forms allow-popups allow-modals%s" src="http://localhost:%d/%s"></iframe>"""

class Host(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        same = ' allow-same-origin' if q.get('same') == ['1'] else ''
        page = q.get('page', ['demo/index.html'])[0]
        body = (HOST % (same, SITE_PORT, page)).encode()
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

class T(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True; daemon_threads = True

if __name__ == '__main__':
    a = T(('127.0.0.1', SITE_PORT), Site); b = T(('127.0.0.1', HOST_PORT), Host)
    threading.Thread(target=a.serve_forever, daemon=True).start()
    print(f'site http://localhost:{SITE_PORT}/  host http://localhost:{HOST_PORT}/', flush=True)
    b.serve_forever()
