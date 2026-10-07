# Contexto como agente executor

O Plano do cliente aceita conversa, documentos, imagens e links do Google Drive. O contexto e as decisões alimentam os leitores compartilhados existentes das Mesas; o projeto, os marcos e as tarefas ficam no Kanban. Não é um novo banco de memória paralelo.

## Fluxo

1. O painel lê anexos e importa links Drive para o Workspace do cliente. Originais do Drive ficam em Contexto do cliente / Drive, separados por tipo e preservando subpastas. Documentos Google são exportados para TXT, XLSX ou PPTX.
2. O agente recebe os documentos, imagens legíveis, briefing, memória, dossiê e projetos existentes. Pode buscar e depois ler arquivos internos em até duas rodadas adicionais. Pesquisa externa é permitida por um controle visível; documentos vêm primeiro e pedidos de não pesquisar devem ser respeitados.
3. Conversar, propor e executar são intenções distintas. Com Aplicar meus pedidos ligado e uma ordem de execução, ações reversíveis de contexto, kit, projeto, tarefas e organização de arquivos são aplicadas. Operações pagas adicionais, arquivamento e ações fora da lista permitida mantêm revisão no cartão.
4. A resposta e o cartão são persistidos antes da execução. Cada item grava seu resultado antes do próximo. IDs estáveis de criação recuperam a mesma entidade após interrupção; vínculos projeto/marco são recompostos pelos recibos. Desfazer permanece disponível.
5. O resumo usa os resultados reais. Falha de leitura, importação parcial e execução incompleta não são sucesso. A tela invalida contexto, plano, conhecimento, Workspace, projetos e tarefas.

## Uso

“Importe esta pasta do Drive, leia os documentos e organize o contexto. Prepare o evento de 20/11 com projeto, preparação, posts, vídeos, cobertura e pós-evento. Use o material entregue; não pesquise na internet.”

“Confira os arquivos que já estão no Workspace e continue o projeto existente. Preencha o público e a oferta com base no briefing. Mostre apenas as informações que ainda faltam.”

## Limites reais

- Links Drive precisam permitir leitura sem login. O painel não possui OAuth Drive próprio; a sessão Google do navegador ou o conector do Codex não concedem acesso ao backend. Link privado devolve orientação para liberar leitura ou anexar material, sem contornar autenticação.
- Até 20 arquivos, 40 links visitados, quatro níveis, 50 MB por arquivo e 100 MB por importação, com orçamento de tempo. Importação incompleta informa links pendentes. Reenviar reutiliza arquivos de conteúdo idêntico. Não é sincronização contínua com o Drive.
- Vídeos e áudios são guardados e organizados, mas não transcritos ou analisados nesta entrega. Imagens têm limite de seis por pedido. Documentos locais ficam como texto extraído no Workspace; originais importados do Drive são preservados.
- Leitura do pedido limitada a 90 mil caracteres e recuperação anterior a 60 mil; cortes e arquivos ilegíveis são explicitados. PDF digitalizado sem texto pode exigir imagens legíveis.
- Não altera o dossiê canônico silenciosamente, não publica posts, não aprova peças e não promete que criar tarefa no Kanban criou a mídia ou a agenda editorial.
- Execução multientidade é recuperável e compensatória, não uma transação única. Arquivos importados ficam mesmo se uma geração posterior falhar. Leitura/modelo e pesquisa usam a cobrança já existente do painel.

## Verificar e reverter

Testes de contexto-plano-execucao, contexto-drive, contexto-materiais, agente-do-cliente, ci-contexto-inteligente, mesa-contexto-organizado, ag3-workspace e agente-mes-v2. Deno check no agente-contexto; tipos app/node; build e compatibilidade MCP. Conferir controles e anexos na aba Contexto após publicar.

Deploy somente de agente-contexto no Supabase jjjtkowvxemvituvywvf, com JWT preservado, e do frontend no Worker aceleriq-painel. Sem migração. Backend anterior v42 foi baixado e comparado com main antes da edição. Em rollback, restaurar o bundle anterior e o Worker anterior; não remover arquivos ou reverter dados dos clientes automaticamente. Preservar o trabalho do Claude e continuar da revisão integrada.
# Leitura de links externos (07/10/2026)

O Plano do cliente lê URLs coladas no pedido antes da chamada do modelo, independentemente de `pesquisar_web`. O frontend também encaminha pedidos com links HTTP(S) ou `www.` ao Plano. Drive continua no importador especializado existente.

- Até quatro URLs externas distintas por pedido, em paralelo, 25 segundos e 512 KiB por resposta, 15 mil caracteres por fonte. Falhas e cortes são explicitados. O teto combinado de documentos de 90 mil caracteres permanece.
- Sites, artigos e PDFs textuais públicos usam **Jina Reader** (`https://r.jina.ai/`, documentação: https://jina.ai/reader/). É um novo processador externo de páginas públicas, acessado sem chave na modalidade pública, sujeito a limites do fornecedor. `DNT: 1`, sem cookies, sessões ou credenciais. Não usa uma conta do navegador e não contorna login.
- O servidor só faz fetch no host fixo `r.jina.ai`, com redirecionamentos de transporte proibidos. URLs de origem/destino são validadas como HTTPS público, inclusive DNS; portas não padrão, IPs literais, credenciais em URL e parâmetros de autenticação/assinatura são recusados. Não ampliar a allowlist do helper compartilhado para hosts fornecidos pelo usuário.
- HTTP tenta a versão HTTPS. Áudio/vídeo e documentos Office/ZIP diretos pedem anexo/transcrição; não simulam leitura. Links sociais usam apenas texto público acessível, nunca prometem assistir ao vídeo. URLs com acesso restrito podem não ser lidas.
- Textos extraídos passam pela mesma sanitização, persistência por cliente, histórico e arquivo no Workspace → Contexto do cliente → Documentos. Guardam URL de origem e limites da leitura. Não afirmam baixar o original de um site.
- O prompt distingue material do cliente, referência, concorrente e evento. Fontes externas são dados não confiáveis; não autorizam ações e não substituem fatos aprovados sem evidência.
- Reverter este lote desfaz o módulo `links-do-contexto`, sua chamada em `conversarNoPlano`, o roteamento/ajuda do frontend e as duas orientações adicionais do prompt. Nenhuma migração ou mudança nas Mesas de criação.
