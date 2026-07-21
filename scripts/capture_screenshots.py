"""截取文档用界面截图，保存到 docs/screenshots/"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

def click_canvas(page, x_ratio=0.55, y_ratio=0.45):
    vp = page.locator("#viewport").bounding_box()
    if not vp:
        return
    page.mouse.click(vp["x"] + vp["width"] * x_ratio, vp["y"] + vp["height"] * y_ratio)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    page.goto("http://localhost:5173")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3000)
    page.screenshot(path=str(OUT / "01-main-ui.png"))

    # 球面警戒
    page.click('button[data-id="sphere"]')
    page.wait_for_timeout(8000)
    page.screenshot(path=str(OUT / "02-sphere-formation.png"))

    # 楔形突击
    page.click('button[data-id="phalanx"]')
    page.wait_for_timeout(8000)
    page.screenshot(path=str(OUT / "03-phalanx-formation.png"))

    # 故障演练
    page.click("#inject-btn")
    page.click("#inject-btn")
    page.wait_for_timeout(4000)
    page.screenshot(path=str(OUT / "04-failure-drill.png"))

    # 单机遥测：点击视口中央偏上的无人机
    page.evaluate("""() => {
        const { swarm, camera, director } = window.__debug;
        director.setAutoMode(false);
    }""")
    page.wait_for_timeout(500)
    click_canvas(page, 0.52, 0.38)
    page.wait_for_timeout(800)
    page.screenshot(path=str(OUT / "05-telemetry.png"))

    browser.close()
    print("Screenshots saved to", OUT.resolve())
