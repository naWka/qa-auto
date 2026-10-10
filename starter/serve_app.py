"""Serves Bloomly (the app under test in ./app) on http://localhost:3000.

    python serve_app.py         # then open http://localhost:3000 in your browser
    python serve_app.py 8080    # the same on another port

You rarely need to run this by hand: pytest starts Bloomly by itself (see conftest.py).
Run it when you want to click around the app, record with codegen, or let an agent
explore it through Playwright MCP.

Why not `python -m http.server`? Bloomly is a single-page app: /login, /cart and /account
are all the same index.html, and the app's JavaScript draws the right page. http.server
doesn't know that and answers "404 Not Found" for /login. This tiny server sends
index.html for every address that isn't a real file.
"""
import functools
import http.server
import os
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent / "app"


class SinglePageAppHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # /login, /cart?promo=… are not files: answer with index.html, the app routes itself
        if not os.path.exists(self.translate_path(self.path)):
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, format, *args):
        pass  # no line per request: keeps the terminal and pytest's output readable


def make_server(port: int = 3000) -> http.server.ThreadingHTTPServer:
    handler = functools.partial(SinglePageAppHandler, directory=str(APP_DIR))
    return http.server.ThreadingHTTPServer(("localhost", port), handler)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    server = make_server(port)
    print(f"Bloomly is running on http://localhost:{port} (press Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
