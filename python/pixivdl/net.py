#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""网络基础层：统一的请求头、重试、Cookie 加载与流式下载。"""

import json
import os
import time
import urllib.error
import urllib.request

BASE = "https://www.pixiv.net"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Referer": BASE + "/",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
COOKIE_FILE = "pixiv_cookie.txt"
TIMEOUT = 30
RETRIES = 3
CHUNK_SIZE = 256 * 1024


def make_request(url, cookie=""):
    """构造带来源、UA 与 Cookie 的请求，i.pximg.net 无 Referer 会返回 403。"""
    headers = dict(DEFAULT_HEADERS)
    if cookie:
        headers["Cookie"] = cookie
    return urllib.request.Request(url, headers=headers)


def load_cookie(cli_cookie=None, cookie_file=COOKIE_FILE):
    """按 命令行 > 环境变量 PIXIV_COOKIE > Cookie 文件 的顺序取 Cookie。

    只填了 PHPSESSID 的值时会自动补成 PHPSESSID=xxx。
    """
    raw = (cli_cookie or os.environ.get("PIXIV_COOKIE") or "").strip()
    if not raw and os.path.exists(cookie_file):
        with open(cookie_file, "r", encoding="utf-8-sig") as handle:
            raw = handle.read().strip()
    if not raw:
        return ""
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    value = "; ".join(lines)
    if "=" not in value:
        value = "PHPSESSID=" + value
    return value


def mask_cookie(cookie):
    if not cookie:
        return ""
    if len(cookie) < 24:
        return cookie
    return cookie[:12] + "..." + cookie[-6:]


def fetch_json(url, cookie=""):
    """带退避重试地请求 JSON 接口。"""
    last_error = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(
                make_request(url, cookie), timeout=TIMEOUT
            ) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("请求失败: %s (%s)" % (url, last_error))


def download_file(url, dest_path, cookie=""):
    """流式下载到 .part 临时文件，成功后原子改名，避免留下半成品。返回字节数。"""
    part_path = dest_path + ".part"
    last_error = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(
                make_request(url, cookie), timeout=TIMEOUT
            ) as resp, open(part_path, "wb") as handle:
                while True:
                    chunk = resp.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    handle.write(chunk)
            os.replace(part_path, dest_path)
            return os.path.getsize(dest_path)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if os.path.exists(part_path):
                try:
                    os.remove(part_path)
                except OSError:
                    pass
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("下载失败: %s (%s)" % (url, last_error))
