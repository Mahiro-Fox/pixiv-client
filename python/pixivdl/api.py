#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pixiv 接口层：作品列表（自动并发翻页）、作品分页信息。"""

import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from .net import BASE, fetch_json

TAG_URL = (
    BASE
    + "/ajax/user/{user_id}/illustmanga/tag?tag={tag}"
    + "&offset={offset}&limit={limit}&sensitiveFilterMode=userSetting&lang=zh"
)
PAGES_URL = BASE + "/ajax/illust/{id}/pages?lang=zh"


def dedupe_works(works):
    """按 id 去重并保持原有顺序。"""
    seen = set()
    result = []
    for work in works:
        work_id = str(work.get("id") or "").strip()
        if not work_id or work_id in seen:
            continue
        seen.add(work_id)
        result.append(work)
    return result


def fetch_works(user_id, tag, offset, limit, cookie=""):
    """返回 (works 列表, 总数)。works 的每个元素含 id 字段。"""
    url = TAG_URL.format(
        user_id=user_id,
        tag=urllib.parse.quote(tag),
        offset=offset,
        limit=limit,
    )
    data = fetch_json(url, cookie)
    if data.get("error"):
        raise RuntimeError("作品列表接口报错: %s" % data.get("message"))
    body = data.get("body") or {}
    return body.get("works") or [], int(body.get("total") or 0)


def fetch_pages(illust_id, cookie=""):
    """返回作品全部页的 [{urls, width, height}]，按页序排列。"""
    data = fetch_json(PAGES_URL.format(id=illust_id), cookie)
    if data.get("error"):
        raise RuntimeError("作品分页接口报错: %s" % data.get("message"))
    return data.get("body") or []


def collect_works(user_id, tag, offset, limit, cookie="", workers=6):
    """自动翻页：offset 依次加 limit，直到取满 total 或某页为空。

    首屏请求拿到 total 后，其余分页用线程池并发抓取，再按 offset 顺序合并。
    """
    first_works, total = fetch_works(user_id, tag, offset, limit, cookie)
    if not first_works:
        return [], total

    chunks = [first_works]
    offsets = list(range(offset + limit, total, limit))
    if offsets:
        print(
            "共 %d 个作品，共 %d 页，并发 %d 路抓取剩余分页"
            % (total, len(offsets) + 1, min(workers, len(offsets)))
        )
        with ThreadPoolExecutor(max_workers=min(workers, len(offsets))) as pool:
            futures = {
                page_offset: pool.submit(
                    fetch_works, user_id, tag, page_offset, limit, cookie
                )
                for page_offset in offsets
            }
            for page_offset in sorted(futures):
                try:
                    page_works, _ = futures[page_offset].result()
                except Exception as exc:
                    print("分页 offset=%d 抓取失败: %s" % (page_offset, exc))
                    continue
                chunks.append(page_works)

    return dedupe_works([work for chunk in chunks for work in chunk]), total
