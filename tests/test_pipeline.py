"""Testes automatizados do pipeline (Etapa 14 do plano).

Cobre as regras que definimos:
  - limpeza: cabecalho/rodape/numero de pagina removidos
  - frases: numeros com separador NAO sao cortados
  - fila TTS: ordem sequencial, sem pular/duplicar
  - velocidade: 1.25x presente e ciclo estavel

Uso:  python -m pytest tests/test_pipeline.py -v
"""
import os
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf as fitz
import pytest
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "Backend"))

from pypdf import PdfReader  # noqa: E402  (precisa vir apos o sys.path.insert)

PDF = os.path.join(ROOT, "tests", "fixtures", "regressao.pdf")
SCRIPT_JS = Path(ROOT, "script.js")

# --- importa as funcoes puras de main.py sem puxar mysql/fastapi ---
_MAIN_PY = Path(__file__).resolve().parent.parent.joinpath("Backend", "main.py")
_src = _MAIN_PY.read_text(encoding="utf-8")
_ns = {"re": re, "Counter": Counter, "fitz": fitz}


def _extract_fn(src, name):
    start = src.index("def " + name + "(")
    lines = src[start:].splitlines()
    body = [lines[0]]
    for line in lines[1:]:
        if line and not line.startswith((" ", "\t")):
            break
        body.append(line)
    return "\n".join(body)


for _fn in ("limpar_texto_pdf", "_detectar_cabecalho_rodape",
            "_parece_titulo", "dividir_em_frases", "extrair_blocos_pdf",
            "ordenar_blocos", "reconstruir_estrutura_pdf",
            "_detectar_margens_blocos", "_ordenar_linhas_colunas",
            "_texto_da_linha", "_span_negrito", "_trechos_da_linha"):
    exec(_extract_fn(_src, _fn), _ns)

limpar_texto_pdf = _ns["limpar_texto_pdf"]
dividir_em_frases = _ns["dividir_em_frases"]
extrair_blocos_pdf = _ns["extrair_blocos_pdf"]
reconstruir_estrutura_pdf = _ns["reconstruir_estrutura_pdf"]


@pytest.fixture(scope="module")
def pdf():
    reader = PdfReader(PDF)
    paginas = [(p.extract_text() or "") for p in reader.pages]
    bruto = "\n".join(paginas)
    limpo = limpar_texto_pdf(bruto, paginas=paginas)
    return bruto, limpo, dividir_em_frases(limpo)


# --------------------------- limpeza ---------------------------

def test_remove_cabecalho(pdf):
    _, limpo, _ = pdf
    assert "MANUAL DE TESTE" not in limpo


def test_remove_rodape(pdf):
    _, limpo, _ = pdf
    assert "uso interno" not in limpo


def test_remove_numero_de_pagina(pdf):
    _, limpo, _ = pdf
    assert not re.search(r"^\s*\d\s*$", limpo, re.M)


def test_preserva_conteudo(pdf):
    _, limpo, _ = pdf
    for chave in ["CAPITULO 1", "italico", "negrito", "2026", "25%", "1.250,50", "21/10/2026"]:
        assert chave in limpo, f"conteudo perdido: {chave}"


# --------------------------- divisao em frases ---------------------------

def test_nao_corta_decimal(pdf):
    _, _, frases = pdf
    assert any("R$ 1.250,50" in f for f in frases), "decimal foi cortado"
    assert not any(f.strip() in ("O valor e R$ 1.", "250,50.") for f in frases)


def test_nao_corta_milhar(pdf):
    _, _, frases = pdf
    assert any("1.500" in f for f in frases), "milhar foi cortado"


def test_parenteses_integridade(pdf):
    _, _, frases = pdf
    alvo = [f for f in frases if "Random Access Memory" in f]
    assert alvo, "frase com parenteses sumiu"
    assert "(" in alvo[0] and ")" in alvo[0]
    assert "Random Access Memory" in alvo[0]


def test_sem_duplicatas(pdf):
    _, _, frases = pdf
    dup = [f for f, c in Counter(frases).items() if c > 1]
    assert not dup, f"frases duplicadas: {dup}"


def test_split_basico():
    assert dividir_em_frases("Frase um. Frase dois! Duvida? Sim.") == \
        ["Frase um.", "Frase dois!", "Duvida?", "Sim."]


def test_numeracao_datas_e_valores_preservados_na_ordem():
    texto = (
        "1. Introdução\n\n"
        "Este é um texto normal.\n\n"
        "2.4.5 Interrupções\n\n"
        "Este é um texto com uma palavra em negrito.\n\n"
        "Este é um texto com uma palavra em itálico.\n\n"
        "3.1.2 Procedimento\n\n"
        "O valor é R$ 1.250,50.\n\n"
        "A data é 21/10/2026.\n\n"
        "A taxa é 25%.\n\n"
        "O número é 10.000."
    )
    assert dividir_em_frases(texto) == [
        "1. Introdução",
        "Este é um texto normal.",
        "2.4.5 Interrupções",
        "Este é um texto com uma palavra em negrito.",
        "Este é um texto com uma palavra em itálico.",
        "3.1.2 Procedimento",
        "O valor é R$ 1.250,50.",
        "A data é 21/10/2026.",
        "A taxa é 25%.",
        "O número é 10.000.",
    ]
    assert _ns["_parece_titulo"]("2.4.5 Interrupções")


def test_extracao_estrutural_preserva_posicao_e_formatacao():
    blocos = extrair_blocos_pdf(Path(PDF).read_bytes())
    estrutura = reconstruir_estrutura_pdf(blocos)
    texto = "\n\n".join(item["texto"] for item in estrutura)

    assert blocos
    assert all(
        {"pagina", "x", "y", "x1", "y1", "texto", "fonte", "tamanho", "flags"}
        <= bloco.keys()
        for bloco in blocos
    )
    assert "italico" in texto and "negrito" in texto
    assert "MANUAL DE TESTE" not in texto
    assert "uso interno" not in texto
    assert any(
        trecho["italico"]
        for item in estrutura
        for trecho in item["trechos"]
    )
    assert any(
        trecho["negrito"]
        for item in estrutura
        for trecho in item["trechos"]
    )

    ordem = ["ESQUERDA A", "ESQUERDA B", "ESQUERDA C", "DIREITA A", "DIREITA B", "DIREITA C"]
    indices = [next(i for i, item in enumerate(estrutura) if marcador in item["texto"])
               for marcador in ordem]
    assert indices == sorted(indices)


def test_pdf_sintetico_preserva_estrutura_estilos_e_ordem(tmp_path):
    conteudo = [
        "1. Introdução",
        "Este é um texto normal.",
        "2.4.5 Interrupções",
        "Este é um texto com uma palavra em <b>negrito</b>.",
        "Este é um texto com uma palavra em <i>itálico</i>.",
        "3.1.2 Procedimento",
        "O valor é R$ 1.250,50.",
        "A data é 21/10/2026.",
        "A taxa é 25%.",
        "O número é 10.000.",
    ]
    caminho = tmp_path / "pipeline-estrutural.pdf"
    documento = canvas.Canvas(str(caminho), pagesize=A4)
    estilo = ParagraphStyle("body", fontName="Helvetica", fontSize=11, leading=14)
    y = A4[1] - 36
    for texto in conteudo:
        paragrafo = Paragraph(texto, estilo)
        _, altura = paragrafo.wrap(A4[0] - 72, A4[1])
        paragrafo.drawOn(documento, 36, y - altura)
        y -= altura + 14
    documento.save()

    blocos = extrair_blocos_pdf(str(caminho))
    estrutura = reconstruir_estrutura_pdf(blocos)
    texto = "\n\n".join(item["texto"] for item in estrutura)
    assert dividir_em_frases(texto) == [
        "1. Introdução",
        "Este é um texto normal.",
        "2.4.5 Interrupções",
        "Este é um texto com uma palavra em negrito.",
        "Este é um texto com uma palavra em itálico.",
        "3.1.2 Procedimento",
        "O valor é R$ 1.250,50.",
        "A data é 21/10/2026.",
        "A taxa é 25%.",
        "O número é 10.000.",
    ]
    assert any(item["tipo"] == "titulo" and "2.4.5 Interrupções" in item["texto"]
               for item in estrutura)
    assert any(trecho["negrito"] for item in estrutura for trecho in item["trechos"])
    assert any(trecho["italico"] for item in estrutura for trecho in item["trechos"])


# --------------------------- ordem ---------------------------

def test_ordem_colunas(pdf):
    """Coluna esquerda deve vir inteira antes da direita."""
    _, _, frases = pdf
    ordem = ["ESQUERDA A", "ESQUERDA B", "ESQUERDA C", "DIREITA A", "DIREITA B", "DIREITA C"]
    idx = [next(i for i, f in enumerate(frases) if c in f) for c in ordem]
    assert idx == sorted(idx), f"colunas fora de ordem: {idx}"


def test_ordem_capitulos(pdf):
    _, _, frases = pdf
    idx = [next((i for i, f in enumerate(frases) if c in f), -1) for c in
           ["CAPITULO 1", "Capitulo 2", "Capitulo 3"]]
    assert all(i >= 0 for i in idx) and idx == sorted(idx), f"capitulos fora de ordem: {idx}"


def test_titulo_isolado(pdf):
    """O titulo nao deve vir colado ao paragrafo seguinte."""
    _, _, frases = pdf
    titulo = next(f for f in frases if "CAPITULO 1" in f)
    assert titulo.strip().rstrip(".") == "CAPITULO 1 - O INICIO", \
        f"titulo colado ao texto: {titulo!r}"


# --------------------------- velocidade ---------------------------

def test_velocidades_incluem_125():
    src = SCRIPT_JS.read_text(encoding="utf-8")
    m = re.search(r"const SPEEDS = \[([^\]]+)\]", src)
    assert m, "SPEEDS nao encontrada em script.js"
    valores = [float(x) for x in m.group(1).split(",")]
    assert 1.25 in valores, f"1.25 ausente: {valores}"
    assert 1.0 in valores and 1.5 in valores and 2.0 in valores
    assert 0.7 in valores


def test_speak_nao_cancela_a_cada_fala():
    """speak() nao deve chamar cancel() — isso pulava trechos."""
    src = SCRIPT_JS.read_text(encoding="utf-8")
    ini = src.index("function speak()")
    fim = src.index("function cancelSpeech()")
    corpo = src[ini:fim]
    assert "speechSynthesis.cancel()" not in corpo, (
        "speak() ainda cancela a fala a cada chamada (causa de trechos pulados)"
    )
