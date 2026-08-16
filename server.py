import argparse
import email
import json
import os
import queue
import re
import socket
import subprocess
import threading
import time
import uuid
from email import policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC_FILES = {
    "/": "static/index.html",
    "/style.css": "static/style.css",
    "/client.js": "static/client.js",
}

AUTH_KEY = None
BROADCASTER = None
DISCOVERY = None
FILES = {}
FILES_LOCK = threading.Lock()
UPLOAD_DIR = None
MAX_BYTES = 100 * 1024 * 1024
SERVER_PORT = 8000
SERVER_NAME = "DropChat"
CHAT_HISTORY = []
CHAT_HISTORY_MAX = 200


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def safe_name(name):
    name = os.path.basename(unquote(name or "")).replace("/", "_").replace("\\", "_")
    name = name.strip()
    if not name or name in (".", ".."):
        return "unnamed_file"
    return name


class Broadcaster:
    def __init__(self):
        self.clients = []
        self.lock = threading.Lock()

    def subscribe(self, name):
        c = {"queue": queue.Queue(maxsize=500), "name": name}
        with self.lock:
            self.clients.append(c)
        self.broadcast("users", self.user_list())
        return c

    def unsubscribe(self, c):
        with self.lock:
            if c in self.clients:
                self.clients.remove(c)
        self.broadcast("users", self.user_list())

    def user_list(self):
        with self.lock:
            return [c["name"] for c in self.clients]

    def broadcast(self, event, data):
        payload = "event: {}\ndata: {}\n\n".format(event, json.dumps(data))
        with self.lock:
            snapshot = list(self.clients)
        for c in snapshot:
            try:
                c["queue"].put_nowait(payload)
            except queue.Full:
                pass


class Discovery:
    def __init__(self, port, name, http_port):
        self.port = port
        self.name = name
        self.http_port = http_port
        self.self_id = uuid.uuid4().hex[:8]
        self.servers = {}
        self.lock = threading.Lock()
        self.running = True
        self.sock = None

    def start(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        except OSError:
            pass
        s.bind(("0.0.0.0", self.port))
        self.sock = s
        threading.Thread(target=self._announcer, daemon=True).start()
        threading.Thread(target=self._receiver, daemon=True).start()

    def stop(self):
        self.running = False
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass

    def _announcer(self):
        payload = "DROPCAT_HELLO {} {} {}".format(
            self.name, self.http_port, self.self_id
        ).encode()
        while self.running:
            try:
                self.sock.sendto(payload, ("255.255.255.255", self.port))
            except OSError:
                pass
            time.sleep(5)

    def _receiver(self):
        while self.running:
            try:
                data, addr = self.sock.recvfrom(1024)
            except OSError:
                continue
            text = data.decode("utf-8", "replace").strip()
            if not text.startswith("DROPCAT_HELLO"):
                continue
            parts = text.split(" ", 3)
            if len(parts) != 4:
                continue
            _, name, hport, sender_id = parts
            if sender_id == self.self_id:
                continue
            try:
                hport = int(hport)
            except ValueError:
                continue
            with self.lock:
                self.servers[addr[0]] = {
                    "ip": addr[0],
                    "name": name,
                    "port": hport,
                    "seen": time.time(),
                }
            try:
                self.sock.sendto(
                    "DROPCAT_HELLO {} {} {}".format(
                        self.name, self.http_port, self.self_id
                    ).encode(),
                    (addr[0], self.port),
                )
            except OSError:
                pass

    def snapshot(self):
        now = time.time()
        out = []
        with self.lock:
            for s in self.servers.values():
                if now - s["seen"] < 25:
                    out.append({"ip": s["ip"], "name": s["name"], "port": s["port"]})
        return out


def scan_files():
    global FILES
    with FILES_LOCK:
        FILES = {}
        if not os.path.isdir(UPLOAD_DIR):
            return
        for f in os.listdir(UPLOAD_DIR):
            path = os.path.join(UPLOAD_DIR, f)
            if os.path.isfile(path):
                file_id = f
                display = file_id.split("_", 1)[1] if "_" in file_id else file_id
                FILES[file_id] = {
                    "id": file_id,
                    "name": display,
                    "size": os.path.getsize(path),
                    "path": path,
                }


def save_upload(orig_name, data):
    safe = safe_name(orig_name)
    file_id = "{}_{}".format(uuid.uuid4().hex[:8], safe)
    path = os.path.join(UPLOAD_DIR, file_id)
    with open(path, "wb") as fh:
        fh.write(data)
    with FILES_LOCK:
        FILES[file_id] = {
            "id": file_id,
            "name": safe,
            "size": len(data),
            "path": path,
        }
    return FILES[file_id]


def parse_multipart(content_type, body):
    m = re.search(r'boundary="?([^";]+)"?', content_type)
    if not m:
        return {}
    boundary = ("--" + m.group(1)).encode()
    result = {}
    for chunk in body.split(boundary):
        chunk = chunk.strip(b"\r\n")
        if not chunk or chunk == b"--":
            continue
        if b"\r\n\r\n" not in chunk:
            continue
        head, _, payload = chunk.partition(b"\r\n\r\n")
        name = None
        filename = None
        for line in head.split(b"\r\n"):
            if not line.lower().startswith(b"content-disposition:"):
                continue
            text = line.decode("utf-8", "replace")
            nm = re.search(r'name="([^"]*)"', text)
            if nm:
                name = nm.group(1)
            fm = re.search(r'filename="([^"]*)"', text)
            if fm:
                filename = fm.group(1)
        if name:
            result[name] = {"filename": filename, "data": payload}
    return result


def wifi_scan():
    try:
        out = subprocess.run(
            ["arp", "-a"], capture_output=True, text=True, timeout=10
        ).stdout
        prefix = ".".join(lan_ip().split(".")[:3]) + "."
        devices = []
        seen = set()
        for line in out.splitlines():
            m = re.match(r"\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:-]+)\s+(\S+)", line)
            if not m or not m.group(1).startswith(prefix):
                continue
            if m.group(1).endswith(".255"):
                continue
            if m.group(1) in seen:
                continue
            seen.add(m.group(1))
            devices.append(
                {"ip": m.group(1), "mac": m.group(2), "type": m.group(3)}
            )
        return devices
    except Exception:
        return []


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def authed(self):
        if not AUTH_KEY:
            return True
        q = parse_qs(urlparse(self.path).query)
        return q.get("key", [None])[0] == AUTH_KEY

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _reject(self):
        self._send(401, json.dumps({"error": "wrong password"}))

    def do_GET(self):
        if not self.authed():
            self._reject()
            return
        parsed = urlparse(self.path)
        path = parsed.path
        q = parse_qs(parsed.query)

        if path in STATIC_FILES:
            self.serve_static(STATIC_FILES[path])
            return
        if path == "/events":
            self.serve_events(q.get("name", ["Guest"])[0])
            return
        if path == "/api/files":
            with FILES_LOCK:
                listing = [
                    {"id": f["id"], "name": f["name"], "size": f["size"]}
                    for f in FILES.values()
                ]
            self._send(200, json.dumps(listing))
            return
        if path == "/api/users":
            self._send(200, json.dumps(BROADCASTER.user_list()))
            return
        if path == "/api/info":
            self._send(
                200,
                json.dumps(
                    {"lan": "{}:{}".format(lan_ip(), SERVER_PORT), "name": SERVER_NAME}
                ),
            )
            return
        if path == "/api/discover":
            self._send(200, json.dumps(DISCOVERY.snapshot()))
            return
        if path == "/api/wifi":
            self._send(200, json.dumps(wifi_scan()))
            return
        if path.startswith("/download/"):
            self.serve_download(path[len("/download/") :])
            return
        self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if not self.authed():
            self._reject()
            return
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/send":
            length = int(self.headers.get("Content-Length", 0))
            try:
                data = json.loads(self.rfile.read(length).decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send(400, json.dumps({"error": "bad message"}))
                return
            name = (data.get("name") or "Guest")[:40]
            message = (data.get("message") or "").strip()[:2000]
            if not message:
                self._send(400, json.dumps({"error": "empty message"}))
                return
            entry = {
                "name": name,
                "message": message,
                "time": time.strftime("%H:%M"),
            }
            CHAT_HISTORY.append(entry)
            del CHAT_HISTORY[: max(0, len(CHAT_HISTORY) - CHAT_HISTORY_MAX)]
            BROADCASTER.broadcast("message", entry)
            self._send(200, json.dumps({"ok": True}))
            return

        if path == "/upload":
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BYTES:
                self._send(413, json.dumps({"error": "file too big"}))
                return
            body = self.rfile.read(length)
            parts = parse_multipart(self.headers.get("Content-Type", ""), body)
            if "file" not in parts:
                self._send(400, json.dumps({"error": "no file"}))
                return
            saved = save_upload(parts["file"]["filename"], parts["file"]["data"])
            BROADCASTER.broadcast(
                "file", {"name": saved["name"], "size": saved["size"]}
            )
            self._send(200, json.dumps({"ok": True, "id": saved["id"]}))
            return

        self._send(404, json.dumps({"error": "not found"}))

    def serve_static(self, rel):
        path = os.path.join(HERE, rel)
        try:
            with open(path, "rb") as fh:
                body = fh.read()
        except OSError:
            self._send(404, b"not found", ctype="text/plain")
            return
        if rel.endswith(".css"):
            ctype = "text/css"
        elif rel.endswith(".js"):
            ctype = "application/javascript"
        else:
            ctype = "text/html"
        self._send(200, body, ctype=ctype)

    def serve_download(self, file_id):
        with FILES_LOCK:
            info = FILES.get(file_id)
        if not info:
            self._send(404, json.dumps({"error": "no such file"}))
            return
        try:
            with open(info["path"], "rb") as fh:
                body = fh.read()
        except OSError:
            self._send(404, json.dumps({"error": "file missing"}))
            return
        import mimetypes

        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(info["name"])[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Content-Disposition",
            'attachment; filename="{}"'.format(info["name"].replace('"', "")),
        )
        self.end_headers()
        self.wfile.write(body)

    def serve_events(self, name):
        if not name.strip():
            name = "Guest"
        c = BROADCASTER.subscribe(name[:40])
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(
                "event: history\ndata: {}\n\n".format(json.dumps(CHAT_HISTORY)).encode()
            )
            self.wfile.flush()
            while True:
                try:
                    payload = c["queue"].get(timeout=15)
                    self.wfile.write(payload.encode())
                    self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            BROADCASTER.unsubscribe(c)


def main():
    global AUTH_KEY, BROADCASTER, DISCOVERY, UPLOAD_DIR, MAX_BYTES, SERVER_PORT, SERVER_NAME
    ap = argparse.ArgumentParser(description="DropChat - LAN chat + file sharing")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--name", default="DropChat")
    ap.add_argument("--pass", dest="password", default=None)
    ap.add_argument("--max-mb", type=int, default=100)
    args = ap.parse_args()

    AUTH_KEY = args.password
    MAX_BYTES = max(1, args.max_mb) * 1024 * 1024
    SERVER_PORT = args.port
    SERVER_NAME = args.name
    UPLOAD_DIR = os.path.join(HERE, "uploads")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    scan_files()

    BROADCASTER = Broadcaster()
    DISCOVERY = Discovery(5055, args.name, args.port)
    DISCOVERY.start()

    ip = lan_ip()
    httpd = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print("DropChat is running!")
    print("  On this PC:     http://localhost:{}".format(args.port))
    print("  On your Wi-Fi:  http://{}:{}".format(ip, args.port))
    if AUTH_KEY:
        print("  Password:       {}".format(AUTH_KEY))
        print("  Add ?key={} to every address above".format(AUTH_KEY))
    print("  Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        httpd.server_close()
        DISCOVERY.stop()


if __name__ == "__main__":
    main()
