#  AudioLivro Pro

O **AudioLivro Pro** é uma aplicação web leve e intuitiva projetada para transformar arquivos PDF e TXT em áudio narrado. Ideal para estudantes e entusiastas de leitura que desejam consumir conteúdo enquanto realizam outras tarefas.

---

##  Funcionalidades

* **Leitura de PDF/TXT:** Extração de texto inteligente usando PDF.js.
* **Narração Customizável:** Seleção de vozes (masculinas/femininas) e controle de velocidade.
* **Progresso Automático:** O app lembra exatamente em qual frase você parou, mesmo após fechar o navegador.
* **Interface Imersiva:** Design focado na leitura com Dark Mode e destaque da frase atual.
* **Acessibilidade:** Atalhos e navegação simplificada por sentenças.

# Tecnologias & Arquitetura (Full Stack)
O projeto utiliza uma arquitetura separada entre Cliente e Servidor para garantir performance e persistência robusta:

* Frontend: HTML5, CSS3 (Flexbox/Grid), JavaScript ES6+.
* APIs de Navegador: PDF.js (extração de texto) e Web Speech API (síntese de voz).
* Backend (Motor): FastAPI (Python) — Framework moderno e de alta performance para a construção da API.
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

*Projeto desenvolvido para fins de estudo sobre manipulação de APIs de áudio e persistência de dados local.*
