# AudioLivro Pro

Aplicação web para transformar arquivos PDF e TXT em audiolivros, com leitura por voz do navegador, controle de velocidade e progresso salvo localmente.

## Funcionalidades

- Importação de PDF pelo backend e de TXT diretamente no navegador.
- Extração estrutural de PDF com PyMuPDF, preservando a ordem visual, títulos e estilos.
- Filtro de propaganda e de resíduos técnicos no processamento do PDF.
- Narração com Web Speech API e velocidades de 0,7x, 1x, 1,25x, 1,5x e 2x.
- Progresso e livros recentes salvos no navegador.
- Indicador visual durante o envio e processamento do arquivo.

## Arquitetura

- **Frontend:** HTML, CSS e JavaScript; publicado no GitHub Pages.
- **Backend:** FastAPI/Python, em `Backend/`.
- **PDF:** PyMuPDF é usado no backend para extração e reconstrução do conteúdo.
- **TXT e voz:** FileReader e Web Speech API do navegador.
- **Configuração:** `config.js` define a URL do backend. Em desenvolvimento local, o endereço padrão é `http://127.0.0.1:8000`; em produção, configure a URL pública.

O processamento de PDF depende do backend. Se ele estiver indisponível, a aplicação informa a falha e **não tenta ler o PDF por um caminho alternativo que possa ignorar o filtro de conteúdo**.

## Como executar localmente

1. Instale Python 3.10 ou superior.
2. Abra um terminal na pasta do projeto.
3. Crie e ative um ambiente virtual:

   ```bash
   python -m venv .venv
   # Windows PowerShell
   .\.venv\Scripts\Activate.ps1
   # macOS/Linux
   source .venv/bin/activate
   ```

4. Instale as dependências:

   ```bash
   pip install -r Backend/requirements.txt
   ```

5. Inicie o backend:

   ```bash
   cd Backend
   uvicorn main:app --reload
   ```

6. Abra o frontend por um servidor HTTP local (por exemplo, a extensão Live Server do VS Code). O backend local fica em `http://127.0.0.1:8000`.

Para usar a versão publicada, abra o GitHub Pages do projeto e confira se `config.js` aponta para a URL pública atual do backend.

## Testes

Na raiz do projeto, com as dependências instaladas:

```bash
python -m pytest tests/test_pipeline.py -v
```

O conjunto verifica a extração estrutural, a ordem de leitura, a divisão em frases, os estilos, a velocidade 1,25x e a proteção contra fallback que contorne o filtro quando o backend falhar.

Para gerar o PDF sintético de regressão:

```bash
python Backend/make_test_pdf.py
```

Para inspecionar o pipeline:

```bash
python tests/diagnostico.py
python tests/diagnostico.py caminho/para/arquivo.pdf
```

Para testar o endpoint com o backend em execução:

```bash
python tests/e2e_upload.py
```

## Diagnóstico

- Se PDF não processar, confirme que o backend está ativo e que a URL configurada em `config.js` está correta.
- Se o navegador não falar, confira as vozes e permissões de áudio do navegador.
- Para depuração detalhada, altere `const DEBUG = true` em `script.js`; desative os logs antes de publicar.
