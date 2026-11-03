"""Regressões acadêmicas reproduzidas na auditoria, sem documentos pessoais."""
import sys
from pathlib import Path

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'Backend'))
import main


def extract(lines):
    doc = fitz.open()
    page = doc.new_page()
    for x, y, text, size, font in lines:
        page.insert_text((x, y), text, fontsize=size, fontname=font)
    try:
        return main.reconstruir_estrutura_pdf(main.extrair_blocos_pdf(doc.tobytes()))
    finally:
        doc.close()


def test_table_numbers_in_body_survive():
    blocks = extract([(55, 200, 'Ano', 11, 'helv'), (180, 200, 'Quantidade', 11, 'helv'),
                      (55, 230, '2024', 11, 'helv'), (180, 230, '125', 11, 'helv')])
    text = ' '.join(b['texto'] for b in blocks)
    assert '2024' in text and '125' in text


def test_page_number_at_bottom_is_removed_without_body_loss():
    blocks = extract([(55, 200, '2024', 11, 'helv'), (290, 820, '1', 10, 'helv')])
    assert [b['texto'] for b in blocks] == ['2024']


def test_year_at_top_is_not_assumed_to_be_page_number():
    blocks = extract([(55, 40, '2024', 16, 'hebo'), (55, 200, 'Dados do estudo.', 11, 'helv'),
                      (290, 820, '1', 10, 'helv')])
    assert '2024' in ' '.join(b['texto'] for b in blocks)


def test_close_heading_is_separate_from_body():
    blocks = extract([(55, 165, 'Metodologia', 16, 'hebo'),
                      (55, 184, 'O método reúne evidências para avaliar a hipótese.', 11, 'helv')])
    assert [b['tipo'] for b in blocks] == ['titulo', 'paragrafo']
    assert blocks[0]['texto'] == 'Metodologia'


def test_paragraph_indent_preserves_boundary_but_wrapped_lines_stay_together():
    blocks = extract([(55, 165, 'Primeiro parágrafo termina aqui.', 11, 'helv'),
                      (70, 180, 'Outro parágrafo começa com recuo e', 11, 'helv'),
                      (55, 195, 'continua na linha seguinte.', 11, 'helv')])
    assert len(blocks) == 2
    assert blocks[1]['texto'] == 'Outro parágrafo começa com recuo e continua na linha seguinte.'


@pytest.mark.parametrize('text,expected', [
    ('O Prof. Silva consultou a p. 25. A Dra. Souza concordou.',
     ['O Prof. Silva consultou a p. 25.', 'A Dra. Souza concordou.']),
    ('Veja pp. 20-25, fig. 2 e vol. 3 de Silva et al. (2024). Depois compare.',
     ['Veja pp. 20-25, fig. 2 e vol. 3 de Silva et al. (2024).', 'Depois compare.']),
    ('A. B. Silva publicou os dados. Outra frase.', ['A. B. Silva publicou os dados.', 'Outra frase.']),
    ('https://universidade.example/artigo', ['https://universidade.example/artigo']),
    ('https://universidade.example/busca?q=metodo&ano=2026',
     ['https://universidade.example/busca?q=metodo&ano=2026']),
    ('Consulte https://universidade.example/artigo. Depois compare.',
     ['Consulte https://universidade.example/artigo.', 'Depois compare.']),
    ('DOI: 10.1234/estudo.2026.12. Outra frase.', ['DOI: 10.1234/estudo.2026.12.', 'Outra frase.']),
])
def test_academic_sentence_boundaries(text, expected):
    assert main.dividir_em_frases(text) == expected


def test_filtered_blocks_keep_styles_and_references_without_reintroducing_ads():
    structure = [
        {'tipo': 'titulo', 'texto': '1. Introdução', 'pagina': 0, 'trechos': []},
        {'tipo': 'paragrafo', 'texto': 'Conteúdo importante. Baixe nosso aplicativo agora.', 'pagina': 0,
         'trechos': [{'texto': 'Conteúdo ', 'negrito': False}, {'texto': 'importante.', 'negrito': True},
                     {'texto': ' Baixe nosso aplicativo agora.', 'negrito': False}]},
        {'tipo': 'paragrafo', 'texto': 'https://universidade.example/artigo', 'pagina': 1, 'trechos': []},
    ]
    result = main.filtrar_estrutura_para_leitura(structure)
    blocks = result['blocos_leitura']
    visible = ' '.join(s['texto'] for b in blocks for s in b['segmentos'])
    assert 'Baixe' not in visible
    assert 'https://universidade.example/artigo' in visible
    segments = [s for b in blocks for s in b['segmentos']]
    narrated = [s for s in segments if s['indice_frase'] is not None]
    assert [s['texto'] for s in narrated] == result['frases_filtradas']
    assert [s['indice_frase'] for s in narrated] == list(range(len(narrated)))
    assert any(t['negrito'] and t['texto'] == 'importante.' for s in segments for t in s['trechos'])
    assert blocks[0]['tipo'] == 'titulo'
    assert blocks[-1]['pagina'] == 1
    assert blocks[-1]['segmentos'][0]['indice_frase'] is None


def test_api_returns_safe_blocks_and_clear_scanned_pdf_error():
    doc = fitz.open()
    doc.new_page()
    try:
        with pytest.raises(ValueError, match='texto|OCR'):
            main._processar_pdf_completo(doc.tobytes(), 'sem-texto.pdf')
    finally:
        doc.close()


def test_http_contract_preserves_query_reference_and_reports_missing_text():
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((55, 160), 'Referências', fontsize=16, fontname='hebo')
    address = 'https://universidade.example/busca?q=metodo&ano=2026'
    page.insert_text((55, 200), address, fontsize=10)
    contents = doc.tobytes()
    doc.close()
    with TestClient(main.app) as client:
        response = client.post('/upload-pdf/', files={'file': ('referencia.pdf', contents, 'application/pdf')})
        assert response.status_code == 200
        data = response.json()
        assert data['versao_estrutura'] == 1
        reference = data['blocos_leitura'][-1]['segmentos'][0]
        assert reference['texto'] == address
        assert reference['indice_frase'] is None
        assert not any('q=metodo' in sentence for sentence in data['sentences'])
        empty = fitz.open()
        empty.new_page()
        contents = empty.tobytes()
        empty.close()
        response = client.post('/upload-pdf/', files={'file': ('digitalizado.pdf', contents, 'application/pdf')})
        assert response.status_code == 422
        assert 'OCR' in response.json()['detail']


def test_compact_stream_preserves_safe_blocks_without_duplicate_raw_text():
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((55, 160), 'Conteúdo para comparar. Outra frase preservada.')
    contents = doc.tobytes()
    doc.close()
    import json
    with TestClient(main.app) as client:
        upload = {'file': ('aula.pdf', contents, 'application/pdf')}
        full = client.post('/upload-pdf-progress/', files=upload)
        compact = client.post('/upload-pdf-progress/?compact=true', files=upload)
    full_result = next(json.loads(line)['data'] for line in full.text.splitlines() if json.loads(line)['type'] == 'result')
    compact_result = next(json.loads(line)['data'] for line in compact.text.splitlines() if json.loads(line)['type'] == 'result')
    assert compact_result['blocos_leitura'] == full_result['blocos_leitura']
    assert not {'estrutura', 'texto_limpo', 'sentences_original', 'classificacoes_conteudo', 'sentences'} & compact_result.keys()
    assert compact_result['total_frases'] == full_result['total_frases']
    assert len(compact.content) < len(full.content)
