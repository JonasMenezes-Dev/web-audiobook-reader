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

Antes de importar PDFs para a API local, ajuste `config.js` para `http://127.0.0.1:8000`. O valor configurado prevalece mesmo quando o frontend está em localhost; a configuração atual aponta para o backend público. Para publicar, use novamente a URL pública do serviço.

## Usar a versão publicada

Abra o site do AudioLivro Pro no GitHub Pages. PDFs precisam que o backend esteja acessível; a URL pública é configurada em `config.js`. TXT é processado localmente no navegador.

## Leitura e aparência

- Selecione um PDF ou TXT na biblioteca editorial. Os recentes guardam apenas metadados e progresso; selecione novamente o arquivo original para retomar.
- No leitor, abra **Aa** para ajustar fonte (16–28 px), espaçamento e largura da página. **Restaurar padrão** recupera os valores originais. Escape, o botão de fechar ou um clique fora fecham o painel.
- As preferências ficam neste navegador. Se o armazenamento estiver indisponível, a leitura e os ajustes continuam na sessão, sem garantia de recuperação posterior.
- O tema acompanha o sistema/navegador. A voz é automática; use o player para reproduzir/pausar, voltar/avançar frases e alternar a velocidade. Não há seletor de capítulos nesta versão.

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

Com Node.js, Playwright e Chromium disponíveis no ambiente de testes:

```bash
node --test --test-concurrency=1 --test-timeout=30000 tests/library.cjs tests/reader.cjs
```

Consulte o README para `NODE_PATH`, `CHROMIUM_PATH` e o teste opcional de PDF real com `AUDIOLIVRO_TEST_API_URL`. A simulação de narração nesses testes não substitui a verificação de áudio em dispositivos reais.
