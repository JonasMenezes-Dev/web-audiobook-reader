# AudioLivro Pro

Aplicação web para transformar arquivos PDF e TXT em audiolivros, com leitura por voz do navegador, controle de velocidade e progresso salvo localmente.

## Funcionalidades

- Importação de PDF pelo backend e de TXT diretamente no navegador.
- Extração estrutural de PDF com PyMuPDF, preservando a ordem visual, títulos e estilos.
- Filtro de propaganda e de resíduos técnicos no processamento do PDF.
- Narração com Web Speech API e velocidades de 0,7x, 1x, 1,25x, 1,5x e 2x.
- Progresso e livros recentes salvos no navegador, com retomada no trecho exato após selecionar novamente o arquivo original.
- Navegação por capítulos e seções detectados automaticamente no texto.
- Destaque sincronizado que acompanha cada frase narrada, rolando somente a área do texto.
- Indicador visual durante o envio e processamento do arquivo.
- Biblioteca editorial com capas tipográficas, página de leitura contínua em Lora e player compacto.
- Temas claro e escuro acompanham o sistema/navegador até uma escolha manual pelo botão de tema, salva localmente; movimento reduzido é respeitado.
- Painel **Aa** no leitor: tamanho de 16 a 28 px, três espaçamentos e três larguras, com opção de restaurar o padrão.

As preferências de aparência usam a chave `audiolivro_reading_preferences_v1` e afetam somente o texto do livro. O padrão é 20 px no desktop e 18 px no celular. Dados inválidos são descartados; se o armazenamento estiver bloqueado ou cheio, os ajustes e a leitura continuam funcionando na sessão.

Os recentes guardam **metadados e progresso, não o conteúdo dos arquivos**. Para retomar, selecione novamente o arquivo original no mesmo navegador. A gravação do progresso depende da disponibilidade do armazenamento local. Como a identificação atual usa o nome do arquivo, arquivos diferentes com o mesmo nome podem compartilhar a posição salva.

A voz inicial é escolhida entre as disponíveis no navegador. O seletor de voz do player permite alterá-la e guarda a escolha localmente. O controle de seções permite navegar pelos capítulos detectados automaticamente, sem substituir a leitura contínua. Quando não há seções detectadas, o controle fica desabilitado.

## Arquitetura

- **Frontend:** HTML, CSS e JavaScript; publicado no GitHub Pages.
- **Aparência:** `reading-preferences.js` controla apenas as preferências de leitura, separado do motor em `script.js`.
- **Backend:** FastAPI/Python, em `Backend/`.
- **PDF:** PyMuPDF é usado no backend para extração e reconstrução do conteúdo.
- **TXT e voz:** FileReader e Web Speech API do navegador.
- **Configuração:** `config.js` define a URL do backend e seu valor prevalece também no desenvolvimento local. Para usar a API local, aponte-o para `http://127.0.0.1:8000`; para publicação, mantenha a URL pública do serviço. O endereço local só é usado como padrão se não houver URL configurada.

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

Confira a URL de `config.js`: o arquivo atualmente aponta para o serviço público, portanto iniciar a API local não muda automaticamente o destino dos uploads.

Para usar a versão publicada, abra o GitHub Pages do projeto e confira se `config.js` aponta para a URL pública atual do backend.

## Testes

O GitHub Actions executa automaticamente os testes de regressão e de API em pushes para `main` e em pull requests. Confira o resultado na aba **Actions** do repositório.

Na raiz do projeto, com as dependências instaladas:

```bash
python -m pytest tests/test_pipeline.py -v
```

O conjunto verifica a extração estrutural, a ordem de leitura, a divisão em frases, os estilos, a velocidade 1,25x e a proteção contra fallback que contorne o filtro quando o backend falhar.

Os testes de navegador usam Node.js e Playwright como ferramentas de desenvolvimento, sem dependências adicionais no frontend. Com o módulo `playwright` disponível para o Node e seu Chromium instalado:

```bash
node --test --test-concurrency=1 --test-timeout=30000 tests/library.cjs tests/reader.cjs
```

Para uma instalação externa do Playwright, configure `NODE_PATH` com a pasta `node_modules`. `CHROMIUM_PATH` permite indicar um executável existente. Os testes verificam biblioteca, player, preferências, teclado, armazenamento indisponível, movimento reduzido e larguras de 320 a 1440 px. A narração é simulada para verificar controles e sincronização; isso não valida a qualidade do áudio real.

O teste de PDF real no navegador é opcional. Com a API local em execução, defina `AUDIOLIVRO_TEST_API_URL=http://127.0.0.1:8000` no terminal antes do comando acima. Sem essa variável, somente esse caso é ignorado; o teste de backend indisponível continua sendo executado. Os testes usam arquivos sintéticos locais, sem enviar livros pessoais ao serviço público.

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
- Para depuração, altere `const DEBUG = true` em `script.js`; os logs informam contagens e índices, sem o conteúdo do livro. Desative-os antes de publicar.
