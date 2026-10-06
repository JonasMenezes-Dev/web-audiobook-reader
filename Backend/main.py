import re
from typing import Any

import mysql.connector
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Importação opcional do PyMuPDF. A extração antiga continua disponível abaixo
# para compatibilidade e diagnóstico.
fitz: Any
try:
    import pymupdf as _fitz
    fitz = _fitz
except ImportError:
    fitz = None

# Mantido para compatibilidade com a extração antiga e os testes de regressão.
PdfReader: Any
try:
    from pypdf import PdfReader as _PdfReader
    PdfReader = _PdfReader
except ImportError:
    PdfReader = None

PYPDF_AVAILABLE = PdfReader is not None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

db_config = {
    'host': 'localhost',
    'user': "root",
    'password': "", # Verifique se sua senha é vazia mesmo
    'database': "audiolivro_db"
}


def extrair_blocos_pdf(caminho_pdf):
    """Extrai spans de texto e suas posições e características tipográficas."""
    if fitz is None:
        raise RuntimeError("Instale PyMuPDF: pip install pymupdf")

    if isinstance(caminho_pdf, (bytes, bytearray)):
        documento = fitz.open(stream=caminho_pdf, filetype="pdf")
    else:
        documento = fitz.open(caminho_pdf)

    blocos = []
    try:
        for numero_pagina, pagina in enumerate(documento):
            dados = pagina.get_text("dict")
            for numero_bloco, bloco in enumerate(dados.get("blocks", [])):
                if bloco.get("type") != 0:
                    continue
                for numero_linha, linha in enumerate(bloco.get("lines", [])):
                    for span in linha.get("spans", []):
                        texto = span.get("text", "")
                        if not texto.strip():
                            continue
                        x0, y0, x1, y1 = span["bbox"]
                        blocos.append({
                            "pagina": numero_pagina,
                            "altura_pagina": pagina.rect.height,
                            "bloco": numero_bloco,
                            "linha": numero_linha,
                            "x": x0,
                            "y": y0,
                            "x1": x1,
                            "y1": y1,
                            "texto": texto,
                            "fonte": span.get("font", ""),
                            "tamanho": span.get("size", 0),
                            "flags": span.get("flags", 0),
                        })
    finally:
        documento.close()
    return blocos


def ordenar_blocos(blocos):
    """Ordena spans pela página e posição; desempata linhas da esquerda à direita."""
    return sorted(
        blocos,
        key=lambda bloco: (
            bloco["pagina"],
            round(bloco["y"], 1),
            bloco["x"],
        ),
    )


def reconstruir_estrutura_pdf(blocos):
    """Reconstrói linhas e parágrafos mantendo os spans tipográficos na ordem."""
    ordenados = ordenar_blocos(blocos)
    linhas_margem = _detectar_margens_blocos(ordenados)
    linhas_por_pagina = {}
    linhas_por_bloco = {}

    for span in ordenados:
        identificador = (span["pagina"], span["bloco"], span["linha"])
        if (
            identificador in linhas_margem
            or re.fullmatch(
                r"(?:[Pp][áa]g(?:ina)?\.?\s*)?\d{1,4}",
                span["texto"].strip(),
            )
        ):
            continue
        pagina = span["pagina"]
        linhas = linhas_por_pagina.setdefault(pagina, [])
        chave_bloco = (pagina, span["bloco"])
        candidatas = linhas_por_bloco.setdefault(chave_bloco, [])
        tolerancia_y = max(2.0, (span.get("tamanho", 10) or 10) * 0.25)
        linha = next(
            (
                candidata for candidata in reversed(candidatas)
                if abs(candidata["y"] - span["y"]) <= tolerancia_y
            ),
            None,
        )
        if linha is None:
            linha = {
                "pagina": pagina,
                "x": span["x"],
                "x1": span["x1"],
                "y": span["y"],
                "y1": span["y1"],
                "spans": [],
            }
            linhas.append(linha)
            candidatas.append(linha)
        linha["spans"].append(span)
        linha["x"] = min(linha["x"], span["x"])
        linha["x1"] = max(linha["x1"], span["x1"])
        linha["y"] = min(linha["y"], span["y"])
        linha["y1"] = max(linha["y1"], span["y1"])

    linhas = []
    for pagina in sorted(linhas_por_pagina):
        pagina_linhas = linhas_por_pagina[pagina]
        pagina_linhas.sort(key=lambda linha: (round(linha["y"], 1), linha["x"]))
        linhas.extend(_ordenar_linhas_colunas(pagina_linhas))

    paragrafos = []
    atual = None
    linha_anterior = None
    for linha in linhas:
        linha["spans"].sort(key=lambda span: span["x"])
        texto_linha = _texto_da_linha(linha["spans"])
        if not texto_linha:
            continue

        tamanho_medio = sum(
            span.get("tamanho", 10) or 10 for span in linha["spans"]
        ) / len(linha["spans"])
        novo_paragrafo = atual is None
        if linha_anterior is not None:
            mesma_coluna = (
                linha["pagina"] == linha_anterior["pagina"]
                and abs(linha["x"] - linha_anterior["x"])
                    <= max(18, tamanho_medio * 2)
            )
            espaco_vertical = linha["y"] - linha_anterior["y1"]
            novo_paragrafo = (
                not mesma_coluna
                or linha["pagina"] != linha_anterior["pagina"]
                or espaco_vertical > tamanho_medio * 0.8
            )

        if atual is None or novo_paragrafo:
            if atual:
                paragrafos.append(atual)
            atual = {
                "tipo": "paragrafo",
                "texto": texto_linha,
                "pagina": linha["pagina"],
                "x": linha["x"],
                "y": linha["y"],
                "trechos": _trechos_da_linha(linha["spans"]),
                "_tamanho": tamanho_medio,
                "_negrito": all(_span_negrito(span) for span in linha["spans"]),
            }
        else:
            if atual["texto"].endswith("-") and texto_linha[:1].isalpha():
                atual["texto"] = atual["texto"][:-1] + texto_linha
            else:
                atual["texto"] += " " + texto_linha
            atual["trechos"].extend(_trechos_da_linha(linha["spans"]))
            atual["_tamanho"] = max(atual["_tamanho"], tamanho_medio)
            atual["_negrito"] = atual["_negrito"] and all(
                _span_negrito(span) for span in linha["spans"]
            )
        linha_anterior = linha

    if atual:
        paragrafos.append(atual)

    tamanhos = sorted(paragrafo["_tamanho"] for paragrafo in paragrafos)
    tamanho_base = tamanhos[len(tamanhos) // 2] if tamanhos else 0
    for paragrafo in paragrafos:
        paragrafo["texto"] = re.sub(r"[ \t]+", " ", paragrafo["texto"]).strip()
        if paragrafo["texto"].endswith("-"):
            paragrafo["texto"] = paragrafo["texto"][:-1]
        paragrafo["tipo"] = (
            "titulo"
            if _parece_titulo(paragrafo["texto"])
            or (
                paragrafo["_negrito"]
                and tamanho_base > 0
                and paragrafo["_tamanho"] >= tamanho_base * 1.25
                and len(paragrafo["texto"]) <= 60
                and not paragrafo["texto"].endswith((".", ",", ";", ":", "!"))
            )
            else "paragrafo"
        )
        del paragrafo["_tamanho"]
        del paragrafo["_negrito"]
    return paragrafos


def _detectar_margens_blocos(blocos):
    """Identifica cabeçalhos/rodapés repetidos pela posição em múltiplas páginas."""
    linhas = {}
    for span in blocos:
        identificador = (span["pagina"], span["bloco"], span["linha"])
        dados = linhas.setdefault(
            identificador,
            {
                "spans": [],
                "y": span["y"],
                "altura_pagina": span.get("altura_pagina", 0),
            },
        )
        dados["spans"].append(span)

    paginas_por_texto = {}
    for identificador, dados in linhas.items():
        altura_pagina = dados["altura_pagina"]
        texto = _texto_da_linha(sorted(dados["spans"], key=lambda span: span["x"]))
        if not altura_pagina or not texto:
            continue
        if dados["y"] <= altura_pagina * 0.12 or dados["y"] >= altura_pagina * 0.88:
            paginas_por_texto.setdefault(texto, set()).add(identificador[0])

    repetidos = {
        texto for texto, paginas in paginas_por_texto.items() if len(paginas) >= 2
    }
    return {
        identificador
        for identificador, dados in linhas.items()
        if _texto_da_linha(sorted(dados["spans"], key=lambda span: span["x"])) in repetidos
    }


def _ordenar_linhas_colunas(linhas):
    """Mantém títulos em ordem vertical e lê colunas independentes completas."""
    if len(linhas) < 2:
        return linhas

    sobreposicoes = []
    for indice, linha_a in enumerate(linhas):
        for linha_b in linhas[indice + 1:]:
            esquerda, direita = sorted((linha_a, linha_b), key=lambda linha: linha["x"])
            blocos_esquerda = {span["bloco"] for span in esquerda["spans"]}
            blocos_direita = {span["bloco"] for span in direita["spans"]}
            if blocos_esquerda & blocos_direita:
                continue
            vertical = min(esquerda["y1"], direita["y1"]) - max(
                esquerda["y"], direita["y"]
            )
            horizontal = direita["x"] - esquerda["x1"]
            if vertical > 0 and horizontal > 40:
                sobreposicoes.append((esquerda, direita))

    if not sobreposicoes:
        return linhas

    # A separação em colunas exige continuidade independente em ambos os
    # lados. Um único encontro entre caixas de texto não caracteriza colunas.
    y_esquerda = {round(esquerda["y"], 1) for esquerda, _ in sobreposicoes}
    y_direita = {round(direita["y"], 1) for _, direita in sobreposicoes}
    if len(y_esquerda) < 2 or len(y_direita) < 2:
        return linhas

    inicios_esquerda = [par[0]["x"] for par in sobreposicoes]
    inicios_direita = [par[1]["x"] for par in sobreposicoes]
    inicio_esquerda = min(inicios_esquerda)
    inicio_direita = max(inicios_direita)
    tolerancia_x = 24
    linhas_colunas = [
        linha for linha in linhas
        if min(
            abs(linha["x"] - inicio_esquerda),
            abs(linha["x"] - inicio_direita),
        ) <= tolerancia_x
    ]
    y_inicio = min(linha["y"] for linha in linhas_colunas)
    y_fim = max(linha["y1"] for linha in linhas_colunas)
    anteriores = [linha for linha in linhas if linha["y"] < y_inicio]
    posteriores = [linha for linha in linhas if linha["y"] > y_fim]
    centrais = [
        linha for linha in linhas
        if y_inicio <= linha["y"] <= y_fim
    ]
    esquerda = [
        linha for linha in centrais
        if abs(linha["x"] - inicio_esquerda) <= tolerancia_x
    ]
    direita = [
        linha for linha in centrais
        if abs(linha["x"] - inicio_direita) <= tolerancia_x
    ]
    ids_colunas = {id(linha) for linha in esquerda + direita}
    neutras = [linha for linha in centrais if id(linha) not in ids_colunas]

    def chave_y(linha):
        return round(linha["y"], 1), linha["x"]

    return (
        sorted(anteriores, key=chave_y)
        + sorted(esquerda, key=chave_y)
        + sorted(neutras, key=chave_y)
        + sorted(direita, key=chave_y)
        + sorted(posteriores, key=chave_y)
    )


def _texto_da_linha(spans):
    texto = ""
    ultimo = None
    for span in spans:
        parte = span["texto"]
        if ultimo and texto and not texto[-1].isspace() and not parte[:1].isspace():
            tamanho = span.get("tamanho", 10) or 10
            if span["x"] - ultimo["x1"] > max(1, tamanho * 0.15):
                texto += " "
        texto += parte
        ultimo = span
    return texto.strip()


def _span_negrito(span):
    fonte = span.get("fonte", "").lower()
    return bool(span.get("flags", 0) & 16) or "bold" in fonte or "black" in fonte


def _trechos_da_linha(spans):
    trechos = []
    for span in spans:
        fonte = span.get("fonte", "")
        flags = span.get("flags", 0)
        trechos.append({
            "texto": span["texto"],
            "fonte": fonte,
            "tamanho": span.get("tamanho", 0),
            "negrito": _span_negrito(span),
            "italico": bool(flags & 2) or any(
                estilo in fonte.lower() for estilo in ("italic", "oblique")
            ),
        })
    return trechos


def limpar_texto_pdf(texto, paginas=None):
    """Limpa o texto bruto do PDF preservando parágrafos.

    Args:
        texto: texto bruto completo.
        paginas: lista opcional com o texto de cada página. Quando fornecida,
            permite detectar cabeçalho/rodapé por POSIÇÃO (mesma linha no topo
            ou na base de várias páginas), que é o critério correto. Sem ela,
            cai no critério por frequência.

    Remove números de página isolados, cabeçalhos/rodapés repetidos e normaliza
    espaços sem colar tudo em uma única linha (antes, o re.sub(r'\n+', ' ')
    destruía a estrutura de parágrafos).
    """
    if not texto:
        return ""

    repetidas = set()
    if paginas:
        repetidas = _detectar_cabecalho_rodape(paginas)

    linhas = texto.split('\n')
    resultado = []
    for linha in linhas:
        stripped = linha.strip()
        if not stripped:
            resultado.append('')
            continue
        # Remove números de página isolados ("12", "12.", "- 12 -", "Página 12")
        padrao_pagina = (
            r'[\-\u2013\u2014]?\s*'
            r'(?:[Pp][áa]g(?:ina)?\.?\s*)?'
            r'\d{1,4}\s*[\.\-\u2013\u2014]?'
        )
        if re.fullmatch(padrao_pagina, stripped):
            continue
        if stripped in repetidas:
            continue
        resultado.append(stripped)

    # Fallback por frequência: só quando não recebemos as páginas separadas.
    if not paginas:
        from collections import Counter
        contagem = Counter(txt for txt in resultado if txt)
        total_linhas = sum(1 for txt in resultado if txt)
        # Um cabeçalho/rodapé se repete uma vez por página. Estimando ~20 linhas
        # úteis por página, esperamos repetição em >= ~5% das linhas.
        limite = max(2, int(total_linhas * 0.05))
        repetidas_freq = {
            txt for txt, c in contagem.items()
            if c >= limite and len(txt) <= 80 and not txt.endswith(('.', '!', '?', ':'))
        }
        resultado = [txt for txt in resultado if txt not in repetidas_freq]

    # Reagrupa em parágrafos. Uma linha que PARECE TÍTULO (curta, sem
    # pontuação final de frase, em CAIXA ALTA ou iniciando com "Capítulo") vira
    # sempre um parágrafo próprio — inclusive quando é a primeira linha da
    # página — para não colar no texto seguinte.
    paragrafos = []
    buffer = []
    for txt in resultado:
        if not txt:
            if buffer:
                paragrafos.append(' '.join(buffer))
                buffer = []
            continue
        if _parece_titulo(txt):
            if buffer:
                paragrafos.append(' '.join(buffer))
                buffer = []
            paragrafos.append(txt.strip())
            continue
        buffer.append(txt)
    if buffer:
        paragrafos.append(' '.join(buffer))

    # Junta hifenização de fim de linha ("cami-" + "nho" -> "caminho")
    texto_final = '\n\n'.join(paragrafos)
    texto_final = re.sub(r'(\w)-\s+(\w)', r'\1\2', texto_final)
    texto_final = re.sub(r'[ \t]+', ' ', texto_final)
    return texto_final.strip()


def _parece_titulo(linha):
    """Heurística conservadora para identificar linha de título.

    Sinais: curta (<= 60 chars), sem pontuação final de frase, e ou totalmente
    em caixa alta (>= 4 letras), ou começando por "Capítulo"/"CAPÍTULO".
    Não é usado para descartar nada — apenas para quebrar parágrafo.
    """
    s = linha.strip()
    if not s or len(s) > 60:
        return False
    if s.endswith(('.', ',', ';', ':', '!', '?')):
        return False
    if re.match(r'^\d+(?:\.\d+)*\.?\s+\S', s):
        return True
    letras = [c for c in s if c.isalpha()]
    if len(letras) < 4:
        return False
    if s.upper() == s:
        return True
    return bool(re.match(r'^(cap[íi]tulo|se[çc][ãa]o|parte)\b', s, re.IGNORECASE))


def _detectar_cabecalho_rodape(paginas):
    """Detecta linhas repetidas nas MARGENS (topo/base) de várias páginas.

    Olha as N primeiras e N últimas linhas de cada página — não apenas a
    primeira e a última — porque extratores como o pypdf podem emitir o rodapé
    logo após o cabeçalho, antes do corpo (ex.: cabeçalho, rodapé, nº de página,
    só então o texto). Compara as margens entre páginas e marca como
    cabeçalho/rodapé o que se repete nelas.
    """
    if len(paginas) < 2:
        return set()

    MARGEM = 3  # quantas linhas do topo e da base considerar
    from collections import Counter

    contagem = Counter()
    paginas_validas = 0
    for pag in paginas:
        linhas = [txt.strip() for txt in pag.split('\n') if txt.strip()]
        # Número de página puro não entra como candidato (já é removido antes)
        linhas = [txt for txt in linhas if not re.fullmatch(r'\d{1,4}', txt)]
        if not linhas:
            continue
        paginas_validas += 1
        candidatos = set(linhas[:MARGEM]) | set(linhas[-MARGEM:])
        for txt in candidatos:
            contagem[txt] += 1

    if paginas_validas < 2:
        return set()

    # Precisa aparecer nas margens de, no mínimo, 2 páginas (ou de todas,
    # quando o documento tem só 2 páginas).
    minimo = 2
    return {
        txt for txt, c in contagem.items()
        if c >= min(minimo, paginas_validas) and len(txt) <= 80
    }


def dividir_em_frases(texto):
    """Divide em frases sem cortar no meio, usando pontuação natural.

    Protege números com separadores (R$ 1.250,50 / 1.500 / 2.5 / 3,14) para que
    o ponto de milhar ou de decimal NÃO seja confundido com fim de frase.
    """
    if not texto:
        return []

    # Sentinelas impedem que separadores numéricos e reticências virem cortes.
    SENT = '\x00'
    reticencias_protegidas = {}

    def proteger(m):
        return m.group(0).replace('.', SENT)

    def proteger_reticencias(m):
        marcador = f"{SENT}E{len(reticencias_protegidas)}{SENT}"
        reticencias_protegidas[marcador] = m.group(0)
        return marcador

    frases = []
    for paragrafo in texto.split('\n\n'):
        paragrafo = paragrafo.replace('\n', ' ').strip()
        if not paragrafo:
            continue

        paragrafo = re.sub(r'\.{2,}|…+', proteger_reticencias, paragrafo)

        # Protege decimal/milhar, numeração hierárquica e marcador de seção no
        # início do parágrafo ("1. Introdução") antes de procurar frases.
        paragrafo = re.sub(
            r'(?m)^(\s*\d+(?:\.\d+)*)(\.)(?=\s+\w)',
            lambda m: m.group(1) + SENT,
            paragrafo,
        )
        paragrafo = re.sub(r'(?<=\d)\.(?=\d)', proteger, paragrafo)

        partes = re.findall(
            r"""[^.!?\u2026]+[.!?]+(?:["'”’»)\]}]*)|[^.!?\u2026]+$""",
            paragrafo,
        )
        for p in partes:
            s = p.strip()
            for marcador, reticencias in reticencias_protegidas.items():
                s = s.replace(marcador, reticencias)
            s = s.replace(SENT, '.')
            if s:
                frases.append(s)
    return frases

class DadosProgresso(BaseModel):
    id_Livro: str
    indice_frase: int

@app.get("/")
def home():
    return {"status": "Online", "msg": "Backend AudioLivro ready"}

@app.post("/salvar")
def salvar_progresso(progresso: DadosProgresso):
    conn = None
    try:
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()
        # CORRIGIDO: nome da tabela para 'progresso'
        sql = """
            INSERT INTO progresso (id_Livro, indice_frase)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE indice_frase = VALUES(indice_frase)
            """
        cursor.execute(sql, (progresso.id_Livro, progresso.indice_frase))
        conn.commit()
        cursor.close()
        return {"status": "success", "message": "Progresso salvo!"}
    except Exception as e:
        return {"status": "erro", "detalhes": str(e)}
    finally:
        if conn and conn.is_connected():
            conn.close() # GARANTE que a conexão feche

@app.post("/upload-pdf/")
async def processar_pdf(file: UploadFile = File()):
    if fitz is None:
        raise HTTPException(status_code=400, detail="Instale PyMuPDF: pip install pymupdf")

    try:
        contents = await file.read()
        blocos = extrair_blocos_pdf(contents)
        estrutura = reconstruir_estrutura_pdf(blocos)
        texto_limpo = "\n\n".join(item["texto"] for item in estrutura)
        sentences = dividir_em_frases(texto_limpo)

        return {
            "filename": file.filename,
            "total_frases": len(sentences),
            "texto_limpo": texto_limpo,
            "sentences": sentences,
            "estrutura": estrutura,
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
