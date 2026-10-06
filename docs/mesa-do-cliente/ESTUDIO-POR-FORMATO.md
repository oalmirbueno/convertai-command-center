# Estúdio por formato — continuidade da Agenda

O Estúdio da Mesa mantém a mesma disposição para arte, fotos e vídeo rápido: prancheta à esquerda, prévia central e ferramentas à direita. A Mesa Fotos independente continua com seu próprio rascunho.

## Como pedir ao agente do Mês / Agenda

- “Prepare para 12/10 um carrossel de fotos do produto X, com 4 fotos, usando as referências da pasta X do Workspace. Defina ângulos, cenário e luz.”
- “Prepare para 14/10 um vídeo rápido no estilo Apresentação de imóvel, a partir das fotos do imóvel X, formato 9:16, com narração: [texto].”
- “Prepare um vídeo rápido Jardim: antes e depois. Use as duas fotos da pasta X, na ordem antes e depois, preservando o ponto de vista.”
- “Planeje 3 posts por semana: 1 foto, 1 carrossel de arte e 1 vídeo rápido.”

Estilos de vídeo disponíveis: Produto elegante; Apresentação de imóvel; Jardim: antes e depois; Móveis: antes e depois; Mármore e sob medida. A direção e a narração continuam editáveis. A geração só começa ao clicar no botão com o custo visível.

## Contratos preservados e complementados

- `calendario_propostas.itens.formato`: carrossel, estatico, foto ou video. O vídeo deixa de ser convertido em carrossel.
- Foto mantém o contrato `foto` existente. Vídeo usa `video` com estilo, prompt, referencias, narracao e formato, definido em `_shared/video-da-pauta.ts`.
- O enum de tarefas não muda: fotos continuam static/carousel; o Estúdio lê a indicação estruturada da proposta e `direcao.so_fotos`. Vídeo usa o enum video existente.
- Um trabalho persistido de arte não é convertido pelo seletor. A leitura identifica posts e publicações da Agenda, incluindo MP4; a Entrega legada continua lendo somente imagens.
- Publicações agendadas na janela trazem a tarefa vinculada mesmo quando seu vencimento ficou fora do período. As consultas mantêm cliente, projeto e RLS.
- A lista atualiza ao retornar à janela e a cada 30 segundos enquanto aberta. Não precisa ativar uma configuração.
- Referências explícitas já disponíveis no acervo do cliente são pré-selecionadas; IDs inventados ou arquivos de outro cliente não são usados. Sem referência confirmada, a tela pede a escolha da foto. O diretor e o seletor mantêm o acesso às pastas do Workspace.
- Gerar fotos produz derivadas no acervo; preparar, legenda e entrega reaproveitam o fluxo existente para Arquivos e Agenda. Originais e aprovações permanecem preservados.
- Vídeo reaproveita mesa-videos, Workspace → Arquivos → Agenda e os dois gates de aprovação. Não introduz Motion nem timeline de edição.

## Verificação e operação

Testes cobrem formatos estruturados, proteção de arte, direção de vídeo, cadência mista, leitura de MP4 e seleção na prancheta. Checar também foto e vídeo na interface publicada, zoom e abertura de arte existente.

Publicação: frontend pelo Worker Cloudflare existente; backend somente agente-calendario no projeto canônico jjjtkowvxemvituvywvf. Nenhuma migração SQL. Antes de publicar, comparar o bundle remoto da função com a base Git e guardar uma cópia para rollback. O checkout original do Claude não deve ser atualizado ou limpo por este lote.

Rollback: publicar o frontend anterior e redeployar a função agente-calendario anterior. Não apagar tarefas, fotos, vídeos ou propostas criadas no período; a mudança de código não exige reversão de dados.
