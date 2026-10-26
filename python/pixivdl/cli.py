#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""命令行入口：解析参数、并发调度下载、输出进度。

流程分两阶段：
1. 并发查询每个作品的分页接口，展开成「一张图一个任务」；
2. 并发下载全部图片任务。
"""

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from . import api, files, net


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="抓取 pixiv 标签作品并并发下载图片")
    parser.add_argument("--user-id", default="114638697")
    parser.add_argument("--tag", default="R-18", help="标签，默认 R-18")
    parser.add_argument("--offset", type=int, default=0, help="偏移量，默认 0")
    parser.add_argument("--limit", type=int, default=48, help="每页数量，也是翻页步长，默认 48")
    parser.add_argument("--out", default=None, help="根目录，默认 ./pixiv_downloads/<tag>，其下按作者分文件夹")
    parser.add_argument("--workers", type=int, default=8, help="并发线程数，默认 8")
    parser.add_argument("--delay", type=float, default=0.2, help="每个任务发起前的等待秒数，默认 0.2")
    parser.add_argument("--cookie", default=None, help="Cookie 字符串，优先级最高")
    parser.add_argument(
        "--cookie-file", default=net.COOKIE_FILE, help="Cookie 文件路径，默认 pixiv_cookie.txt"
    )
    return parser.parse_args(argv)


def resolve_work(work, out_dir, cookie, delay):
    """查作品分页接口，展开为 [(图片地址, 本地路径)]。返回 (任务列表, 错误信息)。"""
    illust_id = str(work.get("id") or "").strip()
    if not illust_id:
        return [], "缺少 id"
    if delay:
        time.sleep(delay)

    try:
        pages = api.fetch_pages(illust_id, cookie)
        artist_dir = files.build_author_dir(
            out_dir, work.get("userId"), work.get("userName")
        )
        os.makedirs(artist_dir, exist_ok=True)

        tasks = []
        for page_index, page in enumerate(pages):
            image_url = (page.get("urls") or {}).get("regular")
            if not image_url:
                continue
            tasks.append((
                image_url,
                files.build_dest(artist_dir, illust_id, work.get("title"), image_url, page_index),
            ))
        if not tasks:
            return [], "%s 无 regular 图片地址" % illust_id
        return tasks, ""
    except Exception as exc:  # 单个作品失败不影响整体
        return [], "%s: %s" % (illust_id, exc)


def download_page(task, out_dir, cookie, delay):
    """下载单张图片。返回 (状态, 描述, 字节数)。"""
    image_url, dest = task
    if delay:
        time.sleep(delay)

    label = os.path.relpath(dest, out_dir)
    try:
        if files.is_complete(dest):
            return "exists", label, 0
        return "ok", label, net.download_file(image_url, dest, cookie)
    except Exception as exc:  # 单张失败不影响整体
        return "failed", "%s: %s" % (label, exc), 0


def format_elapsed(seconds):
    minutes, secs = divmod(int(seconds), 60)
    return "%d分%02d秒" % (minutes, secs) if minutes else "%d秒" % secs


def main(argv=None):
    args = parse_args(argv)

    cookie = net.load_cookie(args.cookie, args.cookie_file)
    if cookie:
        print("已加载 Cookie: %s" % net.mask_cookie(cookie))
    else:
        print("未提供 Cookie，将以未登录状态抓取（R-18 作品会被过滤）。")

    out_dir = args.out or os.path.join("pixiv_downloads", files.safe_name(args.tag, "tag"))
    os.makedirs(out_dir, exist_ok=True)

    works, total = api.collect_works(
        args.user_id, args.tag, args.offset, args.limit, cookie, min(args.workers, 8)
    )
    print("标签 %s 共 %d 个作品，已收集 %d 个" % (args.tag, total, len(works)))
    if not works:
        print("没有取到作品，检查标签或参数。")
        return 1

    started = time.time()

    page_tasks = []
    resolve_failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(resolve_work, work, out_dir, cookie, args.delay)
            for work in works
        ]
        for future in as_completed(futures):
            tasks, error = future.result()
            if error:
                resolve_failed += 1
                print("[解析失败] %s" % error)
                continue
            page_tasks.extend(tasks)

    print("%d 个作品展开为 %d 张图片，%d 线程开始下载"
          % (len(works) - resolve_failed, len(page_tasks), args.workers))
    if not page_tasks:
        print("没有可下载的图片。")
        return 1

    counters = {"ok": 0, "exists": 0, "failed": 0}
    downloaded_bytes = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(download_page, task, out_dir, cookie, args.delay)
            for task in page_tasks
        ]
        for index, future in enumerate(as_completed(futures), 1):
            status, detail, size_bytes = future.result()
            counters[status] += 1
            downloaded_bytes += size_bytes
            if status == "ok":
                print("[%d/%d] [完成] %s (%.2f MB)"
                      % (index, len(page_tasks), detail, size_bytes / 1024 / 1024))
            elif status == "exists":
                print("[%d/%d] [已存在] %s" % (index, len(page_tasks), detail))
            else:
                print("[%d/%d] [失败] %s" % (index, len(page_tasks), detail))

    elapsed = time.time() - started
    print("\n结束：完成 %d，已存在 %d，失败 %d，解析失败作品 %d，"
          "共 %.2f MB，耗时 %s（平均 %.2f MB/s），目录 %s"
          % (counters["ok"], counters["exists"], counters["failed"], resolve_failed,
             downloaded_bytes / 1024 / 1024, format_elapsed(elapsed),
             downloaded_bytes / 1024 / 1024 / elapsed if elapsed else 0,
             os.path.abspath(out_dir)))
    return 0 if counters["failed"] == 0 and resolve_failed == 0 else 2


def run():
    sys.exit(main())
