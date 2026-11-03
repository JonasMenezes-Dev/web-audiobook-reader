# Resultado das fases 4–6

Implementação local concluída em 03/11/2026, dando continuidade às fases 1–3 de `docs/melhorias-2026-11-03/RESUMO.md`. Preserva a arquitetura do projeto (frontend estático, API FastAPI com PyMuPDF, leitura contínua, sem novas dependências de produção, commits ou deploys não solicitados).

---

## 1. Fase 4 — Fluidez com evidência

### Otimizações implementadas
1. **Destaque cirúrgico de frases (`highlight`):**
   - Eliminada a varredura global com `querySelectorAll('.sent')` a cada avanço ou troca de frase.
   - Cache de elementos de frase (`sentenceElements`) e atualização seletiva: a frase anterior perde a classe `.reading` e ganha `.already-read`, e a frase atual ganha `.reading`.
   - Em saltos manuais, apenas as frases no intervalo entre o índice anterior e o novo são atualizadas.

2. **Delegação de eventos e proteção de seleção:**
   - Listener único delegado no container `#reading-inner`.
   - Respeita seleções de texto do estudante: se houver texto selecionado pelo mouse (`window.getSelection()`), o clique não dispara salto de frase.
   - Cliques em elementos filhos com estilo (`<strong>`, `<em>`, `<span>`) identificam corretamente a frase pai via `closest('.sent')`.

3. **Payload compacto da API (`/upload-pdf-progress/?compact=true`):**
   - Opção de envio compacto que transmite apenas os campos necessários ao leitor estruturado (`filename`, `total_frases`, `total_frases_originais`, `blocos_leitura`, `versao_estrutura`).
   - Elimina repetições brutas (`sentences`, `sentences_original`, `classificacoes_conteudo`, `estrutura`) sem alterar a extração nem o filtro.
   - Contrato completo mantido como padrão quando `compact=false`, assegurando retrocompatibilidade total.

### Resultados medidos (Chromium headless, viewport 375 × 812)

Dados registrados em `payload.json`, `performance-antes.json` e `performance-depois.json`:

| Cenário | Métrica | Antes | Depois | Ganho |
|---|---|---:|---:|---:|
| **50 págs / 3.500 frases** | Payload da API | 1,78 MB | 0,59 MB | **-67,1% de bytes** |
| | Avanço sequencial (mediana) | 1,70 ms | 0,30 ms | **-82,4% de tempo** |
| | Salto de frase (mediana) | 5,30 ms | 4,00 ms | **-24,5% de tempo** |
| | Memória JS Heap | 3,11 MB | 2,42 MB | **-22,2% de memória** |
| **200 págs / 14.000 frases** | Payload da API | 7,18 MB | 2,36 MB | **-67,1% de bytes** |
| | Avanço sequencial (mediana) | 6,70 ms | 0,30 ms | **-95,5% de tempo** |
| | Salto de frase (mediana) | 21,10 ms | 16,10 ms | **-23,7% de tempo** |
| | Memória JS Heap | 9,24 MB | 7,40 MB | **-19,9% de memória** |

---

## 2. Fase 5 — Polimento para estudo

### Melhorias de interface e usabilidade
1. **Biblioteca orientada a estudos:**
   - Seção "Seus documentos" (leituras recentes com progresso) posicionada no topo com prioridade visual, antes da área de importação.
   - Rótulos claros para contexto acadêmico ("Seu espaço de estudo", "Estude no seu ritmo", "Abrir material de estudo").
   - Informações visíveis de limites de importação (PDF até 25 MB e 500 páginas, texto selecionável).

2. **Tema integrado sem sobreposição:**
   - Botão de alternância de tema posicionado dentro do cabeçalho da biblioteca (`.library-header`), rolando junto com a página.
   - Resolvida a sobreposição que ocorria em telas estreitas (320 px e 375 px) sobre o título da estante.

3. **Seletor de velocidade direto e acessível:**
   - Substituição do ciclo sequencial por um controle direto `<select id="btn-spd">` com valores 0.7x, 1x, 1.25x, 1.5x e 2x.
   - Persistência imediata da velocidade no `localStorage`.
   - Ajuste em reprodução mantém o ponto de leitura pela fronteira de palavra (`speechOffset`).

4. **Nomes de voz legíveis:**
   - Exibição compacta no formato `Nome · REGIÃO` (ex: `Daniel · BR`), removendo prefixos de fornecedor.
   - Atributos `title` e `aria-description` contendo o nome técnico completo e idioma.

5. **Acessibilidade e teclado:**
   - Barra de progresso com suporte a teclas `Home`, `End`, `ArrowLeft`/`ArrowRight`, `ArrowUp`/`ArrowDown`.
   - Navegação por blocos semânticos (parágrafos e títulos) com `Alt + ArrowUp` e `Alt + ArrowDown` na área de leitura.
   - Elemento principal semântico `<main aria-label="Leitura e narração">` e cabeçalho `<h1>` com o título do documento.
   - Player compacto com layout fixo e folga inferior garantida em resoluções de 320 px a 1440 px, sem sobrepor o texto.

---

## 3. Fase 6 — Validação acadêmica e acessibilidade ampliada

### Matriz de casos de teste acadêmicos (`tests/test_academic_matrix.py`)
- **Apostila:** títulos com numeração hierárquica e parágrafos com recuo mantêm separação e ordem visual.
- **Duas colunas:** coluna esquerda lida integralmente antes da coluna direita.
- **Slides:** proporção widescreen, títulos grandes e tópicos ordenados verticalmente.
- **Referências acadêmicas:** URLs com querystrings (`https://universidade.example/busca?q=metodo&ano=2026`) e DOIs completos permanecem visíveis e copiáveis.
- **Matemática textual:** expressões como `p < 0,05` e `E = m c^2; n = 125` preservadas sem truncamento.
- **Tabelas numéricas:** dados numéricos em células (ex: `125`, `25`) sobrevivem à extração, sem inferir semântica tabular não suportada.
- **Hifenização e estilos:** quebras com hífen reconstituídas, preservando estilos de negrito e itálico e notas de rodapé únicas.
- **PDF sem texto (digitalizado):** identificação e rejeição com erro HTTP 422 e mensagem explicativa orientando o uso de OCR.

### Execução de testes automatizados
- **98 testes Python aprovados (`pytest tests/ -v`):**
  - 66 testes de pipeline (`test_pipeline.py`)
  - 9 testes de upload de API (`test_api_upload.py`)
  - 16 testes de integridade e contratos estruturados (`test_study_integrity.py`)
  - 7 testes da matriz acadêmica (`test_academic_matrix.py`)
- **36 testes Node.js / Playwright aprovados (`0 falhas, 0 skips`):**
  - `tests/library.cjs`: estante, persistência local, retomada de arquivos, fallback seguro e teste de integração com a API local real.
  - `tests/reader.cjs`: temas, responsividade (320 a 1440 px), controles do player, painel Aa, fonte de até 28 px e reflow.
  - `tests/study.cjs`: fluidez de destaque, delegação de clique, seletor de velocidade, vozes compactas, biblioteca de estudos e salvamento em segundo plano.
  - `tests/study-pure.cjs`: preservação de abreviações e símbolos acadêmicos.

---

## Evidência visual gerada

Capturas de tela salvas em `docs/melhorias-fases-4-6/`:
- `library-light-1440.png` e `library-dark-1440.png`: biblioteca desktop com documentos recentes no topo.
- `library-light-375.png` e `library-dark-375.png`: biblioteca mobile sem sobreposição do botão de tema.
- `reader-light-1440.png` e `reader-dark-1440.png`: leitor estruturado com títulos, parágrafos e player compacto.
- `reader-light-375.png` e `reader-dark-375.png`: leitor mobile com seletor de velocidade e página de origem.
- `appearance-light-1440.png`, `appearance-dark-1440.png`, `appearance-light-375.png`, `appearance-dark-375.png`: painel Aa aberto sem sobreposição.
- `shelf-light-1440.png`, `shelf-dark-1440.png`, `shelf-light-375.png`, `shelf-dark-375.png`: estante de documentos recentes.

---

## Limitações e riscos remanescentes

1. **Amostras sintéticas locais:**
   - Conforme acordado, a validação foi executada estritamente com amostras sintéticas locais criadas via PyMuPDF.
   - PDFs reais de faculdade com formatações muito atípicas, digitalizações de baixa qualidade ou diagramações complexas precisarão ser avaliados quando fornecidos pelo usuário.

2. **Qualidade acústica e vozes da Web Speech API:**
   - Os testes validam o envio das frases, o controle de taxa (`rate`), o offset de boundary e o reinício após término.
   - A pronúncia, naturalidade e pausas sonoras exatas dependem dos sintetizadores do sistema operacional do usuário e exigem escuta humana.

3. **Tecnologias assistivas físicas e segundo plano mobile:**
   - Os testes automatizados cobrem papéis ARIA, contraste, foco e navegação via teclado.
   - O comportamento de leitura contínua com a tela desligada/bloqueada no smartphone e a experiência com leitores de tela reais (NVDA, TalkBack, VoiceOver) dependem de validação em dispositivo físico.
