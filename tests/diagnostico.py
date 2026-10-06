"""Harness de diagnostico do pipeline (Etapas 1-3 do plano).

Roda a cadeia REAL do app contra o PDF de regressao e imprime:
  1. texto bruto extraido (pypdf, igual ao backend)
  2. texto limpo
  3. frases enumeradas na ordem em que iriam para o TTS
  4. verificacoes automaticas (duplicatas, perdas, ordem)

Uso:  python tests/diagnostico.py [caminho/do.pdf]
"""
import os
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "Backend"))

from pypdf import PdfReader  # noqa: E402  (precisa vir apos o sys.path.insert)

# Importa apenas as funcoes puras, sem puxar mysql/fastapi.
_MAIN_PY = Path(ROOT, "Backend", "main.py")
src = _MAIN_PY.read_text(encoding="utf-8")
ns = {"re": re, "Counter": Counter}

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
           "_parece_titulo", "dividir_em_frases"):
    exec(_extract_fn(src, fn), ns)

limpar_texto_pdf = ns["limpar_texto_pdf"]
dividir_em_frases = ns["dividir_em_frases"]


def extrair_pypdf(path):
    reader = PdfReader(path)
    paginas = [(page.extract_text() or "") for page in reader.pages]
    return "\n".join(paginas), paginas


def main():
    padrao = os.path.join(ROOT, "tests", "fixtures", "regressao.pdf")
    path = sys.argv[1] if len(sys.argv) > 1 else padrao
    print("=" * 70)
    print("PDF:", os.path.basename(path))
    print("=" * 70)

    bruto, paginas = extrair_pypdf(path)
    print("\n--- [1] TEXTO BRUTO (pypdf) ---")
    print(bruto)

    limpo = limpar_texto_pdf(bruto, paginas=paginas)
    print("\n--- [2] TEXTO LIMPO ---")
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
