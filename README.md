#  AudioLivro Pro

O **AudioLivro Pro** é uma aplicação web leve e intuitiva projetada para transformar arquivos PDF e TXT em áudio narrado. Ideal para estudantes e entusiastas de leitura que desejam consumir conteúdo enquanto realizam outras tarefas.

---

##  Funcionalidades

* **Leitura de PDF/TXT:** Extração estrutural de PDFs por posição com PyMuPDF; PDF.js continua como fallback local.
* **Narração Customizável:** Seleção de vozes (masculinas/femininas) e controle de velocidade.
* **Progresso Automático:** O app lembra exatamente em qual frase você parou, mesmo após fechar o navegador.
* **Interface Imersiva:** Design focado na leitura com Dark Mode e destaque da frase atual.
* **Acessibilidade:** Atalhos e navegação simplificada por sentenças.

# Tecnologias & Arquitetura (Full Stack)
O projeto utiliza uma arquitetura separada entre Cliente e Servidor para garantir performance e persistência robusta:

* Frontend: HTML5, CSS3 (Flexbox/Grid), JavaScript ES6+.
* APIs de Navegador: PDF.js (fallback local) e Web Speech API (síntese de voz).
* Backend (Motor): FastAPI (Python) — Framework moderno e de alta performance para a construção da API.
* Extração PDF: PyMuPDF fornece posição, fonte, tamanho e estilo de cada span; o backend reconstrói linhas, parágrafos e títulos, preservando também a estrutura por trecho.
* Validação de Dados: Pydantic — Garante que o contrato de dados entre o JS e o Python seja respeitado (evitando erros 422).
* Banco de Dados: MySQL — Persistência relacional para salvar o progresso de leitura de múltiplos livros.
* Comunicação: Fetch API com suporte a CORS para integração entre origens.

# Fluxo de Persistência Híbrida
Diferente de leitores comuns, o AudioLivro Pro trabalha com duas camadas de salvamento:

Local: Utiliza LocalStorage para acesso imediato no navegador.

Remota (SQL): Envia via POST o progresso exato (ID do livro e índice da frase) para o servidor Python, que armazena as informações no MySQL. Isso permite que o usuário nunca perca sua posição na leitura, mesmo trocando de dispositivo (em ambiente deployado).


# Como Rodar o Backend (Desenvolvimento)
Para habilitar o salvamento em MySQL no seu ambiente local:

1. Acesse a pasta /backend.
2. Crie um ambiente virtual: python -m venv venv.
3. Instale as dependências: pip install -r requirements.txt.
4. Configure suas credenciais do MySQL no arquivo main.py.
5. Inicie o servidor: uvicorn main:app --reload.

# Como usar

1. Faça o upload do seu arquivo PDF ou TXT.
2. Selecione sua voz preferida no menu superior (Dica: No **Microsoft Edge**, use as vozes 'Natural').
3. Ajuste a velocidade se necessário e dê o Play.
4. Clique em qualquer frase para saltar diretamente para aquele trecho.

# Testes e Regressão

O projeto possui um **PDF de regressão** e uma suíte automatizada que valida a
extração geométrica, a estrutura e a divisão: `PDF → spans → linhas/parágrafos → frases`.

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

### Diagnóstico visual do pipeline

```bash
python tests/diagnostico.py            # usa o PDF de regressão
python tests/diagnostico.py meu.pdf    # ou um PDF seu
```

Imprime o texto bruto, o texto limpo e cada frase numerada na **ordem exata de
envio ao TTS**, permitindo detectar trechos fora de ordem, pulados ou duplicados.

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
