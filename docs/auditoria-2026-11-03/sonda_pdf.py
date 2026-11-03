"""Casos sintéticos e medições reproduzíveis; nenhum PDF pessoal é utilizado."""
import json
import statistics
import sys
import time
from pathlib import Path

import pymupdf as fitz

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
from Backend.main import _processar_pdf_completo, reconstruir_estrutura_pdf, extrair_blocos_pdf, dividir_em_frases


def document(lines):
    doc = fitz.open()
    page = doc.new_page()
    for x, y, text, size, font in lines:
        page.insert_text((x, y), text, fontsize=size, fontname=font)
    return doc


study = document([
    (55, 65, '1. Introdução', 18, 'hebo'),
    (55, 110, 'O estudo científico organiza evidências. Esta é a segunda frase do primeiro parágrafo.', 11, 'helv'),
    (55, 150, 'Este é outro parágrafo. Ele precisa aparecer separado na plataforma.', 11, 'helv'),
    (55, 200, '2. Metodologia', 17, 'hebo'),
    (55, 240, 'O Prof. Silva consultou a p. 25 e comparou 3,14 com 2.5.', 11, 'helv'),
    (55, 280, 'Resultado importante em negrito', 11, 'hebo'),
    (55, 320, 'Amostra: 25%. Custo: R$ 1.250,50. Data: 21/10/2026.', 11, 'helv'),
    (55, 365, 'Referências', 17, 'hebo'),
    (55, 405, 'https://universidade.example/artigo', 11, 'helv'),
])
study.save(HERE / 'estudo-sintetico.pdf')
pix = study[0].get_pixmap(matrix=fitz.Matrix(1.3, 1.3))
pix.save(HERE / '00-pdf-original.png')
study.close()
(HERE / 'estudo-sintetico.txt').write_text(
    '1. Introdução\n\nO estudo científico organiza evidências. Esta é a segunda frase do primeiro parágrafo.\n\n'
    'Este é outro parágrafo. Ele precisa aparecer separado na plataforma.\n\n2. Metodologia\n\n'
    'O Prof. Silva consultou a p. 25 e comparou 3,14 com 2.5.\n\nReferências\n\n'
    'https://universidade.example/artigo', encoding='utf-8')

cases = {
    'titulo_proximo_ao_corpo': [(55, 65, 'Metodologia', 16, 'hebo'), (55, 84, 'O método reúne evidências para avaliar a hipótese.', 11, 'helv')],
    'paragrafos_com_recuo_de_15pt': [(55, 65, 'Primeiro parágrafo termina aqui.', 11, 'helv'), (70, 80, 'Outro parágrafo começa com recuo.', 11, 'helv')],
    'valores_isolados_em_tabela': [(55, 65, 'Ano', 11, 'helv'), (180, 65, 'Quantidade', 11, 'helv'), (55, 95, '2024', 11, 'helv'), (180, 95, '125', 11, 'helv')],
}
result = {'cases': {}, 'abbreviations': dividir_em_frases('O Prof. Silva consultou a p. 25. A Dra. Souza concordou.'), 'benchmarks': []}
for name, lines in cases.items():
    doc = document(lines)
    data = _processar_pdf_completo(doc.tobytes(), name + '.pdf')
    result['cases'][name] = {'estrutura': data['estrutura'], 'sentences': data['sentences']}
    doc.close()
study_data = _processar_pdf_completo((HERE/'estudo-sintetico.pdf').read_bytes(), 'estudo-sintetico.pdf')
result['study'] = study_data
for pages in [1, 50, 200, 500]:
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page()
        for line in range(35):
            page.insert_text((55, 65+line*18), f'Experimento {i+1}, registro {line+1}: dados científicos para estudo. Outra frase.', fontsize=11)
    contents = doc.tobytes()
    runs = []
    for _ in range(3):
        start = time.perf_counter()
        data = _processar_pdf_completo(contents, 'benchmark.pdf')
        runs.append(time.perf_counter()-start)
    result['benchmarks'].append({'pages': pages, 'pdf_bytes': len(contents), 'seconds': runs, 'median_seconds': statistics.median(runs), 'sentences': len(data['sentences']), 'response_bytes': len(json.dumps(data, ensure_ascii=False).encode('utf-8'))})
    doc.close()
(HERE/'evidencias-pdf.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'cases': {k: {'types': [e['tipo'] for e in v['estrutura']], 'text': [e['texto'] for e in v['estrutura']]} for k,v in result['cases'].items()}, 'abbreviations':result['abbreviations'], 'benchmarks':result['benchmarks']},ensure_ascii=False,indent=2))
