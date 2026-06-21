#!/usr/bin/env python3
"""Five-point self-check for a CJK-safe PDF produced by render.mjs.

Checks, in order:
  1. File starts with the %PDF- magic bytes (it is a real PDF).
  2. Page count >= 1 and the document parses with pypdf.
  3. CJK text is extractable from the first and last page (no tofu / mojibake /
     image-only output). Skipped only if --no-cjk is passed.
  4. No browser print footer leaked in (the "file:///..." URL band that Edge /
     Chrome inject when --no-pdf-header-footer is forgotten).
  5. Some real text content is present (guards against a blank render).

Exit code 0 only if every applicable check passes; 1 otherwise.

Usage:
  python verify.py <file.pdf> [--no-cjk] [--min-pages N]

Requires: pypdf  (pip install pypdf)
"""
import argparse
import re
import sys

CJK_RE = re.compile(r'[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]')
# A leaked browser footer shows the source file URL on the page text layer.
FOOTER_RE = re.compile(r'file:///', re.IGNORECASE)


def fail(msg):
    print(f'  [FAIL] {msg}')


def ok(msg):
    print(f'  [ ok ] {msg}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--no-cjk', action='store_true',
                    help='skip the CJK-extractable check (non-CJK documents)')
    ap.add_argument('--min-pages', type=int, default=1)
    args = ap.parse_args()

    passed = True

    # 1. magic bytes
    try:
        with open(args.pdf, 'rb') as fh:
            head = fh.read(5)
    except OSError as e:
        fail(f'cannot open file: {e}')
        sys.exit(1)
    if head.startswith(b'%PDF-'):
        ok('1/5 %PDF- header present')
    else:
        fail(f'1/5 not a PDF (header={head!r})')
        passed = False

    # 2. parses + page count
    try:
        from pypdf import PdfReader
    except ImportError:
        fail('pypdf not installed (pip install pypdf)')
        sys.exit(1)
    try:
        reader = PdfReader(args.pdf)
        n = len(reader.pages)
    except Exception as e:  # noqa: BLE001 - report any parse failure
        fail(f'2/5 pypdf cannot parse: {e}')
        sys.exit(1)
    if n >= args.min_pages:
        ok(f'2/5 parsed, {n} page(s)')
    else:
        fail(f'2/5 only {n} page(s), expected >= {args.min_pages}')
        passed = False

    first_text = reader.pages[0].extract_text() or ''
    last_text = reader.pages[-1].extract_text() or ''
    all_text = '\n'.join((p.extract_text() or '') for p in reader.pages)

    # 3. CJK extractable on first + last page
    if args.no_cjk:
        ok('3/5 CJK check skipped (--no-cjk)')
    elif CJK_RE.search(first_text) and CJK_RE.search(last_text):
        ok('3/5 CJK extractable on first and last page')
    else:
        where = []
        if not CJK_RE.search(first_text):
            where.append('first')
        if not CJK_RE.search(last_text):
            where.append('last')
        fail(f'3/5 no extractable CJK on {"+".join(where)} page '
             '(image-only render or missing fonts?)')
        passed = False

    # 4. no leaked browser footer
    if FOOTER_RE.search(all_text):
        fail('4/5 browser print footer leaked (re-render with '
             '--no-pdf-header-footer)')
        passed = False
    else:
        ok('4/5 no browser footer')

    # 5. non-blank
    if len(all_text.strip()) >= 10:
        ok(f'5/5 text content present ({len(all_text.strip())} chars)')
    else:
        fail('5/5 document appears blank')
        passed = False

    print('PASS' if passed else 'FAIL')
    sys.exit(0 if passed else 1)


if __name__ == '__main__':
    main()
