# Melhorias de estudo — plano de implementação

> Execução: superpowers:executing-plans, sequencial nesta conversa. O usuário aprovou executar as três primeiras fases de `docs/auditoria-2026-11-03/RELATORIO.md`.

**Objetivo:** preservar informação acadêmica e estrutura editorial e corrigir a continuidade, navegação e recuperação da leitura.

**Arquitetura:** manter FastAPI/PyMuPDF e frontend estático, sem novas dependências. Acrescentar um contrato de blocos visíveis já filtrados, mapeado à fila de frases narráveis. Preservar campos antigos da API; clientes antigos continuam usando frases filtradas.

**Restrições:** não renderizar estrutura bruta que contorne filtros; não enviar conteúdo pessoal; manter leitura contínua, temas e IDs; não criar commits/push/deploy. Trabalhar no checkout existente preservando os artefatos da auditoria.

**Decisões de implementação:** URLs de referência ficam visíveis, mas não são narradas isoladamente. Propaganda e lixo técnico continuam excluídos. Texto exibido permanece original; normalização acontece só ao falar. Retomada usa a última fronteira de palavra informada pela voz; quando a voz não fornece fronteiras, reinicia a frase com aviso explícito. Identidade de arquivos usa SHA-256 local e metadados; âncoras salvas são hashes, sem conteúdo do documento. Registros antigos baseados somente em nome exigem confirmação antes de reutilizar sua posição.

## Revisão de riscos

- Não apagar valores numéricos no corpo, inclusive em tabelas, mantendo remoção de paginação nas margens.
- Preservar estilo e texto na união de palavras hifenizadas e em frases com spans mistos.
- Manter filtro em blocos mistos; nenhuma frase promocional pode reaparecer pela renderização estruturada.
- Cancelar upload e callbacks de voz sem modificar a leitura atual ou permitir eventos antigos avançarem o índice.
- Armazenamento indisponível, respostas antigas da API e falta de eventos de palavra devem ter comportamento explícito e seguro.

## Fase 1 — integridade do material

- [x] Escrever e executar testes que reproduzem perda de números, fusão de títulos/recuos, abreviações e URLs/DOIs.
- [x] Corrigir paginação por posição, fronteiras tipográficas/recuos e splitters backend/frontend, conservando os testes de colunas e callouts.
- [x] Testar e produzir `blocos_leitura`: blocos com IDs, tipo, nível, página e segmentos com texto, estilos e índice da frase (ou null para referência não narrável). A estrutura visível não inclui propaganda/lixo técnico. Manter rastreabilidade das decisões no resultado existente.
- [x] Executar suíte Python e testes puros JavaScript pertinentes.

## Fase 2 — documento estruturado

- [x] Testes de integração: parágrafos, headings, negrito/itálico, URLs, página de origem e capítulo real; fallback antigo usa somente `sentences`, nunca estrutura bruta.
- [x] Adaptar `processText` para blocos, renderizar documento semântico com IDs de frases preservados e navegar por títulos dos blocos.
- [x] TXT mantém parágrafos/texto original; heurística de heading restrita ao bloco completo, não a cada frase numérica.
- [x] Ajustar CSS de blocos ao visual existente, incluindo estado lido dentro de parágrafos.
- [x] Verificar desktop e 320/375 px, temas, fonte máxima, destaque e player.

## Fase 3 — motor de estudo

- [x] Testes para replay após fim, retomada por fronteira, fallback sem fronteira, troca de voz/velocidade, callbacks obsoletos e persistência imediata.
- [x] Separar texto visual/pronunciável; expor estado acessível, controle de posição por teclado e navegação por parágrafos.
- [x] Testar/corrigir timeout, cancelar, mensagem específica da API e PDF sem texto; sem fallback de extração no navegador.
- [x] Testar/corrigir identidade de arquivos com mesmo nome, âncora de retomada e migração antiga com confirmação; manter funcionamento sem storage.
- [x] Executar todas as suítes disponíveis, conferir fluxo local e revisão final; registrar limites de áudio/dispositivo real.

## Registro de execução

- Base: 75 testes Python passaram, 1 aviso de depreciação. HEAD `28e0a45870885357b09a771ec62873ccb93e6605`. Apenas `docs/` da auditoria estava sem rastreamento.
- Decisão: executar no checkout atual, sem operações Git de integração, conforme pedido e AGENTS.md.
- As fases 4–6 serão propostas no resumo: fluidez com medições, polimento para estudo, validação acadêmica e de acessibilidade em dispositivos reais.
- Fase 1: os 12 novos casos falharam antes da implementação e passaram depois. Suíte Python: 87/87; splitter JavaScript: 1/1.
- Fase 2: testes de headings e estilos falharam antes; após integração, 20 testes de navegador passaram (1 integração opcional ainda não executada), além dos 87 Python.
- Fase 3: falhas de retomada por palavra, colisão de nomes, replay, teclado e mensagens reproduzidas antes das correções. Verificação final em andamento.
- Ajustes dos testes existentes: duas asserções que inspecionavam assinaturas exatas foram atualizadas para o contrato filtrado e a nova opção de cancelamento; o teste de progresso agora verifica metadados v2 e SHA-256, sem conteúdo do arquivo.
- Fase 3 concluída: pausas de 320 ms após título e 220 ms entre outros blocos, ajustadas pela taxa; posição de palavra e pausas pendentes invalidadas com os callbacks da fala. O aviso de retomada e de persistência fica visível.
- Revisão final independente somente leitura: dois achados P2, URL com querystring e concorrência durante hashing. Ambos reproduzidos por testes falhando e corrigidos; URLs são protegidas integralmente, seleção anterior é invalidada e a identidade de PDF é capturada por requisição. Não houve achados menores pendentes nessa revisão.
- Complemento de integridade: ano isolado no topo não é tratado como paginação; contador numérico exige correspondência à página física ou rótulo explícito, além da posição de margem.
- Verificação final: **90 testes Python e 32 JavaScript/navegador passaram**, incluindo a integração com API local e PDF sintético. Um aviso de depreciação TestClient/httpx continua no ambiente. `node --check script.js` e `git diff --check` sem erros.
- Conferência visual atual: PDF sintético com 3 headings, 6 parágrafos, estilos e URL integral, desktop claro/escuro e mobile 320/375 px; sem overflow e player fora da área do texto. Capturas em `docs/melhorias-2026-11-03/`.
- Limites: nenhum deploy, nenhuma avaliação acústica das vozes, nenhum teste em dispositivo físico ou em PDFs pessoais. Biblioteca/controles visuais mais amplos e medições de desempenho permanecem nas fases 4–6.
