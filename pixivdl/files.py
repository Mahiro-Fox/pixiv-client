#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地文件层：安全文件名、扩展名推断、目标路径拼接。"""

import os
import re
import urllib.parse

INVALID_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t]+')


def safe_name(text, fallback="untitled"):
    cleaned = INVALID_CHARS.sub("_", str(text or "")).strip(" ._")
    return cleaned[:80] or fallback


def ext_of(url):
    path = urllib.parse.urlparse(url).path
    return os.path.splitext(path)[1] or ".jpg"


def build_author_dir(base_dir, user_id, user_name):
    """按作者分文件夹：{用户id}_{昵称}。"""
    folder = "%s_%s" % (str(user_id or "").strip() or "unknown", safe_name(user_name, "artist"))
    return os.path.join(base_dir, folder)


def build_dest(out_dir, illust_id, title, url, page_index=0):
    """生成 {作品id}_p{页号}_{标题}{扩展名} 的本地路径。"""
    filename = "%s_p%d_%s%s" % (illust_id, page_index, safe_name(title), ext_of(url))
    return os.path.join(out_dir, filename)


def is_complete(path):
    return os.path.exists(path) and os.path.getsize(path) > 0
