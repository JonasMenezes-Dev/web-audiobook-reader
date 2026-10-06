"""Teste end-to-end: envia o PDF de regressao ao backend real e imprime

o que o navegador receberia.

Uso: python tests/e2e_upload.py
Requer o backend rodando em http://127.0.0.1:8000
"""
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "tests", "fixtures", "regressao.pdf")
URL = "http://127.0.0.1:8000/upload-pdf/"


def main():
    with open(PDF, "rb") as fh:
        conteudo = fh.read()

    boundary = "----audiolivroBoundary"
    parts = [
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="regressao.pdf"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
    ]
    corpo = parts[0].encode("utf-8") + conteudo + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        URL, data=corpo,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        dados = json.loads(resp.read())

    print("filename    :", dados.get("filename"))
    print("total_frases:", dados.get("total_frases"))
    print("texto_limpo :", bool(dados.get("texto_limpo")))
    print("\n--- FRASES QUE O FRONTEND IRA LER ---")
    for i, f in enumerate(dados.get("sentences", [])):
        print(f"[{i:03d}] {f}")


if __name__ == "__main__":
    main()
