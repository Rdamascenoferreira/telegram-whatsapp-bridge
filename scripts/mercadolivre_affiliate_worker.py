import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path


MERCADO_LIVRE_LINK_RE = re.compile(r"https?://[^\s'\"<>]+(?:mercadolivre\.com|mercadolivre\.com\.br|meli\.la)[^\s'\"<>]*", re.I)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=True), flush=True)


def clean_url(value):
    return str(value or "").strip().rstrip(").,;!")


def normalize_compare_url(value):
    return clean_url(value).lower().replace("http://", "https://").rstrip("/")


async def run_login(args):
    try:
        from playwright.async_api import async_playwright
    except Exception:
        emit({
            "success": False,
            "error": "Playwright Python is not installed. Run: python -m pip install -r scripts/requirements-mercadolivre.txt"
        })
        return

    storage_state = Path(args.storage_state).resolve()
    storage_state.parent.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=False)
        context_args = {"locale": "pt-BR"}

        if storage_state.exists():
            context_args["storage_state"] = str(storage_state)

        context = await browser.new_context(**context_args)
        page = await context.new_page()
        await page.goto(args.url or "https://www.mercadolivre.com.br", wait_until="domcontentloaded", timeout=args.timeout_ms)
        print("Login aberto. Entre na conta Mercado Livre afiliada e pressione Enter aqui para salvar a sessao.", flush=True)

        try:
            input()
        except EOFError:
            pass

        await context.storage_state(path=str(storage_state))
        await browser.close()

    emit({
        "success": True,
        "storageState": str(storage_state)
    })


async def run_generate(args):
    try:
        from playwright.async_api import async_playwright
    except Exception:
        emit({
            "success": False,
            "error": "Playwright Python is not installed. Run: python -m pip install -r scripts/requirements-mercadolivre.txt"
        })
        return

    storage_state = Path(args.storage_state).resolve()
    if not storage_state.exists():
        emit({
            "success": False,
            "error": "Mercado Livre storage_state file was not found"
        })
        return

    original_url = clean_url(args.url)
    if not original_url:
        emit({
            "success": False,
            "error": "Mercado Livre URL is empty"
        })
        return

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=bool(int(args.headless)),
            args=["--disable-dev-shm-usage"]
        )
        context = await browser.new_context(
            storage_state=str(storage_state),
            locale="pt-BR",
            permissions=["clipboard-read", "clipboard-write"]
        )
        page = await context.new_page()

        try:
            await page.goto(original_url, wait_until="domcontentloaded", timeout=args.timeout_ms)
            await page.wait_for_timeout(1200)

            if await looks_like_login_required(page):
                emit({
                    "success": False,
                    "error": "Mercado Livre session expired or login is required"
                })
                return

            affiliate_url = await extract_affiliate_url(page, original_url)
            if not affiliate_url:
                await click_affiliate_controls(page)
                await fill_label_if_available(page, args.label)
                await page.wait_for_timeout(1200)
                affiliate_url = await extract_affiliate_url(page, original_url)

            if not affiliate_url:
                await click_copy_controls(page)
                affiliate_url = await read_clipboard_link(page, original_url)

            await context.storage_state(path=str(storage_state))

            if not affiliate_url:
                emit({
                    "success": False,
                    "error": "Mercado Livre affiliate link was not visible after browser automation"
                })
                return

            emit({
                "success": True,
                "affiliateUrl": affiliate_url,
                "source": "browser_automation"
            })
        except Exception as exc:
            emit({
                "success": False,
                "error": safe_error(exc)
            })
        finally:
            await browser.close()


async def looks_like_login_required(page):
    current_url = page.url.lower()
    if "login" in current_url or "registration" in current_url:
        return True

    login_text = page.get_by_text(re.compile(r"\b(entrar|login|iniciar sess[aã]o)\b", re.I))
    try:
        return await login_text.count() > 0 and "mercadolivre" not in current_url
    except Exception:
        return False


async def click_affiliate_controls(page):
    patterns = [
        re.compile(r"(gerar|criar|copiar).*(link|id)", re.I),
        re.compile(r"(link|id).*(afiliad|afiliado)", re.I),
        re.compile(r"afiliad", re.I),
    ]

    for pattern in patterns:
        if await click_first(page.get_by_role("button", name=pattern)):
            return True
        if await click_first(page.get_by_text(pattern)):
            return True

    return False


async def click_copy_controls(page):
    patterns = [
        re.compile(r"copiar", re.I),
        re.compile(r"copy", re.I),
        re.compile(r"link", re.I),
    ]

    for pattern in patterns:
        if await click_first(page.get_by_role("button", name=pattern)):
            return True

    return False


async def click_first(locator):
    try:
        count = min(await locator.count(), 5)
        for index in range(count):
            item = locator.nth(index)
            if await item.is_visible():
                await item.click(timeout=2500)
                return True
    except Exception:
        return False

    return False


async def fill_label_if_available(page, label):
    label = str(label or "").strip()
    if not label:
        return

    candidates = [
        page.get_by_label(re.compile(r"etiqueta|campanha|tag|sub", re.I)),
        page.locator("input[name*='tag' i], input[name*='label' i], input[name*='campaign' i], input[placeholder*='etiqueta' i]")
    ]

    for locator in candidates:
        try:
            count = min(await locator.count(), 3)
            for index in range(count):
                item = locator.nth(index)
                if await item.is_visible():
                    await item.fill(label[:80], timeout=2500)
                    return
        except Exception:
            continue


async def extract_affiliate_url(page, original_url):
    candidates = await page.evaluate(
        """() => {
          const values = [];
          const nodes = Array.from(document.querySelectorAll('input, textarea, a[href], [contenteditable="true"], [data-testid], [class], [id]'));
          for (const node of nodes) {
            const value = node.value || node.href || node.textContent || node.getAttribute('aria-label') || '';
            if (value) values.push(String(value));
          }
          return values;
        }"""
    )

    return select_affiliate_link(candidates, original_url)


async def read_clipboard_link(page, original_url):
    try:
        text = await page.evaluate("navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText() : ''")
        return select_affiliate_link([text], original_url)
    except Exception:
        return ""


def select_affiliate_link(values, original_url):
    original = normalize_compare_url(original_url)

    for value in values or []:
        for match in MERCADO_LIVRE_LINK_RE.findall(str(value or "")):
            candidate = clean_url(match)
            if candidate and normalize_compare_url(candidate) != original:
                return candidate

    return ""


def safe_error(exc):
    message = str(exc or "").strip()
    message = re.sub(r"[A-Za-z0-9_-]{32,}", "[redacted]", message)
    return message[:500] or "Mercado Livre browser automation failed"


def build_parser():
    parser = argparse.ArgumentParser(description="Mercado Livre affiliate browser worker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    login = subparsers.add_parser("login")
    login.add_argument("--storage-state", required=True)
    login.add_argument("--url", default="https://www.mercadolivre.com.br")
    login.add_argument("--timeout-ms", type=int, default=120000)

    generate = subparsers.add_parser("generate")
    generate.add_argument("--url", required=True)
    generate.add_argument("--storage-state", required=True)
    generate.add_argument("--label", default="")
    generate.add_argument("--headless", default="1")
    generate.add_argument("--timeout-ms", type=int, default=45000)

    return parser


async def main():
    args = build_parser().parse_args()

    if args.command == "login":
        await run_login(args)
        return

    if args.command == "generate":
        await run_generate(args)
        return

    emit({
        "success": False,
        "error": "Unknown command"
    })


if __name__ == "__main__":
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        emit({
            "success": False,
            "error": "Interrupted"
        })
        sys.exit(1)
