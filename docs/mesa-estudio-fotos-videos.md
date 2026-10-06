# Mesas, fotos e vídeos na esteira

O acesso **Mesas**, abaixo de **Central**, reúne as mesas do painel. Escolher o cliente no hub mantém esse cliente ao abrir a mesa.

## Agenda e produção

Pautas de foto e vídeo detalhadas em propostas prontas aparecem na esteira mesmo antes da criação da tarefa. Ao abrir uma delas, a ação oficial do Calendário prepara a tarefa e confirma seu identificador. A gravação é idempotente; tarefas e artes já existentes são preservadas.

Uma proposta sem projeto só herda o projeto quando há um único projeto usado nos itens da agenda, ou um único projeto disponível. Ambiguidade não é resolvida escolhendo um cliente/projeto arbitrário.

O formato vem do registro estruturado da Agenda. Uma pauta de foto abre Fotos; uma de vídeo abre Vídeo rápido. Mencionar uma foto no título de um carrossel de arte não converte o trabalho existente.

## Como pedir ao agente da Agenda

- “Planeje um carrossel de 4 fotos reais das armações, formato foto, usando a pasta Produtos/Armações. Prepare as referências e a legenda.”
- “Planeje um vídeo rápido, estilo Apresentação da loja, usando as fotos reais da pasta Loja, vertical 9:16. Prepare a direção e o texto da narração.”
- “Planeje um vídeo rápido, estilo Antes e depois, com as duas fotos da pasta Obra finalizada, primeiro o antes e depois o resultado.”
- “Planeje um vídeo rápido, estilo Produto elegante, para apresentar este produto com câmera suave e sem alterar seus detalhes.”

Os estilos disponíveis são Produto elegante, Apresentação de imóvel, Jardim: antes e depois, Móveis: antes e depois, Mármore e sob medida, Apresentação da loja, Coleção e vitrine, Produto em uso, Bastidores e processo, Gastronomia e detalhes, Moda e acessórios, Antes e depois e Apresentação da marca.

Referências automáticas exigem arquivos reais disponíveis no cliente. Pasta vazia ou ambígua não deve virar confirmação fictícia de seleção.

## Bancada

À esquerda ficam a prancheta e a escolha das fotos; no centro, a prévia com **Ver grande**; à direita, as ferramentas com ícones e nomes ao passar o mouse. Alternar ferramentas conserva o rascunho.

Fotos: gerar, melhorar/ampliar, logo, Compor, Combinar, acervo, modelos, clones, diretor, legenda e aprovação. A logo é aplicada em uma nova imagem, preservando os pixels e a imagem original. Peça já preparada exige trocar as fotos para usar uma nova versão antes de enviar.

Vídeos: gerar com estilo/contexto, escolher trilha do acervo ou enviar áudio, ajustar a trilha abaixo da voz, legendar, preparar legenda do post e aprovação. A versão com trilha usa o renderizador existente e entra na mesma prancheta depois de concluída. **Gerar** continua exigindo a ação da equipe e mostra o custo quando há geração de IA.

## Combinar e Compor

**Compor** conserva seu fluxo. **Combinar** é uma ferramenta independente para séries de produto e cenário: pessoa/cenário à esquerda, resultado e pedido no meio, produto e tratamento à direita. Há seis cenários e uma a quatro variações. O produto tratado pode ser aprovado como nova referência, sem alterar o kit original. As séries têm histórico no Canvas e no acervo do cliente.

## Continuidade técnica

- `pautasPlanejadas.ts` insere pautas sem tarefa na leitura da esteira; `PautaPlanejada.tsx` confirma a gravação oficial.
- `BancadaDaPauta.tsx` compartilha prancheta, prévia, ferramentas e seleção à esquerda.
- `resultadosDeVideoDaPauta.ts` recupera os arquivos pelo pedido e pela linhagem das versões, incluindo trilha e legenda.
- `videoComTrilha.ts` usa o contrato de projeto e a fila de render existentes.
- `LogoNaFoto.tsx` grava uma derivada pelo registro de acervo; `mesa-foto` valida cliente, fonte, caminho e tipo.
- O contrato compartilhado `video-da-pauta.ts` alimenta o agente do Calendário e o seletor do Estúdio.
- Aprovação da agência e do cliente continuam nos fluxos existentes. Abrir ou gerar uma peça não publica conteúdo nas redes.

Nenhuma migração de banco, novo projeto, novo motor de vídeo ou troca de hospedagem faz parte desta entrega.
