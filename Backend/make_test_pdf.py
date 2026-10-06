"""Gera o PDF de teste/regressao do AudioLivro Pro.

Contem todos os casos exigidos pela Etapa 8 do plano:
titulo, subtitulo, paragrafos, italico, negrito, numeros, datas,
valores monetarios, porcentagens, parenteses, cabecalho, rodape,
numero de pagina, duas colunas, frases curtas e longas.

Uso:  python Backend/make_test_pdf.py
Saida: tests/fixtures/regressao.pdf
"""
import os

from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tests", "fixtures"
)
OUT = os.path.join(OUT_DIR, "regressao.pdf")

W, H = A4
HEADER = "AUDIOLIVRO PRO - MANUAL DE TESTE"
FOOTER = "Documento de regressao - uso interno"

BODY = ParagraphStyle(
    'BODY', fontName='Helvetica', fontSize=11, leading=16, alignment=TA_JUSTIFY,
)


def chrome(c, page_no):
    """Desenha cabecalho, rodape e numero de pagina em todas as paginas."""
    c.setFont('Helvetica', 8)
    c.setFillGray(0.4)
    c.drawCentredString(W / 2, H - 1.4 * cm, HEADER)
    c.drawCentredString(W / 2, 1.4 * cm, FOOTER)
    c.setFont('Helvetica', 9)
    c.drawCentredString(W / 2, 0.8 * cm, str(page_no))
    c.setFillGray(0)


def two_columns(c, left_flowables, right_flowables, top, height, left_x, right_x, col_w):
    """Desenha duas colunas independentes (ordem de leitura: esquerda -> direita)."""
    for x, flowables in ((left_x, left_flowables), (right_x, right_flowables)):
        y = top - 0.4 * cm
        for para in flowables:
            y = draw_para(c, para, x, y, col_w) - 6


def draw_para(c, para, x, y, max_w):
    """Desenha um Paragraph em (x, y) e devolve o novo y (abaixo dele)."""
    _w, h = para.wrap(max_w, H)
    para.drawOn(c, x, y - h)
    return y - h


def build():
    os.makedirs(OUT_DIR, exist_ok=True)
    c = canvas.Canvas(OUT, pagesize=A4)

    # ---------------- Pagina 1: titulo, formatacao, numeros ----------------
    chrome(c, 1)
    c.setFont('Helvetica-Bold', 24)
    c.drawCentredString(W / 2, H - 3.5 * cm, "CAPITULO 1 - O INICIO")
    c.setFont('Helvetica-BoldOblique', 14)
    c.drawCentredString(W / 2, H - 4.6 * cm, "Um manual de teste")

    st = BODY
    y = H - 6.5 * cm
    para = Paragraph(
        "Este e um paragrafo de texto normal para validar a extracao basica. "
        "Ele contem frases curtas. E tambem uma frase consideravelmente mais longa, "
        "construida propositalmente para verificar se a divisao em trechos respeita "
        "a pontuacao e nao corta o sentido no meio de uma oracao.", st)
    y = draw_para(c, para, 2 * cm, y, W - 4 * cm) - 10

    para = Paragraph(
        "Neste paragrafo existe uma palavra em <i>italico</i> no meio da frase, "
        "seguida de texto normal. O leitor deve pronunciar na ordem: normal, italico, normal.", st)
    y = draw_para(c, para, 2 * cm, y, W - 4 * cm) - 10

    para = Paragraph(
        "Aqui temos uma palavra em <b>negrito</b> e outra em <i>italico</i> juntas, "
        "para testar formatacao mista no fluxo do texto.", st)
    y = draw_para(c, para, 2 * cm, y, W - 4 * cm) - 10

    para = Paragraph(
        "O computador utiliza memoria RAM (Random Access Memory) para armazenar "
        "dados temporariamente.", st)
    y = draw_para(c, para, 2 * cm, y, W - 4 * cm) - 10

    para = Paragraph(
        "O ano e 2026. A taxa e de 25%. O valor e R$ 1.250,50. "
        "A data limite e 21/10/2026. O total e 1.500 itens.", st)
    draw_para(c, para, 2 * cm, y, W - 4 * cm)
    c.showPage()

    # ---------------- Pagina 2: listas e frases curtas ----------------
    chrome(c, 2)
    c.setFont('Helvetica-Bold', 16)
    c.drawString(2 * cm, H - 3 * cm, "Capitulo 2 - Listas e frases curtas")
    y = H - 5 * cm
    itens = ["Primeiro item da lista.", "Segundo item da lista.",
             "Terceiro item com (parentese) interno.", "Quarto item final."]
    for it in itens:
        para = Paragraph("- " + it, BODY)
        y = draw_para(c, para, 2 * cm, y, W - 4 * cm) - 6

    y -= 10
    for frase in ["Curta.", "Outra curta!", "Terceira curta?", "Quarta e ultima."]:
        para = Paragraph(frase, BODY)
        y = draw_para(c, para, 2 * cm, y, W - 4 * cm) - 6
    c.showPage()

    # ---------------- Pagina 3: duas colunas ----------------
    chrome(c, 3)
    c.setFont('Helvetica-Bold', 16)
    c.drawCentredString(W / 2, H - 3 * cm, "Capitulo 3 - Duas colunas")
    col_w = (W - 5 * cm) / 2
    left_x = 2 * cm
    right_x = 2 * cm + col_w + 1 * cm
    top = H - 4.5 * cm
    left = [Paragraph("ESQUERDA A: primeiro bloco da coluna esquerda.", BODY),
            Paragraph("ESQUERDA B: segundo bloco da coluna esquerda.", BODY),
            Paragraph("ESQUERDA C: terceiro bloco da coluna esquerda.", BODY)]
    right = [Paragraph("DIREITA A: primeiro bloco da coluna direita.", BODY),
             Paragraph("DIREITA B: segundo bloco da coluna direita.", BODY),
             Paragraph("DIREITA C: terceiro bloco da coluna direita.", BODY)]
    two_columns(c, left, right, top, H - 8 * cm, left_x, right_x, col_w)
    c.showPage()

    c.save()
    print("PDF de regressao gerado em:", OUT)


if __name__ == "__main__":
    build()
