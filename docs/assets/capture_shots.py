"""用 Playwright 以手机视口截取乱写的各个界面,输出到 docs/assets/。"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8791"
OUT = pathlib.Path("docs/assets")
OUT.mkdir(parents=True, exist_ok=True)
VW, VH = 402, 874  # iPhone 逻辑尺寸


def tab(page, label):
    page.locator("nav.tabs button").filter(has_text=label).click()
    page.wait_for_timeout(700)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": VW, "height": VH},
                                  device_scale_factor=2, is_mobile=True,
                                  locale="zh-CN")
        page = ctx.new_page()
        page.goto(BASE, wait_until="load")
        page.wait_for_timeout(1600)

        # 1. 乱写(捕获页)
        page.screenshot(path=str(OUT / "shot-capture.png"))

        # 2. 收件箱
        tab(page, "收件箱")
        page.screenshot(path=str(OUT / "shot-inbox.png"))

        # 3. 待确认
        tab(page, "待确认")
        page.screenshot(path=str(OUT / "shot-review.png"))

        # 4. 知识库
        tab(page, "知识库")
        page.screenshot(path=str(OUT / "shot-topics.png"))

        # 5. 主题详情(点第一张主题卡 = 最近更新的「Claude 提示缓存实战」)
        page.locator(".topic-card").first.click()
        page.wait_for_timeout(900)
        page.screenshot(path=str(OUT / "shot-detail.png"))
        # 展开版本历史 + 打开一个 diff,做整页长图
        page.locator("button", has_text="版本历史").first.click()
        page.wait_for_timeout(500)
        diffs = page.locator("button", has_text="对比")
        if diffs.count():
            diffs.first.click()
            page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "shot-detail-full.png"), full_page=True)

        # 6. 设置
        tab(page, "设置")
        page.screenshot(path=str(OUT / "shot-settings.png"))

        browser.close()
    print("shots saved to", OUT)


if __name__ == "__main__":
    sys.exit(main())
