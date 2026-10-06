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
           "_texto_da_linha", "_span_negrito", "_trechos_da_linha"):
    exec(_extract_fn(src, fn), ns)

dividir_em_frases = ns["dividir_em_frases"]
extrair_blocos_pdf = ns["extrair_blocos_pdf"]
reconstruir_estrutura_pdf = ns["reconstruir_estrutura_pdf"]


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


if __name__ == "__main__":
    main()
