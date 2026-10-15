"""Testes HTTP do backend para a validação completa do upload de PDFs."""

import json
import sys
from pathlib import Path

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "Backend"))
import main  # noqa: E402

client = TestClient(main.app)


def pdf_bytes(text="Marcador de leitura. Segunda frase para validar a ordem.", pages=1):
    doc = fitz.open()
    for index in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), text if index == 0 else f"Página de teste {index + 1}.")
    content = doc.tobytes()
    doc.close()
    return content


def upload(path, content, filename="teste.pdf"):
    return client.post(
        path,
        files={"file": (filename, content, "application/pdf")},
    )


def test_healthcheck_backend():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "Online"


def test_upload_pdf_valido_preserva_conteudo_e_retorna_estrutura():
    response = upload("/upload-pdf/", pdf_bytes())
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["filename"] == "teste.pdf"
    assert data["total_frases"] >= 2
    assert any("Marcador de leitura" in sentence for sentence in data["sentences"])
    assert any("Segunda frase" in sentence for sentence in data["sentences"])
    assert data["estrutura"]
    assert data["total_frases"] == len(data["sentences"])


def test_upload_progress_entrega_eventos_e_resultado_final():
    response = upload("/upload-pdf-progress/", pdf_bytes())
    assert response.status_code == 200, response.text
    eventos = [json.loads(line) for line in response.text.splitlines() if line.strip()]

    tipos = [evento["type"] for evento in eventos]
    etapas = [evento.get("stage") for evento in eventos if evento["type"] == "progress"]
    resultado = next(evento["data"] for evento in eventos if evento["type"] == "result")

    assert "progress" in tipos
    assert tipos[-1] == "result"
    assert "extracting" in etapas
    assert "rebuilding" in etapas
    assert "filtering" in etapas
    assert any("Marcador de leitura" in sentence for sentence in resultado["sentences"])


@pytest.mark.parametrize(
    ("conteudo", "status", "mensagem"),
    [
        (b"", 400, "vazio"),
        (b"isto nao e um pdf", 415, "PDF válido"),
        (b"%PDF-1.7\nconteudo truncado", 400, "íntegro"),
    ],
)
def test_upload_rejeita_arquivos_vazios_invalidos_ou_corrompidos(conteudo, status, mensagem):
    response = upload("/upload-pdf/", conteudo)
    assert response.status_code == status
    assert mensagem.casefold() in response.json()["detail"].casefold()


def test_upload_rejeita_pdf_acima_de_25_mb():
    conteudo = b"%PDF-1.7\n" + b"0" * main.MAX_PDF_SIZE_BYTES
    response = upload("/upload-pdf/", conteudo)
    assert response.status_code == 413
    assert "25 MB" in response.json()["detail"]


def test_upload_rejeita_pdf_com_mais_de_500_paginas():
    response = upload("/upload-pdf/", pdf_bytes(pages=main.MAX_PDF_PAGES + 1))
    assert response.status_code == 413
    assert "500 páginas" in response.json()["detail"]


def test_upload_rejeita_pdf_protegido_por_senha():
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Conteúdo protegido")
    conteudo = doc.tobytes(
        encryption=fitz.PDF_ENCRYPT_AES_256,
        owner_pw="senha-dona",
        user_pw="senha-usuario",
    )
    doc.close()

    response = upload("/upload-pdf/", conteudo)
    assert response.status_code == 400
    assert "senha" in response.json()["detail"].casefold()
