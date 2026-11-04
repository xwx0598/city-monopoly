#!/usr/bin/env python3
"""城市大富翁 · 一体化本地服务器

一行命令搞定三件事：
  1. 起静态服务（HTML 一律 no-cache，改了代码刷新就能看到）
  2. 端口被占用时自动顺延（8686 → 8687 → …），不再报错退出
  3. 起好后自动用默认浏览器打开游戏大厅，并打印局域网地址供手机/平板访问

用法：
  python server.py            # 自动开浏览器
  python server.py --no-open  # 只起服务
  python server.py --port 9000
"""
import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import mimetypes
import mp

# PWA 清单的正确 MIME；Windows 注册表里常常没有这条，会被当成二进制流
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")

ROOT = None  # 见 pick_root()
DEFAULT_PORT = 8686
PORT_TRIES = 12
ENTRY = "/lobby/html/index.html"


def pick_root():
    """优先直接服务仓库根目录（源码即真身），避免 deploy/ 副本过期。

    deploy/ 里放的是给发布用的拷贝；如果手滑只改了源码，旧的副本会让改动
    「看起来没生效」。这里优先往上找一层：只要上级目录也有 lobby/html/index.html，
    就服务上级目录。把 deploy 单独拷到服务器上时，自身上级没有 lobby，
    就退回服务 deploy 自己。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (os.path.dirname(here), here):
        if os.path.isfile(os.path.join(cand, "lobby", "html", "index.html")):
            return cand
    return here


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        # /ws 交给联机模块（房间 + 状态转发），其余走静态文件
        if self.path.split("?")[0].rstrip("/") == "/ws":
            mp.serve(self)
            return
        super().do_GET()

    def end_headers(self):
        # no-cache = 允许缓存但每次都要向服务器确认（配合 ETag/Last-Modified）
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 只打印状态码 >= 400 的请求，控制台别刷屏
        try:
            code = int(args[1]) if len(args) > 1 else 0
        except (ValueError, IndexError):
            code = 0
        if code >= 400:
            super().log_message(fmt, *args)


def lan_ip():
    """取本机在局域网中的 IPv4（不会真的发包）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def bind_server(preferred):
    """从 preferred 开始顺延找可用端口。返回 (server, port)。"""
    last_err = None
    for port in range(preferred, preferred + PORT_TRIES):
        try:
            httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
            httpd.daemon_threads = True
            return httpd, port
        except OSError as e:
            last_err = e
            print(f"  端口 {port} 被占用，尝试下一个…")
    raise SystemExit(f"❌ 连续 {PORT_TRIES} 个端口都不可用：{last_err}")


def main():
    # 控制台编码千奇百怪，出错字符降级成 ? 也别让程序崩掉
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass

    args = sys.argv[1:]
    global ROOT
    ROOT = pick_root()
    open_browser = "--no-open" not in args
    port_arg = None
    if "--port" in args:
        try:
            port_arg = int(args[args.index("--port") + 1])
        except (IndexError, ValueError):
            print("--port 后面要跟一个数字，已忽略。")

    base = port_arg or DEFAULT_PORT
    httpd, port = bind_server(base)
    url = f"http://localhost:{port}{ENTRY}"
    ip = lan_ip()

    print("")
    print("  ============================================")
    print("        城市大富翁 · 本地服务器")
    print("  ============================================")
    print(f"  本机访问 : {url}")
    print(f"  服务目录 : {ROOT}")
    if ip:
        print(f"  局域网   : http://{ip}:{port}{ENTRY}")
        print("             （手机 / 平板连同一个 Wi-Fi 即可加入）")
    if port != base:
        print("")
        print(f"  提示：{DEFAULT_PORT} 被占用（可能是上次开的服务器窗口还在），")
        print(f"        本次已自动改用 {port}。旧窗口可以直接关掉。")
    print("")
    print("  关闭这个窗口即停止服务。")
    print("")

    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  服务已停止。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
