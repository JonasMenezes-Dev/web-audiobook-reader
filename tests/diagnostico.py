"""Harness de diagnóstico do pipeline estrutural PDF.

Roda a cadeia do backend contra o PDF de regressão e imprime:
  1. spans brutos extraídos por posição (PyMuPDF)
  2. texto com linhas/parágrafos reconstruídos
  3. frases enumeradas na ordem enviada ao frontend
  4. verificacoes automaticas (duplicatas, perdas, ordem)

Uso:  python tests/diagnostico.py [caminho/do.pdf]
"""
import os
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf as fitz

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "Backend"))

# Importa apenas as funcoes puras, sem puxar mysql/fastapi.
_MAIN_PY = Path(ROOT, "Backend", "main.py")
src = _MAIN_PY.read_text(encoding="utf-8")
ns = {"re": re, "Counter": Counter, "fitz": fitz}

def _extract_fn(src, name):
    start = src.index("def " + name + "(")
    lines = src[start:].splitlines()
    body = [lines[0]]
    for line in lines[1:]:
        if line and not line.startswith((" ", "\t")):
            break
        body.append(line)
    return "\n".join(body)

for fn in ("limpar_texto_pdf", "_detectar_cabecalho_rodape",
           "_parece_titulo", "dividir_em_frases", "extrair_blocos_pdf",
           "ordenar_blocos", "reconstruir_estrutura_pdf",
           "_detectar_margens_blocos", "_ordenar_linhas_colunas",
           "_texto_da_linha", "_span_negrito", "_trechos_da_linha",
           "classificar_conteudo", "_contextos_estrutura_para_leitura",
           "filtrar_estrutura_para_leitura"):
    exec(_extract_fn(src, fn), ns)

dividir_em_frases = ns["dividir_em_frases"]
extrair_blocos_pdf = ns["extrair_blocos_pdf"]
reconstruir_estrutura_pdf = ns["reconstruir_estrutura_pdf"]
classificar_conteudo = ns["classificar_conteudo"]
filtrar_estrutura_para_leitura = ns["filtrar_estrutura_para_leitura"]


def main():
    padrao = os.path.join(ROOT, "tests", "fixtures", "regressao.pdf")
    path = sys.argv[1] if len(sys.argv) > 1 else padrao
    print("=" * 70)
    print("PDF:", os.path.basename(path))
    print("=" * 70)

    blocos = extrair_blocos_pdf(path)
    estrutura = reconstruir_estrutura_pdf(blocos)
    bruto = "\n".join(bloco["texto"] for bloco in blocos)
    print("\n--- [1] SPANS BRUTOS (PyMuPDF, ordem espacial) ---")
    print(bruto)

    limpo = "\n\n".join(item["texto"] for item in estrutura)
    print("\n--- [2] TEXTO RECONSTRUÍDO ---")
    print(limpo)

    frases = dividir_em_frases(limpo)
    print("\n--- [3] FRASES NA ORDEM DE ENVIO AO TTS ---")
    for i, f in enumerate(frases):
        print(f"[{i:03d}] {f}")

    # --- [4] verificacoes automaticas ---
    print("\n--- [4] VERIFICACOES ---")
    dup = [f for f, c in Counter(frases).items() if c > 1]
    print(f"total de frases: {len(frases)}")
    print(f"duplicatas......: {len(dup)}" + (f"  -> {dup}" if dup else "  (ok)"))

    esperado = ["ESQUERDA A", "ESQUERDA B", "ESQUERDA C",
                "DIREITA A", "DIREITA B", "DIREITA C"]
    posicoes = []
    for chave in esperado:
        idx = next((i for i, f in enumerate(frases) if chave in f), None)
        posicoes.append((chave, idx))
    print("ordem das colunas na pagina 3:")
    for chave, idx in posicoes:
        print(f"   {chave}: indice {idx}")
    encontrados = [i for _, i in posicoes if i is not None]
    if len(encontrados) == len(esperado) and encontrados == sorted(encontrados):
        print("   -> COLUNAS EM ORDEM CORRETA (esquerda antes da direita)")
    else:
        print("   -> ATENCAO: ordem das colunas NAO esta sequencial (intercalada)")

    print("\nchecklist de conteudo (o que chegou ao TTS):")
    checks = {
        "titulo cap.1": "CAPITULO 1" in limpo.upper(),
        "italico": "italico" in limpo,
        "negrito": "negrito" in limpo,
        "parenteses": re.search(r"\(.*?\)", limpo) is not None,
        "ano 2026": "2026" in limpo,
        "porcentagem": "25%" in limpo,
        "moeda": "1.250,50" in limpo,
        "data": "21/10/2026" in limpo,
        "milhar 1.500": "1.500" in limpo,
        "cabecalho removido": "MANUAL DE TESTE" not in limpo,
        "rodape removido": "uso interno" not in limpo,
        "numero de pagina removido": not re.search(r"^\s*\d\s*$", limpo, re.M),
    }
    for k, v in checks.items():
        print(f"   [{'ok' if v else 'FALHOU'}] {k}")

    print("\n--- [5] DIAGNOSTICO DO FILTRO DE CONTEUDO ---")
    resultado = filtrar_estrutura_para_leitura(estrutura)
    blocos_brutos = {}
    for span in blocos:
        chave = (span["pagina"], span["bloco"])
        blocos_brutos.setdefault(chave, []).append(span)
    assinaturas_flexcil = {}
    for _chave, spans in blocos_brutos.items():
        linhas = {}
        for span in spans:
            linhas.setdefault(span["linha"], []).append(span)
        texto_bloco = " ".join(
            "".join(span["texto"] for span in sorted(linha, key=lambda item: item["x"]))
            for _, linha in sorted(linhas.items())
        ).strip()
        if not re.search(r"flexcil|smart\s+study|annotate", texto_bloco, re.IGNORECASE):
            continue
        classificacao_bruta = classificar_conteudo(
            texto_bloco,
            contexto={"repetido_em_paginas": True},
        )
        assinatura = (
            texto_bloco,
            classificacao_bruta["tipo"],
            classificacao_bruta["score"],
            tuple(sinal["codigo"] for sinal in classificacao_bruta["sinais"]),
        )
        assinaturas_flexcil.setdefault(assinatura, []).append(spans[0]["pagina"] + 1)

    classificacoes_relevantes = [
        (i, item) for i, item in enumerate(resultado["classificacoes"])
        if item["tipo"] != "NORMAL"
        or any(
            sinal["codigo"] in {
                "marca_flexcil",
                "marca_modificacao_flexcil",
                "slogan_smart_study_toolkit",
                "slogan_pdf_annotate_note",
                "chamada_compra_livro",
                "bloco_catalogo_editorial",
            }
            for sinal in item["sinais"]
        )
    ]
    if not classificacoes_relevantes:
        print("Nenhuma URL explícita ou sinal promocional encontrado no PDF.")
    for indice, item in classificacoes_relevantes:
        pagina_pdf = item["pagina"] + 1 if item["pagina"] is not None else None
        print(
            f"[{indice:03d}] pagina_pdf={pagina_pdf} tipo={item['tipo']} "
            f"score={item['score']} removido={item['ignorar']} "
            f"sinais={item['sinais']}\n      texto: {item['texto']}"
        )
        inicio = max(0, indice - 1)
        fim = min(len(resultado["frases_originais"]), indice + 2)
        for vizinho in range(inicio, fim):
            if vizinho != indice:
                pagina_vizinha = resultado["classificacoes"][vizinho]["pagina"]
                pagina_vizinha = (
                    pagina_vizinha + 1 if pagina_vizinha is not None else None
                )
                print(
                    f"      vizinho[{vizinho:03d}] pagina_pdf={pagina_vizinha}: "
                    f"{resultado['frases_originais'][vizinho]}"
                )
    removidas = len(resultado["frases_originais"]) - len(resultado["frases_filtradas"])
    contagem_tipos = Counter(item["tipo"] for item in resultado["classificacoes"])
    flexcil_na_estrutura = sum(
        bool(re.search(r"flexcil|smart\s+study|annotate", item["texto"], re.IGNORECASE))
        for item in estrutura
    )
    print(
        f"blocos brutos com Flexcil={sum(map(len, assinaturas_flexcil.values()))}; "
        f"blocos Flexcil reconstruídos={flexcil_na_estrutura}"
    )
    for chave, paginas in assinaturas_flexcil.items():
        texto, tipo, score, sinais = chave
        paginas_ordenadas = sorted(set(paginas))
        intervalos = []
        inicio = anterior = paginas_ordenadas[0]
        for pagina in paginas_ordenadas[1:]:
            if pagina != anterior + 1:
                intervalos.append((inicio, anterior))
                inicio = pagina
            anterior = pagina
        intervalos.append((inicio, anterior))
        paginas_formatadas = ", ".join(
            f"{inicio}-{fim}" if inicio != fim else str(inicio)
            for inicio, fim in intervalos
        )
        print(
            f"FLEXCIL bruto páginas={paginas_formatadas} tipo={tipo} score={score} "
            f"sinais={list(sinais)} texto={texto}"
        )
    ordem_preservada = resultado["frases_filtradas"] == [
        item["texto"] for item in resultado["classificacoes"] if not item["ignorar"]
    ]
    ctas_catalogo = sum(
        bool(re.search(r"\bcompre\s+agora\s+e\s+leia\b", item["texto"], re.IGNORECASE))
        for item in resultado["classificacoes"]
    )
    isbns_catalogo = {
        numero
        for elemento in estrutura
        for numero in re.findall(r"\b(?:97[89])\d{10}\b", elemento["texto"])
    }
    print(
        "classificações: "
        + ", ".join(f"{tipo}={contagem_tipos[tipo]}" for tipo in sorted(contagem_tipos))
    )
    print(
        f"chamadas 'Compre agora e leia'={ctas_catalogo}; "
        f"ISBNs encontrados={len(isbns_catalogo)}"
    )
    print(
        f"frases originais={len(resultado['frases_originais'])}; "
        f"leitura={len(resultado['frases_filtradas'])}; removidas={removidas}; "
        f"ordem_normal_preservada={ordem_preservada}"
    )


if __name__ == "__main__":
    main()
