"""Testes automatizados do pipeline (Etapa 14 do plano).

Cobre as regras que definimos:
  - limpeza: cabecalho/rodape/numero de pagina removidos
  - frases: numeros com separador NAO sao cortados
  - fila TTS: ordem sequencial, sem pular/duplicar
  - velocidade: 1.25x presente e ciclo estavel

Uso:  python -m pytest tests/test_pipeline.py -v
"""
import json
import os
import re
import shutil
import subprocess
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
            "_texto_da_linha", "_span_negrito", "_trechos_da_linha",
            "classificar_conteudo", "_contextos_estrutura_para_leitura",
            "filtrar_estrutura_para_leitura"):
    exec(_extract_fn(_src, _fn), _ns)

limpar_texto_pdf = _ns["limpar_texto_pdf"]
dividir_em_frases = _ns["dividir_em_frases"]
extrair_blocos_pdf = _ns["extrair_blocos_pdf"]
reconstruir_estrutura_pdf = _ns["reconstruir_estrutura_pdf"]
classificar_conteudo = _ns["classificar_conteudo"]
filtrar_estrutura_para_leitura = _ns["filtrar_estrutura_para_leitura"]

SPLITTER_CASES = [
    (
        "Esta é uma frase normal longa, com várias informações e orações subordinadas, "
        "para verificar se o texto continua em um único trecho até chegar ao ponto final.",
        [
            "Esta é uma frase normal longa, com várias informações e orações subordinadas, "
            "para verificar se o texto continua em um único trecho até chegar ao ponto final."
        ],
    ),
    (
        "O processo começou... depois continuou normalmente.",
        ["O processo começou... depois continuou normalmente."],
    ),
    (
        'Ele escreveu "texto" e prosseguiu com a explicação.',
        ['Ele escreveu "texto" e prosseguiu com a explicação.'],
    ),
    (
        'Ela respondeu: "texto." Depois continuou a conversa.',
        ['Ela respondeu: "texto."', "Depois continuou a conversa."],
    ),
    (
        'Ela respondeu: "texto!" Depois continuou a conversa.',
        ['Ela respondeu: "texto!"', "Depois continuou a conversa."],
    ),
    (
        'Ela respondeu: "texto?" Depois continuou a conversa.',
        ['Ela respondeu: "texto?"', "Depois continuou a conversa."],
    ),
    (
        'Ela respondeu: "texto..." Depois continuou a conversa.',
        ['Ela respondeu: "texto..." Depois continuou a conversa.'],
    ),
    (
        "A memória RAM (Random Access Memory) armazena dados temporariamente.",
        ["A memória RAM (Random Access Memory) armazena dados temporariamente."],
    ),
    (
        "Consulte a seção 2.4.5 Interrupções.",
        ["Consulte a seção 2.4.5 Interrupções."],
    ),
    ("1. Introdução", ["1. Introdução"]),
    ("3.2.1 Procedimentos", ["3.2.1 Procedimentos"]),
    ("O valor é R$ 1.250,50.", ["O valor é R$ 1.250,50."]),
    ("A data é 21/10/2026.", ["A data é 21/10/2026."]),
    ("O número é 10.000.", ["O número é 10.000."]),
]


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


@pytest.mark.parametrize(("entrada", "esperado"), SPLITTER_CASES)
def test_splitter_backend_regressoes(entrada, esperado):
    assert dividir_em_frases(entrada) == esperado


def test_splitter_frontend_regressoes():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js não está disponível para executar o splitter frontend")

    script = (Path(ROOT) / "script.js").read_text(encoding="utf-8")
    function = re.search(
        r"function splitIntoSentences\(text\) \{[\s\S]*?\n\}",
        script,
    )
    assert function, "splitIntoSentences não encontrada em script.js"

    entradas = [entrada for entrada, _ in SPLITTER_CASES]
    programa = (
        f"{function.group(0)}\n"
        f"const entradas = {json.dumps(entradas, ensure_ascii=True)};\n"
        "process.stdout.write(JSON.stringify(entradas.map(splitIntoSentences)));"
    )
    resultado = subprocess.run(
        [node, "-e", programa],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    saidas = json.loads(resultado.stdout)
    assert saidas == [esperado for _, esperado in SPLITTER_CASES]


def test_splitter_nao_descarta_frases_legitimamente_curtas():
    assert dividir_em_frases("Oi. Sim.") == ["Oi.", "Sim."]


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


@pytest.mark.parametrize(
    ("texto", "tipo", "ignorar"),
    [
        ("Baixe nosso aplicativo agora.", "PROPAGANDA", True),
        ("Baixe o aplicativo e continue sua leitura.", "PROPAGANDA", True),
        ("https://exemplo.com", "URL", True),
        ("www.exemplo.com", "URL", True),
        (
            "This Document has been modified with Flexcil app (Android) "
            "https://www.flexcil.com",
            "LIXO_TECNICO",
            True,
        ),
        (
            "Flexcil - The Smart Study Toolkit & PDF, Annotate, Note",
            "LIXO_TECNICO",
            True,
        ),
        ("https://www.flexcil.com", "URL", True),
        ("Leia também no nosso aplicativo.", "PROPAGANDA", True),
        ("Ada Lovelace foi uma matemática inglesa.", "NORMAL", False),
        ("A linguagem Ada foi criada em 1982.", "NORMAL", False),
        ("Para mais informações, consulte a bibliografia.", "NORMAL", False),
        (
            "Para saber mais sobre Ada Lovelace, consulte https://exemplo.com.",
            "NORMAL",
            False,
        ),
        ("O conteúdo do site explica o contexto histórico.", "NORMAL", False),
        ("A visão das plantas", "NORMAL", False),
        ("O aplicativo foi desenvolvido para organizar os estudos.", "NORMAL", False),
        (
            "A pesquisa está disponível em https://exemplo.com para consulta.",
            "NORMAL",
            False,
        ),
    ],
)
def test_classificador_conteudo(texto, tipo, ignorar):
    resultado = classificar_conteudo(texto)

    assert resultado["tipo"] == tipo
    assert resultado["ignorar"] is ignorar
    assert isinstance(resultado["score"], int)
    assert isinstance(resultado["sinais"], list)


def test_pipeline_estrutura_splitter_filtro_preserva_ordem_e_originais():
    estrutura = [
        {"tipo": "paragrafo", "texto": "Ada Lovelace foi uma matemática inglesa."},
        {"tipo": "paragrafo", "texto": "Baixe nosso aplicativo agora."},
        {"tipo": "paragrafo", "texto": "A linguagem Ada foi criada em 1982."},
    ]

    resultado = filtrar_estrutura_para_leitura(estrutura)

    assert resultado["frases_originais"] == [
        "Ada Lovelace foi uma matemática inglesa.",
        "Baixe nosso aplicativo agora.",
        "A linguagem Ada foi criada em 1982.",
    ]
    assert resultado["frases_filtradas"] == [
        "Ada Lovelace foi uma matemática inglesa.",
        "A linguagem Ada foi criada em 1982.",
    ]
    assert [item["tipo"] for item in resultado["classificacoes"]] == [
        "NORMAL",
        "PROPAGANDA",
        "NORMAL",
    ]
    assert estrutura[1]["texto"] == "Baixe nosso aplicativo agora."


@pytest.mark.parametrize(
    "livro",
    [
        [
            "Crime e Castigo",
            "Dostoiévski, Fiódor",
            "9788588808850",
            "608 páginas",
            "Compre agora e leia",
            "Nova tradução direto do russo, em edição especial.",
        ],
        [
            "O espelho e a luz",
            "Hilary Mantel",
            "9786559212345",
            "912 páginas",
            "Compre agora e leia",
            "Uma narrativa histórica em edição especial.",
        ],
    ],
)
def test_catalogo_editorial_e_classificado_com_contexto(livro):
    estrutura = [{"tipo": "paragrafo", "texto": texto, "pagina": 8} for texto in livro]

    resultado = filtrar_estrutura_para_leitura(estrutura)

    assert resultado["frases_filtradas"] == []
    assert all(
        item["tipo"] == "PROPAGANDA"
        and item["score"] >= 6
        and item["ignorar"]
        for item in resultado["classificacoes"]
    )


def test_cta_de_compra_sem_contexto_de_catalogo_nao_e_suficiente():
    resultado = filtrar_estrutura_para_leitura([
        {"tipo": "paragrafo", "texto": "Compre agora e leia."},
    ])

    assert resultado["classificacoes"][0]["tipo"] == "NORMAL"
    assert resultado["frases_filtradas"] == ["Compre agora e leia."]


def test_url_do_flexcil_isolada_nao_vira_propaganda_ou_lixo_tecnico():
    resultado = classificar_conteudo(
        "https://www.flexcil.com",
        visualmente_separado=True,
    )

    assert resultado["tipo"] == "URL"
    assert resultado["tipo"] != "LIXO_TECNICO"
    assert resultado["tipo"] != "PROPAGANDA"


def test_flexcil_repetido_em_paginas_e_removido_sem_descartar_url_isolada():
    marca = (
        "This Document has been modified with Flexcil app (Android)"
    )
    estrutura = [
        {"tipo": "paragrafo", "texto": "A visão das plantas", "pagina": 0},
        {"tipo": "paragrafo", "texto": marca, "pagina": 0},
        {"tipo": "paragrafo", "texto": "O jardim permanecia em silêncio.", "pagina": 0},
        {"tipo": "paragrafo", "texto": marca, "pagina": 1},
        {"tipo": "paragrafo", "texto": "A manhã chegou devagar.", "pagina": 1},
    ]

    resultado = filtrar_estrutura_para_leitura(estrutura)

    assert [item["tipo"] for item in resultado["classificacoes"]] == [
        "NORMAL",
        "LIXO_TECNICO",
        "NORMAL",
        "LIXO_TECNICO",
        "NORMAL",
    ]
    assert resultado["frases_filtradas"] == [
        "A visão das plantas",
        "O jardim permanecia em silêncio.",
        "A manhã chegou devagar.",
    ]
    assert resultado["classificacoes"][1]["pagina"] == 0
    assert resultado["classificacoes"][3]["pagina"] == 1


def test_filtro_remove_promocao_e_lixo_mantendo_ordem_dos_normais():
    marca = "Flexcil - The Smart Study Toolkit & PDF, Annotate, Note"
    estrutura = [
        {"tipo": "paragrafo", "texto": "A visão das plantas"},
        {"tipo": "paragrafo", "texto": "Crime e Castigo"},
        {"tipo": "paragrafo", "texto": "Dostoiévski, Fiódor"},
        {"tipo": "paragrafo", "texto": "9788588808850"},
        {"tipo": "paragrafo", "texto": "608 páginas"},
        {"tipo": "paragrafo", "texto": "Compre agora e leia"},
        {"tipo": "paragrafo", "texto": "Nova tradução direto do russo."},
        {"tipo": "paragrafo", "texto": "A narrativa prossegue no jardim"},
        {"tipo": "paragrafo", "texto": marca},
        {"tipo": "paragrafo", "texto": "O silêncio voltou à casa."},
    ]

    resultado = filtrar_estrutura_para_leitura(estrutura)

    assert [item["tipo"] for item in resultado["classificacoes"]] == [
        "NORMAL",
        "PROPAGANDA",
        "PROPAGANDA",
        "PROPAGANDA",
        "PROPAGANDA",
        "PROPAGANDA",
        "PROPAGANDA",
        "NORMAL",
        "LIXO_TECNICO",
        "NORMAL",
    ]
    assert resultado["frases_filtradas"] == [
        "A visão das plantas",
        "A narrativa prossegue no jardim",
        "O silêncio voltou à casa.",
    ]


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


def test_reconstrucao_agrupa_callout_antes_da_continuacao():
    spans = []

    def adicionar(bloco, linha, texto, x, y, x1, fonte="Cambria", tamanho=9, flags=4):
        spans.append({
            "pagina": 0,
            "altura_pagina": 842,
            "bloco": bloco,
            "linha": linha,
            "x": x,
            "y": y,
            "x1": x1,
            "y1": y + tamanho,
            "texto": texto,
            "fonte": fonte,
            "tamanho": tamanho,
            "flags": flags,
        })

    adicionar(1, 0, "VOCÊ O CONHECE?", 62, 533, 221, "Cambria-Bold", 18.8, 20)
    adicionar(
        2, 0,
        "A matemática e escritora inglesa Ada Lovelace foi a primeira pessoa "
        "a escrever um algoritmo",
        152, 563, 518,
    )
    adicionar(
        2, 1,
        "para computador. Em sua homenagem, foi atribuído o seu nome à uma linguagem de",
        152, 576, 518,
    )
    adicionar(2, 2, "programação. A linguagem ", 152, 590, 261)
    adicionar(2, 6, "Ada", 262, 590, 279)
    adicionar(2, 3, " foi criada em 1982, teve como base o ", 277, 590, 434)
    adicionar(2, 7, "Cobol", 435, 590, 459)
    adicionar(2, 4, " e o ", 458, 590, 475)
    adicionar(2, 8, "Basic", 477, 590, 499)
    adicionar(2, 5, " e foi", 497, 590, 518)
    adicionar(2, 9, "referência para a criação da linguagem de programação ", 152, 603, 376)
    adicionar(2, 11, "Ruby", 377, 603, 399)
    adicionar(2, 10, " (PORTAL EBC). Saiba mais na", 397, 603, 518)
    adicionar(2, 12, "matéria: <", 152, 617, 205)
    adicionar(2, 13, "http://www.ebc.com.br/tecnologia/2015/03/conheca-historia-da-ada-lovelace-",
             205, 617, 518)
    adicionar(2, 14, "primeira-programadora-do-mundo", 152, 630, 288)
    adicionar(2, 15, ">.", 288, 630, 295)
    adicionar(
        3, 0,
        "A partir de agora, vamos observar que a evolução das gerações dos "
        "computadores terá inúmeras consequências,",
        62, 702, 533,
    )
    adicionar(
        3, 1,
        "não somente no impacto positivo do poderio de processamento, quanto "
        "também nas funcionalidades exportadas",
        62, 716, 533,
    )

    estrutura = reconstruir_estrutura_pdf(spans)
    indice_titulo = next(i for i, item in enumerate(estrutura)
                         if item["texto"] == "VOCÊ O CONHECE?")
    indice_caixa = next(i for i, item in enumerate(estrutura)
                        if "A matemática e escritora inglesa Ada Lovelace" in item["texto"])
    indice_continuacao = next(i for i, item in enumerate(estrutura)
                              if item["texto"].startswith("A partir de agora"))

    assert estrutura[indice_titulo]["tipo"] == "titulo"
    assert indice_titulo < indice_caixa < indice_continuacao
    texto_caixa = estrutura[indice_caixa]["texto"]
    assert "Ada foi criada em 1982" in texto_caixa
    assert "PORTAL EBC" in texto_caixa
    assert "primeira-programadora-do-mundo" in texto_caixa


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
