from pathlib import Path

# Keep the historical import path working while the implementation lives under vendor/xhs.
__path__ = [str(Path(__file__).resolve().parent.parent / "vendor" / "xhs" / "xhsmedia")]

from .core import XiaoHongShuCrawler
from .field import *  # noqa: F401,F403
