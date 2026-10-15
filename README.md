#  AudioLivro Pro

O **AudioLivro Pro** é uma aplicação web leve e intuitiva projetada para transformar arquivos PDF e TXT em áudio narrado. Ideal para estudantes e entusiastas de leitura que desejam consumir conteúdo enquanto realizam outras tarefas.

---

##  Funcionalidades

* **Leitura de PDF/TXT:** extração estrutural de PDFs por posição com PyMuPDF; TXT é lido direto no navegador.
* **Narração Customizável:** seleção de voz e controle de velocidade.
* **Progresso Automático:** o app lembra em qual frase você parou, mesmo após fechar o navegador.
* **Interface Imersiva:** design focado na leitura, com Dark Mode e destaque da frase atual.
* **Acessibilidade:** navegação simplificada por frases (anterior, próxima, clique para saltar).

# Tecnologias & Arquitetura
O projeto separa cliente e servidor:

* Frontend: HTML5, CSS3 (Flexbox) e JavaScript ES6+.
* APIs de Navegador: Web Speech API (síntese de voz).
* Backend (Motor): FastAPI (Python) — framework de alta performance para a construção da API.
* Extração PDF: PyMuPDF fornece posição, fonte, tamanho e estilo de cada span; o backend reconstrói linhas, parágrafos e títulos, preservando também a estrutura por trecho.
* Validação de Dados: Pydantic — garante o contrato de dados entre o JS e o Python (evitando erros 422).
* Banco de Dados: MySQL — persistência relacional do progresso de leitura.
* Comunicação: Fetch API com CORS habilitado para integração entre origens.

# Fluxo de Persistência Híbrida
Diferente de leitores comuns, o AudioLivro Pro trabalha com duas camadas de salvamento:

* **Local:** utiliza `localStorage` para acesso imediato no navegador (funciona offline).
* **Remota:** envia via `POST /salvar` o progresso exato (ID do livro e índice da frase) para o servidor Python, que armazena no MySQL. Isso permite que o usuário nunca perca sua posição na leitura, mesmo trocando de dispositivo (em ambiente deployado).


# Como Rodar

O passo a passo completo (banco, backend e frontend) está em **[COMO_INICIAR.md](COMO_INICIAR.md)**. Resumo:

1. Criar o banco `audiolivro_db` e a tabela `progresso` no MySQL.
2. Entrar em `Backend/`, criar o ambiente virtual e instalar as dependências:

   ```powershell
   cd Backend
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

3. Ajustar as credenciais do MySQL no bloco `db_config` de `Backend/main.py`.
4. Subir o servidor: `uvicorn main:app --reload` (porta 8000).
5. Na raiz do projeto, servir o frontend: `python -m http.server 5500`.
6. Abrir `http://127.0.0.1:5500/index.html` no navegador.

# Como usar

1. Faça o upload do seu arquivo PDF ou TXT.
2. Selecione sua voz preferida no menu superior (Dica: No **Microsoft Edge**, use as vozes 'Natural').
3. Ajuste a velocidade se necessário e dê o Play.
4. Clique em qualquer frase para saltar diretamente para aquele trecho.

# Testes e Regressão

O projeto possui um **PDF de regressão** e uma suíte automatizada que valida a
extração geométrica, a estrutura e a divisão: `PDF → spans → linhas/parágrafos → frases`.
Após o splitter, o backend classifica cada frase com score e sinais; URLs isoladas
e propaganda com evidência suficiente saem da lista enviada ao TTS, enquanto
`estrutura`, `texto_limpo`, frases originais e classificações permanecem na resposta.
Os testes também cobrem as classificações conservadoras e a preservação da ordem
após a filtragem.

### Gerar o PDF de regressão

```bash
python Backend/make_test_pdf.py
```

Gera `tests/fixtures/regressao.pdf` com os 16 casos exigidos: título, subtítulo,
parágrafo, itálico, negrito, números, datas, moeda, porcentagens, parênteses,
cabeçalho, rodapé, número de página, duas colunas, frases curtas e longas.

### Rodar os testes automatizados

```bash
python -m pytest tests/test_pipeline.py -v
```

Cobrem: extração por posição com PyMuPDF, preservação de negrito/itálico, ordem das
colunas, remoção de cabeçalho/rodapé/número de página, integridade de decimais
(`R$ 1.250,50`, `1.500`), parênteses, ausência de duplicatas, ordem das colunas,
índice dos capítulos, título isolado do parágrafo, presença da velocidade `1.25x`
e ausência de `cancel()` dentro de `speak()`.

### Estabilidade do player (correções)

* **Pausar/retomar repetidas vezes:** cada fala cria uma instância própria de
  `SpeechSynthesisUtterance`, protegida por um contador de geração
  (`speechGeneration`). Callbacks atrasados de falas canceladas são descartados,
  evitando que o player travasse após algumas pausas seguidas.
* **Clique para saltar a um trecho:** a rolagem do clique é instantânea (o
  `scroll-behavior: smooth` do container é suspenso durante o salto), para não
  competir com a rolagem automática disparada pelo avanço do áudio.

> 📄 PDFs na raiz do projeto são ignorados pelo Git (`.gitignore`), exceto o
> `tests/fixtures/regressao.pdf`, que faz parte da suíte de testes.

### Diagnóstico visual do pipeline

```bash
python tests/diagnostico.py            # usa o PDF de regressão
python tests/diagnostico.py meu.pdf    # ou um PDF seu
```

Imprime o texto bruto, o texto reconstruído e cada frase numerada na **ordem exata de
envio ao TTS**, permitindo detectar trechos fora de ordem, pulados ou duplicados.
Também informa o score, a classificação, a decisão de remoção e os trechos vizinhos
para URLs e sinais promocionais.

### Teste end-to-end (backend real)

Com o backend rodando:

```bash
python tests/e2e_upload.py
```

Envia o PDF de regressão para `POST /upload-pdf/` e mostra o JSON que o frontend
recebe.

# Modo DEBUG

Em `script.js`:

```javascript
const DEBUG = true;   // logs de [PDF], [ESTRUTURA] e [TTS] Trecho NNN no console
```

Durante o desenvolvimento, deixe `true` para acompanhar o console:

```text
[TTS] Trecho 001 ...
[TTS] Trecho 002 ...
```

A sequência deve ser `001 → 002 → 003`. Padrões como `001 → 002 → 004` indicam
problema de ordenação; `002 → 002` indica duplicação. **Desative ao publicar.**

*Projeto desenvolvido para fins de estudo sobre manipulação de APIs de áudio e persistência de dados local.*
