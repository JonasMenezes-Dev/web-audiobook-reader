# Como iniciar o AudioLivro Pro

## Iniciar no computador (desenvolvimento)

1. Instale Python 3.10+.
2. Abra o terminal na raiz do repositório.
3. Instale as dependências do backend:

   ```bash
   python -m venv .venv
   # Windows PowerShell:
   .\.venv\Scripts\Activate.ps1
   # macOS/Linux:
   source .venv/bin/activate
   pip install -r Backend/requirements.txt
   ```

4. Inicie a API:

   ```bash
   cd Backend
   uvicorn main:app --reload
   ```

5. Mantenha esse terminal aberto. A API local fica em `http://127.0.0.1:8000`.
6. Em outro terminal, volte à raiz do projeto e sirva o frontend com Live Server (VS Code) ou outro servidor HTTP estático. Depois abra o endereço local mostrado pelo servidor.

## Usar a versão publicada

Abra o site do AudioLivro Pro no GitHub Pages. PDFs precisam que o backend esteja acessível; a URL pública é configurada em `config.js`. TXT é processado localmente no navegador.

## Se o PDF não abrir

- Verifique a conexão com a internet.
- Confira se a URL de API em `config.js` está correta.
- Se o backend estiver iniciando ou acordando após inatividade, aguarde e tente novamente.
- O app não faz fallback local de PDF quando o backend falha, para não contornar o filtro de conteúdo.

## Executar os testes

Na raiz do repositório:

```bash
python -m pytest tests/test_pipeline.py -v
```
