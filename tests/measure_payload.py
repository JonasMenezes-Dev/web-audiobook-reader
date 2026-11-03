"""Mede somente bytes/tempo de dados sintéticos, sem salvar conteúdo de PDFs."""
import asyncio
import json
import sys
import time
from pathlib import Path

import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'Backend'))
from main import _stream_pdf_processing


async def measure():
    results = []
    for pages in (50, 200):
        doc = fitz.open()
        for number in range(pages):
            page = doc.new_page()
            for line in range(35):
                page.insert_text((55, 80 + line * 18), f'Registro {number + 1}, linha {line + 1}: conteúdo acadêmico. Outra frase completa.', fontsize=10)
        contents = doc.tobytes()
        doc.close()
        row = {'pages': pages, 'pdf_bytes': len(contents)}
        for compact in (False, True):
            start = time.perf_counter()
            data = [line async for line in _stream_pdf_processing(contents, 'benchmark.pdf', compact=compact)]
            row['compact' if compact else 'full'] = {
                'bytes': sum(len(line.encode('utf-8')) for line in data),
                'seconds': time.perf_counter() - start,
            }
        row['reduction_percent'] = (1 - row['compact']['bytes'] / row['full']['bytes']) * 100
        results.append(row)
    output = ROOT / 'docs/melhorias-fases-4-6/payload.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    asyncio.run(measure())
