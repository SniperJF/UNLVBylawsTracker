#!/usr/bin/env python3
"""Stamp local js/css references in frontend HTML with a content hash.

Browsers cached js/api.js while the HTML calling into it updated, leaving pages
wired to a script missing functions they called. Keying each URL to the file's
own content means freshly served HTML always points at a URL the cache has
never seen, and unchanged files keep their cached copy.

Idempotent: re-running with no file changes rewrites nothing.

    python3 scripts/stamp-assets.py          # stamp, report what changed
    python3 scripts/stamp-assets.py --check  # exit 1 if stamps are stale
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

# src="js/thing.js" or href="css/main.css", with or without an existing ?v=
REF = re.compile(r'(?P<attr>\b(?:src|href)=")(?P<path>(?:js|css)/[A-Za-z0-9._-]+\.(?:js|css))(?:\?v=[A-Za-z0-9]+)?(?P<tail>")')


def digest(path: pathlib.Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()[:10]


def main() -> int:
    check_only = "--check" in sys.argv
    hashes: dict[str, str] = {}
    changed: list[str] = []
    missing: set[str] = set()

    for html in sorted(FRONTEND.glob("*.html")):
        original = html.read_text(encoding="utf-8")

        def sub(m: re.Match) -> str:
            rel = m.group("path")
            asset = FRONTEND / rel
            if not asset.is_file():
                missing.add(rel)                     # leave unknown refs alone
                return m.group(0)
            if rel not in hashes:
                hashes[rel] = digest(asset)
            return f'{m.group("attr")}{rel}?v={hashes[rel]}{m.group("tail")}'

        updated = REF.sub(sub, original)
        if updated != original:
            changed.append(html.name)
            if not check_only:
                html.write_text(updated, encoding="utf-8")

    for rel in sorted(missing):
        print(f"  warning: referenced but not found on disk: {rel}")

    if check_only:
        if changed:
            print("stamps are stale in: " + ", ".join(changed))
            print("run: python3 scripts/stamp-assets.py")
            return 1
        print("asset stamps are up to date")
        return 0

    for rel, h in sorted(hashes.items()):
        print(f"  {rel:<28} v={h}")
    print(f"updated {len(changed)} file(s)" + (": " + ", ".join(changed) if changed else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
