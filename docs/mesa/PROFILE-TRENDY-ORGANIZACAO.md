# Profile, Trendy, Organização e calendário por período

Lote de 21/10/2026, iniciado em `main` real `07ece8fa` e atualizado sem conflitos para `cc53d61e` (PR #93 de licenças CRM), em branch própria. O checkout anterior de Claude Code não foi alterado. Implementação complementar, em revisão; este documento não confirma implantação em produção.

## Referência observada

Foi usado o acesso autenticado de Almir ao [MyPostFlow](https://mypostflow.com/dashboard), por navegador e, durante uma interrupção da extensão, pelo acesso nativo Windows. O escopo é engenharia reversa do comportamento visível, não acesso ao código privado do fornecedor.

| Superfície | Comportamento observado | Complemento no Aceleriq |
| --- | --- | --- |
| Studio / Profile | Foto compartilhada, nome, @handle, texto, thumbnail e selo; ajustes de tamanho, cores, espaçamento e cantos | Ferramenta Template no Estúdio, com duas composições: Twitter e publicação Instagram |
| Studio / IA | Geração do texto de várias lâminas e refino do conteúdo | Reutiliza a preparação e o refino já existentes; a composição visual usa código |
| Formato / exportação | Carrossel, Quadrado e Stories; baixar a lâmina e salvar | Mantém os quatro formatos do painel, incluindo 9:16; não troca o motor de vídeo |
| Organização | Pastas por nicho/campanha/tema, contagens, busca e galeria de posts | Nova aba Organização usando os mesmos nós e arquivos do Workspace |
| Trendings | Busca de manchetes por assunto, fonte, recência e acesso à matéria; conteúdo a partir da notícia | Trendy complementa as buscas já existentes por cliente e nicho, com busca local, tipo, formato, fonte e data da pesquisa |
| Calendário | Tema/nicho, períodos 7/14/30 dias e 12 tipos de conteúdo | Novo calendário no Mês; proposta pelo agente existente, intervalo validado e revisão antes de gravar |

Não foi encontrada opção de exportação MP4/Reels nos controles examinados do editor de referência. Os vídeos e a esteira por formato do Aceleriq permanecem no fluxo existente. O formato 9:16 deste template produz uma imagem, inclusive para capa de Reel; não representa um novo renderizador de vídeo.

## Como usar

1. No Estúdio, prepare a pauta ou a arte rápida normalmente. A copy continua sendo criada pelo motor existente. Para uma arte única que será montada pelo Profile, desligue **Gerar a arte logo em seguida** no pedido; assim você prepara a direção sem contratar antes uma geração de imagem.
2. Abra **Template** na barra de ferramentas e escolha **Profile · Twitter** ou **Profile · Publicação Instagram**.
3. Na Mesa de um cliente, o nome, @ e avatar vêm da leitura de Redes. Havendo várias contas, selecione a conta. O avatar só é usado quando pertence ao @ exibido. No Livre sem cliente, a identidade é preenchida pela equipe; a conta interna da agência não é herdada.
4. Ajuste texto, tema, fundo, tamanho do perfil, espaçamento e cantos. O selo depende de escolha explícita; não é inferido de dados que não confirmam verificação.
5. A imagem vem da ferramenta Fotos, do acervo ou das fontes reais já pesquisadas pelo Diretor. A prioridade inicial continua nas fotos escolhidas pela equipe; o seletor permite trocar a fonte sem apagar fotos anteriores. Os pixels são preservados e a imagem cabe inteira no quadro. Confira a origem e a licença quando disponíveis. O avatar pode ser enviado quando a origem remota não permitir composição por CORS.
6. Confira em **Ver prévia grande**. **Guardar nova versão** acrescenta uma lâmina. **Montar todas as lâminas** compõe o conjunto com a copy e a foto de cada lâmina. Não há chamada a modelo de imagem nessa montagem.
7. Continue em **Entrega**: aprovação da agência/cliente ou arquivo livre, conforme o fluxo que já corresponde ao trabalho.

A edição do template é um rascunho até guardar. Texto que não cabe é recusado com orientação para reduzir o tamanho, mudar o formato ou dividir a lâmina. A imagem anterior permanece no histórico. Se a direção mudar desde a abertura do rascunho, a equipe deve escolher entre usar o texto atual e manter sua edição; o servidor também recusa uma base concorrente.

## Imagens reais e tutoriais

No **Diretor**, escolha uma lâmina e abra **Imagens reais**. Ajuste o assunto ou a marca e busque na Wikimedia. A busca não chama IA nem gera imagens. Os resultados mostram a fonte, autoria e licença; confira a pertinência antes de usar. **Usar na lâmina** importa o arquivo para a pasta do cliente e acrescenta uma fonte selecionável no Profile. Não apaga as fotos, não altera versões anteriores nem envia essa fonte nova ao gerador normal.

O link opcional aceita o arquivo HTTPS de uma imagem pública. HTML, páginas de login e painéis privados não são convertidos em capturas supostamente autenticadas: envie o print real em **Fotos**. A importação continua no servidor, com validação de acesso, origem, tipo, tamanho e concorrência.

Para um tutorial, use a captura atual do painel correto. Na prévia do Template, ative o marcador e clique no botão mostrado na própria imagem; edite o rótulo e confira o PNG. A posição é normalizada na imagem original e segue o mesmo desenho na prévia e na exportação. O marcador não é transferido para outras lâminas em **Montar todas**. O sistema não inventa telas, estados de configuração nem coordenadas de botões. Este modo complementa a composição anterior e não altera seu tratamento global de fotos e logos.

## Organização e sincronismo

A aba Organização lê `workspace_nodes` e `staff_files_secure`, com paginação e filtro do cliente. Criar ou mover uma pasta altera o próprio Workspace; não existe uma segunda árvore a sincronizar. A visão invalida o cache e relê ao voltar à janela. Arquivos do painel conservam o filtro de projeto/marca. A árvore do Workspace é compartilhada pelo cliente, pois não tem vínculo nativo por marca; essa distinção aparece na interface.

Movimentos exigem origem e destino do mesmo cliente, impedem ciclos e conferem o pai original para detectar edição concorrente. O organizador inteligente existente conserva sua prévia e confirmação. A nova aba não oferece exclusão.

## Calendário e Trendy

Novo calendário usa o cliente e a marca abertos, o mês selecionado, um início válido e até 7/14/30 dias, limitados ao final do mês. A seleção contém Educativo, Engajamento, Vendas, Dica rápida, Storytelling, Motivacional, Bastidores, Tutorial, Prova social, Tendência, Comparação e Cases. Os dias de publicação continuam obedecendo às regras atuais de dias úteis.

O formulário chama `pedido_livre`, exibe custo pelo componente existente e abre a conversa com uma proposta. Não chama `gravar` nem executa a agenda automaticamente. `data_fim` é opcional no contrato; pedidos antigos conservam a janela anterior. Propostas novas registram `parametros.periodo_pedido`, usado também na revisão, gravação e ao refazer. Datas fora da janela são recusadas.

Trendy lê as mesmas pesquisas e mantém as ações de criar conteúdo e campanha, inclusive o índice original após filtrar. A data exibida é a data real da pesquisa; não se inventa data de publicação da notícia. Os filtros não fazem nova chamada de IA.

## Contrato e custos

`estudio-arte/salvar_template` recebe `trabalho_id`, `ordem`, `versao_esperada`, `texto_base`, `pedido_id`, `png_base64` e os metadados normalizados do template. Valida acesso, aprovação, cliente/caminhos, PNG/CRC/dimensões e mudanças concorrentes. O mesmo identificador e conteúdo retornam a versão já guardada. Um identificador reutilizado com outro conteúdo é recusado.

O PNG final tem largura 1080 e altura 1350, 1440, 1080 ou 1920, conforme o formato existente. Limite de 8 MB. O registro acrescenta `modo: template_profile`, metadados editáveis, custo zero de geração de imagem e conferência visual pendente. Revisão humana continua pelo fluxo habitual; não se executa conferência de IA obrigatória após montar.

Texto de IA, pesquisa e planejamento continuam com seus custos atuais. Não há cobrança adicional de imagem pelo layout determinístico. Nenhum novo segredo, fornecedor, schema, tabela ou migration foi introduzido.

## Verificação e publicação

Foram preparados testes de identidade/conta, Livre, rascunho desatualizado, aprovação, overflow, preservação de foto, PNG, cliente, concorrência, replay, pastas, filtros, calendário explícito e compatibilidade legada. Os resultados finais do lote ficam registrados no PR e no relatório da entrega. O schema remoto foi consultado somente em leitura para confirmar as colunas utilizadas.

Publicar exige revisão, CI e Preview; a autorização de Almir em 21/10/2026 permite merge e publicação se essas verificações passarem. O frontend atual está na Cloudflare: `wrangler versions upload --preview-alias pr94` permite testar o Worker existente sem mudar o tráfego de produção. O merge no `main` dispara o workflow de publicação. Implantar individualmente `estudio-arte` e `agente-calendario`, com JWT preservado, antes de expor ações novas. Não há SQL para aplicar. Confirmar `/version.json` e os fluxos autenticados; testes automatizados não substituem essa conferência final. Os resultados efetivos são registrados na entrega, sem considerar uma etapa concluída apenas por estar planejada.

Rollback lógico: voltar o frontend ao commit anterior interrompe a entrada de novos templates; as ações opcionais são compatíveis com os pedidos antigos. Versões, arquivos e propostas já guardados não devem ser apagados.
