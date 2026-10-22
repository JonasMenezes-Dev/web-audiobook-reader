# AGENTS.md — AudioLivro Pro

## Missão
Manter e evoluir o AudioLivro Pro, um leitor web de PDF/TXT com narração por voz, preservando a estabilidade do processamento, a continuidade da leitura e uma experiência editorial confortável.

## Direção de produto e design
- Identidade: **Híbrido Editorial, com predominância de livro físico**. A biblioteca pode parecer um aplicativo moderno, mas a tela de leitura deve lembrar páginas de um livro.
- Priorizar legibilidade, hierarquia tipográfica, margens generosas, ritmo vertical e ausência de distrações.
- Tema claro: papel marfim, texto grafite/sepia, detalhes discretos em cobre. Tema escuro: tons quentes e profundos, texto creme; evitar preto absoluto e contraste agressivo.
- Preferir fonte serifada para o texto do livro (a base atual usa Lora) e sans-serif para controles (a base atual usa DM Sans).
- Destaque da frase narrada deve ser sutil, claramente perceptível e não prejudicar o texto.
- Player compacto e acessível, especialmente no celular; não encobrir conteúdo nem prejudicar a rolagem.
- Evitar gradientes chamativos, glassmorphism excessivo, sombras pesadas, animações gratuitas e aparência genérica de dashboard.
- Não simular páginas virando ou paginação física se isso comprometer a rolagem sincronizada existente. Priorizar leitura contínua.
- Respeitar `prefers-reduced-motion`, foco visível, contraste e áreas de toque confortáveis.

## Arquitetura atual
- Frontend estático: `index.html`, `style.css`, `script.js`, `config.js`, publicado no GitHub Pages.
- Backend: FastAPI/Python em `Backend/`, com extração de PDF via PyMuPDF.
- TXT é carregado no navegador; narração usa Web Speech API.
- Testes em `tests/`; consultar `README.md` e `COMO_INICIAR.md` quando necessário.
- A URL pública do backend é configurada por `config.js`; não fixar novas URLs em outros arquivos.
- Não introduzir frameworks, bundlers, bibliotecas de UI ou serviços externos sem justificativa e autorização.

## Funcionalidades que não podem regredir
- Upload de PDF e TXT, inclusive no celular; feedback de carregamento e erros.
- Extração, ordenação e segmentação do texto, preservando títulos/seções quando possível.
- Filtro de conteúdo do backend: **nunca contornar uma falha do backend com um fallback de PDF que ignore o filtro**.
- Narração: reproduzir, pausar, retomar, avançar/voltar frase, selecionar voz e alterar velocidade.
- Destaque sincronizado da frase narrada e rolagem automática estável.
- Navegação por capítulos/seções.
- Progresso e preferências locais, com recuperação segura quando o armazenamento estiver indisponível.
- Temas claro/escuro, layout responsivo e acessibilidade básica.
- Livros recentes guardam metadados/progresso, **não o conteúdo do arquivo**; não prometer retomada sem selecionar novamente o arquivo original.

## Regras de implementação
1. Antes de editar, inspecionar apenas os arquivos e funções relevantes à tarefa. Identificar IDs, classes, eventos e contratos consumidos pelo JavaScript.
2. Trabalhar em etapas pequenas e focadas. Não misturar redesign com refatoração do motor de leitura ou do backend.
3. Preservar APIs, nomes de funções e IDs existentes, a menos que a mudança seja indispensável e todas as referências sejam atualizadas.
4. Preferir CSS com variáveis/tokens de tema e componentes visuais reutilizáveis; evitar duplicação de regras e especificidade excessiva.
5. Não substituir o mecanismo de rolagem contínua e destaque por paginação, renderização de PDF em canvas ou outra abordagem sem solicitação explícita.
6. Não usar conteúdo de livro fictício como dado persistido; exemplos de UI devem ser claramente demonstrativos.
7. Não registrar conteúdo dos arquivos do usuário em logs, analytics ou serviços externos.
8. Evitar mudanças de dependências e configuração de deploy sem necessidade.
9. Não alterar testes apenas para fazê-los passar; corrigir a causa da regressão.
10. Não criar commits, abrir PRs, fazer merge, push ou deploy sem pedido explícito.

## Fluxo de trabalho para Codex em esforço Médio
- Uma tarefa por vez, com escopo explícito e critérios de aceitação.
- Ler os trechos necessários, não despejar arquivos inteiros ou logs longos sem necessidade.
- Preferir diffs pequenos; não reformatar arquivos inteiros nem reescrever código estável por estética.
- Evitar investigações paralelas, refatorações oportunistas e explicações extensas.
- Se surgir um problema fora do escopo, relatar e propor uma tarefa separada.
- Se houver ambiguidade com impacto funcional, pedir confirmação antes de alterar.
- Ao concluir, informar brevemente: arquivos alterados, resultado, testes executados, limitações e riscos remanescentes.

## Validação
- Para mudanças visuais, verificar desktop e celular (incluindo 320–375 px), overflow horizontal, áreas de toque, teclado, temas e player fixo.
- Validar o fluxo: importar arquivo -> iniciar narração -> pausar/retomar -> navegar -> sair -> selecionar novamente -> recuperar progresso.
- Para mudanças que toquem processamento ou narração, executar testes relevantes e, quando viável, `python -m pytest tests/test_pipeline.py -v`.
- Verificar que o backend indisponível produz erro compreensível, sem fallback indevido.
- Não afirmar que testes manuais, responsividade real ou deploy foram verificados se não foram.

## Ordem planejada do redesign
1. Fundação visual e biblioteca inicial.
2. Superfície de leitura com aparência de livro físico.
3. Player, capítulos e controles responsivos.
4. Ajustes de leitura (fonte, espaçamento, largura) com persistência local.
5. Polimento, acessibilidade e regressões.

Este arquivo orienta o trabalho, mas não substitui as instruções específicas da tarefa atual. Se houver conflito, explicar antes de fazer alterações que possam quebrar funcionalidades.
