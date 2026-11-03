"""Matriz sintética de layouts acadêmicos; não mede precisão de documentos reais."""
import sys
from pathlib import Path

import pymupdf as fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'Backend'))
import main


CASES = [
    ('apostila', [(55, 150, '1. Introdução', 18, 'hebo'),
                  (55, 200, 'A aprendizagem reúne evidências.', 11, 'helv'),
                  (70, 215, 'Outro parágrafo começa com recuo.', 11, 'helv')],
     ['1. Introdução', 'A aprendizagem reúne evidências.', 'Outro parágrafo começa com recuo.']),
    ('duas_colunas', [(55, 200, 'Esquerda A.', 11, 'helv'), (55, 220, 'Esquerda B.', 11, 'helv'),
                     (55, 240, 'Esquerda C.', 11, 'helv'), (320, 200, 'Direita A.', 11, 'helv'),
                     (320, 220, 'Direita B.', 11, 'helv'), (320, 240, 'Direita C.', 11, 'helv')],
     ['Esquerda A.', 'Esquerda B.', 'Esquerda C.', 'Direita A.', 'Direita B.', 'Direita C.']),
    ('slide', [(55, 70, 'Resultados do estudo', 26, 'hebo'),
               (55, 160, 'Objetivo: comparar métodos.', 18, 'helv'),
               (55, 250, 'Resultado: 25% de melhoria.', 18, 'helv')],
     ['Resultados do estudo', 'Objetivo: comparar métodos.', 'Resultado: 25% de melhoria.']),
    ('referencias', [(55, 150, 'Referências', 16, 'hebo'),
                     (55, 200, 'Silva et al. (2024). Evidências acadêmicas.', 11, 'helv'),
                     (55, 240, 'https://universidade.example/busca?q=metodo&ano=2026', 9, 'helv'),
                     (55, 280, 'DOI: 10.1234/estudo.2026.12.', 11, 'helv')],
     ['Referências', 'Silva et al. (2024). Evidências acadêmicas.',
      'https://universidade.example/busca?q=metodo&ano=2026', 'DOI: 10.1234/estudo.2026.12.']),
    ('matematica_textual', [(55, 160, 'A hipótese usa p < 0,05.', 11, 'helv'),
                           (55, 200, 'E = m c^2; n = 125.', 11, 'helv')],
     ['A hipótese usa p < 0,05.', 'E = m c^2; n = 125.']),
]


@pytest.mark.parametrize('name,lines,expected', CASES, ids=[case[0] for case in CASES])
def test_known_academic_content_and_order(name, lines, expected):
    doc = fitz.open()
    page = doc.new_page(width=960, height=540) if name == 'slide' else doc.new_page()
    for x, y, text, size, font in lines:
        page.insert_text((x, y), text, fontsize=size, fontname=font)
    data = main._processar_pdf_completo(doc.tobytes(), name + '.pdf')
    doc.close()
    visible = ' '.join(segment['texto'] for block in data['blocos_leitura'] for segment in block['segmentos'])
    positions = [visible.index(text) for text in expected]
    assert positions == sorted(positions)
    for block in data['blocos_leitura']:
        for segment in block['segmentos']:
            assert ''.join(t['texto'] for t in segment['trechos']) == segment['texto']


def test_numeric_table_values_survive_without_claiming_table_semantics():
    doc = fitz.open()
    page = doc.new_page()
    for x, y, text in [(55, 160, 'Grupo'), (240, 160, 'Amostra'),
                       (55, 200, 'A'), (240, 200, '125'), (55, 240, 'B'), (240, 240, '25')]:
        page.insert_text((x, y), text, fontsize=11)
    data = main._processar_pdf_completo(doc.tobytes(), 'tabela.pdf')
    doc.close()
    visible = ' '.join(s['texto'] for b in data['blocos_leitura'] for s in b['segmentos'])
    assert all(value in visible for value in ('Grupo', 'Amostra', '125', '25'))
    # A extração preserva valores; não reconstrói células ou relações tabulares.


def test_hyphenation_styles_and_unique_footnote():
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((55, 160), 'A aprendi-', fontsize=11, fontname='hebo')
    page.insert_text((55, 175), 'zagem continua.', fontsize=11, fontname='hebo')
    page.insert_text((55, 790), 'Nota de rodapé: fonte acadêmica única.', fontsize=8, fontname='heit')
    data = main._processar_pdf_completo(doc.tobytes(), 'estilos.pdf')
    doc.close()
    visible = ' '.join(s['texto'] for b in data['blocos_leitura'] for s in b['segmentos'])
    assert 'aprendizagem' in visible and 'Nota de rodapé' in visible
    assert any(t['negrito'] for b in data['blocos_leitura'] for s in b['segmentos'] for t in s['trechos'])
    assert any(t['italico'] for b in data['blocos_leitura'] for s in b['segmentos'] for t in s['trechos'])
