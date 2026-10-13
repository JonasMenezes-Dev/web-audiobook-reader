# 🚀 Como Iniciar o AudioLivro Pro

Guia rápido de partida para desenvolvedores. Passo a passo do zero até ouvir o primeiro PDF.

---

## 📋 Pré-requisitos

| Ferramenta         | Para que serve                            | Onde pegar            |
| ------------------ | ----------------------------------------- | --------------------- |
| **Python 3.10+**   | Rodar o backend (FastAPI)                 | python.org            |
| **MySQL 8+**       | Salvar o progresso de leitura             | dev.mysql.com         |
| **VS Code**        | Editor + Live Server                      | code.visualstudio.com |
| **Microsoft Edge** | Melhor qualidade de voz (vozes _Natural_) | já vem no Windows     |

---

## 🧩 Parte 1 — Banco de Dados (fazer UMA vez)

1. Abra o MySQL e crie o banco e a tabela:

   ```sql
   CREATE DATABASE audiolivro_db;

   USE audiolivro_db;

   CREATE TABLE progresso (
       id_Livro VARCHAR(255) PRIMARY KEY,
       indice_frase INT NOT NULL
   );
   ```

2. Confirme a senha do seu usuário `root` — ela vai ser usada no passo 2.3.

> ⚠️ A tabela precisa se chamar **`progresso`** e a coluna **`id_Livro`** com chave primária, porque o backend usa `ON DUPLICATE KEY UPDATE` para não duplicar registros.

---

## 🐍 Parte 2 — Backend (API de extração de PDF)

Abra o terminal na **raiz do projeto**.

**2.1 — Entrar na pasta do backend**

```powershell
cd Backend
```

**2.2 — Criar e ativar o ambiente virtual**

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

> Se der erro de permissão de script, rode antes: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

**2.3 — Instalar as dependências**

```powershell
pip install -r requirements.txt
```

**2.4 — Configurar o MySQL**

Abra `Backend/main.py` e ajuste o bloco `db_config` (próximo ao topo do arquivo):

```python
db_config = {
    'host': 'localhost',
    'user': "root",
    'password': "SUA_SENHA_AQUI",   # <-- ajuste aqui
    'database': "audiolivro_db"
}
```

**2.5 — Subir o servidor**

```powershell
uvicorn main:app --reload
```

Servidor rodando em `http://127.0.0.1:8000`.
Teste no navegador: deve responder `{"status":"Online","msg":"Backend AudioLivro ready"}`.

> Deixe este terminal aberto. Abra um **novo** terminal para o próximo passo.

---

## 🎨 Parte 3 — Frontend (interface web)

O frontend consome a API em `http://127.0.0.1:8000` (veja as chamadas `fetch` em `script.js`).

1. Na **raiz do projeto**, inicie um servidor local:

   ```powershell
   python -m http.server 5500
   ```

2. Abra no **Microsoft Edge**:

   ```text
   http://127.0.0.1:5500/index.html
   ```

> Prefere o VS Code? Clique com o botão direito em `index.html` → **Open with Live Server**.
> Não abra o arquivo com duplo clique (`file://`) — o `fetch` para o backend falha por CORS.

---

## ✅ Parte 4 — Testar o fluxo completo

1. Faça o upload de um **PDF** ou **TXT**.
2. Escolha a **voz** no menu superior (no Edge, use as vozes _Natural_ — bem mais realistas).
3. Ajuste a **velocidade** se quiser.
4. Clique em **Play** ▶️.
5. Clique em qualquer frase para **saltar** para aquele trecho.
6. Feche e reabra o navegador — o app deve lembrar **onde você parou**.

Se tudo isso funcionar, o projeto está 100%. 🎉

---

## 🧪 Parte 5 — Testes (opcional, mas recomendado)

Na raiz do projeto:

```bash
# Gera o PDF de regressão (16 casos de teste)
python Backend/make_test_pdf.py

# Roda a suíte automatizada
python -m pytest tests/test_pipeline.py -v

# Diagnóstico visual do pipeline (PDF → frases)
python tests/diagnostico.py

# Teste end-to-end (backend precisa estar rodando)
python tests/e2e_upload.py
```

---

## 🔧 Ajustes durante o desenvolvimento

**Logs no console** — em `script.js`, procure a flag `DEBUG` e deixe `true`:

```javascript
const DEBUG = true; // mostra [PDF], [ESTRUTURA] e [TTS] Trecho NNN
```

A sequência de trechos no console deve ser `001 -> 002 -> 003`. Padrões como
`001 -> 002 -> 004` (pulo) ou `002 -> 002` (duplicata) indicam bug.

> ⚠️ **Desative trocando para `false` antes de publicar.**

---

## 🆘 Problemas comuns

| Sintoma                                      | Causa provável                            | Solução                                                      |
| -------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `Instale PyMuPDF`                            | Dependência faltando                      | `pip install pymupdf`                                        |
| Upload falha por CORS                        | Abriu via `file://`                       | Use `http://127.0.0.1:5500`                                  |
| `{"status":"erro","detalhes":...}` ao salvar | MySQL off / senha errada / tabela ausente | Revise a Parte 1 e 2.4                                       |
| `Activate.ps1 não pode ser carregado`        | Política de script do PowerShell          | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |
| Voz robótica                                 | Navegador/ voz errada                     | Use Microsoft Edge com vozes _Natural_                       |

---

## 📌 Resumo de bolso

```text
1. MySQL: criar audiolivro_db + tabela progresso
2. cd Backend
3. python -m venv venv  →  .\venv\Scripts\Activate.ps1
4. pip install -r requirements.txt
5. Ajustar db_config em main.py
6. uvicorn main:app --reload          (terminal 1, porta 8000)
7. python -m http.server 5500         (terminal 2, raiz do projeto)
8. Abrir http://127.0.0.1:5500/index.html no Edge
```
