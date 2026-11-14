#!/usr/bin/env python3
"""Lokaler Testserver für Hanna Erfassung.

Liefert docs/ aus und spielt die drei Graph-Aufrufe nach, die die App braucht
(Metadaten mit eTag, Inhalt lesen, Inhalt schreiben mit If-Match bzw.
conflictBehavior=fail). Geschrieben wird nur in den Ordner --wurzel, nie ins
echte OneDrive.

    py dev_server.py --wurzel %TEMP%\\hanna_test_onedrive --port 8790

Auf localhost schaltet die App in den Testmodus (keine Microsoft-Anmeldung).
"""
import argparse
import hashlib
import http.server
import json
import os
import urllib.parse

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")
PRAEFIX = "/graph/v1.0/me/drive/root:/"


def etag(daten: bytes) -> str:
    return '"' + hashlib.sha1(daten).hexdigest() + '"'


class Handler(http.server.SimpleHTTPRequestHandler):
    wurzel = None

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[dev]", fmt % args, flush=True)

    def _ziel(self):
        u = urllib.parse.urlsplit(self.path)
        if not u.path.startswith(PRAEFIX):
            return None, None, None
        rest = urllib.parse.unquote(u.path[len(PRAEFIX):])
        inhalt = rest.endswith(":/content")
        if inhalt:
            rest = rest[: -len(":/content")]
        pfad = os.path.realpath(os.path.join(self.wurzel, *rest.split("/")))
        if not pfad.startswith(os.path.realpath(self.wurzel) + os.sep):
            return "verboten", None, None
        return pfad, inhalt, urllib.parse.parse_qs(u.query)

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _auth_ok(self):
        if self.headers.get("Authorization") != "Bearer test":
            self._json(401, {"error": {"code": "InvalidAuthenticationToken"}})
            return False
        return True

    def do_GET(self):
        pfad, inhalt, q = self._ziel()
        if pfad is None:
            return super().do_GET()
        if pfad == "verboten":
            return self._json(403, {"error": "pfad"})
        # Wie Graph: die downloadUrl (hier ?dl=1) braucht keinen Authorization-Kopf
        if not (inhalt and q.get("dl") == ["1"]) and not self._auth_ok():
            return
        if not os.path.isfile(pfad):
            return self._json(404, {"error": {"code": "itemNotFound"}})
        with open(pfad, "rb") as fh:
            daten = fh.read()
        basis = urllib.parse.urlsplit(self.path).path
        if not inhalt:
            return self._json(200, {"name": os.path.basename(pfad), "eTag": etag(daten), "size": len(daten),
                                    "@microsoft.graph.downloadUrl":
                                        f"http://{self.headers.get('Host')}{basis}:/content?dl=1"})
        if q.get("dl") != ["1"]:
            # Wie Graph: :/content antwortet mit einer Weiterleitung
            self.send_response(302)
            self.send_header("Location", f"{basis}?dl=1")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(daten)))
        self.end_headers()
        self.wfile.write(daten)

    def do_PUT(self):
        pfad, inhalt, q = self._ziel()
        if pfad in (None, "verboten") or not inhalt:
            return self._json(400, {"error": "nur :/content"})
        if not self._auth_ok():
            return
        daten = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        da = os.path.isfile(pfad)
        if da and q.get("@microsoft.graph.conflictBehavior") == ["fail"]:
            return self._json(409, {"error": {"code": "nameAlreadyExists"}})
        wunsch = self.headers.get("If-Match")
        if wunsch:
            alt = open(pfad, "rb").read() if da else b""
            if not da or etag(alt) != wunsch:
                return self._json(412, {"error": {"code": "preconditionFailed"}})
        os.makedirs(os.path.dirname(pfad), exist_ok=True)   # wie Graph: Ordner entstehen mit
        with open(pfad, "wb") as fh:
            fh.write(daten)
        self._json(201 if not da else 200, {"name": os.path.basename(pfad), "eTag": etag(daten)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wurzel", required=True, help="Ordner, der den OneDrive-Stamm spielt")
    ap.add_argument("--port", type=int, default=8790)
    a = ap.parse_args()
    os.makedirs(a.wurzel, exist_ok=True)
    Handler.wurzel = a.wurzel
    print(f"Hanna Erfassung (Test): http://localhost:{a.port}/  OneDrive-Ersatz: {a.wurzel}", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
