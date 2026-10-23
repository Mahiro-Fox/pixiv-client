#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pixiv 标签作品抓取与并发下载入口。

实现按职责拆分在 pixivdl 包内：
    net.py   HTTP 头、重试、Cookie、流式下载
    api.py   作品列表（自动并发翻页）与作品详情
    files.py 文件名与路径处理
    cli.py   参数解析与并发调度

用法:
    python pixiv_tag_download.py --help
"""

import sys

from pixivdl.cli import main

if __name__ == "__main__":
    sys.exit(main())
