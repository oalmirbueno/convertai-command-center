# Mês: formatos, execução e continuidade

06/10/2026. Complementa o Estúdio aprovado e a simplificação da Mesa Vídeos (PR 57).

## Correções

- A esteira do Estúdio inicia aberta para todos os clientes. A altura da janela não a transforma mais automaticamente num seletor. Recolher continua uma escolha manual.
- O agente recebe o mês selecionado também no modo Criar. A instrução global antiga que proibia fotos e vídeos é substituída em runtime pela capacidade atual, preservando o briefing do cliente.
- Fotos e vídeos rápidos fazem parte da distribuição semanal, da criação e da conversão de formatos. Converter sincroniza tarefa, item da proposta e direção ainda vazia do Estúdio.
- Alterações simples solicitadas são aplicadas e conferidas. Exclusão, refazer e escolha ambígua continuam dependendo do cartão de confirmação. Conteúdo com mídia/entrega é preservado; o agente deve propor uma variação.
- Criar um lote agora prepara e grava na agenda. O recibo fica no servidor, não só na sessão do navegador. Retomar uma proposta já persistida não chama a geração novamente. Gravação parcial não aparece como conclusão.
- Atualizações sem linha retornada são falhas. Conversa sem ação executável não confirma alteração. Falhas parciais são apresentadas explicitamente.
- Mudanças de formato/data usam comparação do estado anterior e compensação em caso de erro; desfazer percorre as alterações em ordem inversa para preservar a consistência da proposta.

## Verificação

Regressão do Mês/Estúdio: 159 testes aprovados, mais um caso adicional de gravação parcial aprovado (160 casos cobertos). Mesa Vídeos: 74 testes aprovados no lote anterior. Build e tipos da aplicação passaram. Deno check verifica o endpoint e seus imports. Compatibilidade MCP verificada e regenerada.

Preview: em dois clientes abrir Estúdio e conferir a esteira; alternar formatos por pauta. Em Mês escolher outro mês e verificar o destino do envio; criar fotos/vídeos pelo cartão e conferir tarefas persistidas e atualização da agenda. Reabrir a conversa deve manter lotes gravados. Simular falha parcial não deve mostrar Feito. Desfazer conversão deve recuperar direção e data anteriores. Testes de gravação são simulados, sem gastar créditos ou alterar pautas reais.

## Limites e publicação

Não houve geração paga real neste lote. A interpretação do modelo ainda pode exigir esclarecimento; a interface distingue resposta de execução. Reescrita textual em múltiplas tabelas continua sem transação única, mas agora reporta falha parcial em vez de ocultá-la. Uma geração interrompida antes de persistir proposta não tem a garantia de retomada sem nova chamada.

Publicar somente agente-calendario e frontend no ambiente existente. Sem migrations nem mudanças de credenciais, aprovação ou publicação social. Backend deve preservar dependências da versão viva e trocar apenas os seis arquivos de agente-calendario deste lote. JWT permanece ligado.

Rollback: reverter o commit do lote, republicar frontend e restaurar a versão anterior do endpoint. Dados criados ficam preservados; nenhum replay de mensagens antigas. Claude deve continuar da main integrada e não repor a antiga limitação de dois formatos nem o recolhimento automático por altura.

## Auditoria complementar — 06/10/2026

A confirmação de cartões extensos enviava `anexos` inteiro no filtro de igualdade do PostgREST. A requisição crescia com os textos e falhava antes de aplicar o lote. Um teste HTTP somente de leitura, com conteúdo sintético acentuado, reproduziu 414 com URL de 74.330 caracteres. O cartão real relatado tinha 21.195 bytes de JSON antes do URL encoding.

- Recibos de ação e criação agora usam uma revisão curta por anexo. Todos os recibos participam da checagem concorrente, sem roteiro na URL.
- Conversões com snapshot comparam o JSON localmente e usam `updated_at`/`atualizado_em`, mantidos pelos triggers existentes. Compensação e Desfazer continuam conferindo o conteúdo atual; não há mudança de schema.
- O pedido atual prevalece sobre uma mistura editorial antiga. Três julgamentos entram na chamada Jev existente: outros meses, pedido de foto e pedido de vídeo. Escopo conservador mantém o mês aberto; menção explícita permite trabalhar outros meses.
- A conferência olha as ações normalizadas de formato, não palavras no título ou no plano. Uma tentativa curta corrige uma resposta incompleta; se continuar incompleta, não executa nem altera o plano, e guarda o rascunho e o uso para revisão.
- Criação, geração e ações respeitam o mês selecionado. Cartões novos registram seu escopo; cartões históricos continuam compatíveis.
- Falha do banco e conflito de revisão retornam mensagens específicas, sem expor payloads ou credenciais.

Validação: 99 testes focados; testes usando o transporte real do SDK com payload de 200 KB e URL menor que 2 KB; cinco pedidos sintéticos na API TypeSafe (inclusão, cobrança, negação, referência e vários meses), todos com resultado esperado após ajustar as perguntas; Deno check. Rollback: reimplantar o bundle v67 preservado, sem reverter dados. A revisão de texto já preparada pode ser retomada pela confirmação do cartão, sem regenerar a resposta paga.


## Auditoria global — 07/10/2026

A conversa podia dizer que nada foi alterado mesmo com recibos concluídos. Conversões para arte tentavam gravar direção nula no Estúdio, violando NOT NULL (23502 confirmado nos logs). A reescrita atualizava o roteiro sem atualizar a direção ainda não produzida. Detalhes de proposta abertos e item avulso não eram invalidados.

- Conversões têm direção válida; arte recompõe a direção com o roteiro e marca reais. Foto e vídeo mantêm seus contratos.
- Respostas de conclusão vêm dos recibos; a interface também interpreta cartões históricos já executados. Falhas parciais e mídia preservada ficam explícitas.
- Reescritas atualizam as direções sem mídia com snapshot e Desfazer; imagens prontas e trabalhos em geração ficam preservados com aviso. Texto não significa mídia regenerada.
- Jev lê conversa recente para referências e distingue revisão textual de autorização para novas datas/formatos. Meses citados como etapa futura não ampliam a execução atual. Sem resposta do classificador, a orientação editorial permanece no modelo principal; não presumir autorização pela ausência.
- Sugestões do compositor começam recolhidas nos agentes compartilhados e nos grupos próprios de Mês, campanhas, redes, Ads, fotos, vídeo, edição e administração. Campo, anexos, respostas necessárias e envio ficam visíveis. Abrir sugestões não chama IA.
- Atualização invalida agenda, roteiro detalhado, item avulso e calendário; ocorre também no encerramento de envio com falha, para buscar recibos que possam ter sido persistidos.

Aplicação global por código, sem condicionais de cliente, mudança de schema, chaves ou modelo. Não repetir nem executar cartões antigos automaticamente. Publicar agente-calendario e frontend Cloudflare; rollback por revisão anterior sem alterar dados. Validação inclui conversão arte/foto/vídeo, recibos parciais, direção/copy, cache e componentes de vários agentes. Interpretação semântica não é garantia universal; não gerar nem aprovar mídia sem o fluxo existente.
