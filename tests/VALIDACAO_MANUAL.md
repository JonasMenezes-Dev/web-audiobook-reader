# Validação manual final — AudioLivro Pro

Os testes automatizados cobrem a API e as regressões do pipeline. Esta lista cobre o que depende de navegador, áudio real e do serviço publicado.

## Site publicado (GitHub Pages + API Render)

- [ ] Abrir o site e confirmar que a interface carrega sem erros no Console.
- [ ] Enviar um PDF de estudo curto com texto selecionável.
- [ ] Confirmar que o indicador de carregamento aparece e termina sem travar.
- [ ] Conferir o título e a sequência de pelo menos três parágrafos com o PDF aberto ao lado.
- [ ] Se o PDF tiver duas colunas, confirmar que o conteúdo da coluna esquerda é lido antes da direita.
- [ ] Confirmar que títulos numerados (por exemplo, 2.4.5), siglas entre parênteses, datas, percentuais e valores como R$ 1.250,50 não são cortados.
- [ ] Reproduzir áudio; pausar; retomar; avançar e voltar entre frases.
- [ ] Testar as velocidades 0,7x, 1x, 1,25x, 1,5x e 2x.
- [ ] Atualizar a página e confirmar que o progresso salvo é recuperado sem índice fora do intervalo.
- [ ] Enviar um TXT com parágrafos separados e conferir as pausas.
- [ ] Enviar um arquivo .txt renomeado para .pdf e confirmar que aparece um erro compreensível.
- [ ] Desconectar ou usar uma URL de API indisponível em ambiente de teste e confirmar que o site mostra erro sem travar nem tentar extrair o PDF localmente.
- [ ] Repetir no celular, com tela bloqueada/desbloqueada se esse for seu modo de estudo.

## Limites e cenários de arquivo

Os testes automatizados devem confirmar que a API rejeita arquivo vazio, arquivo que não é PDF, PDF corrompido, PDF protegido por senha, PDF acima de 25 MB e PDF com mais de 500 páginas.

## Critério de aprovação

Considere esta etapa concluída quando a suíte do GitHub Actions estiver verde e todos os itens manuais aplicáveis forem marcados. PDFs digitalizados como imagem podem exigir OCR; o aplicativo não deve prometer leitura de texto que não existe como camada textual no arquivo.
