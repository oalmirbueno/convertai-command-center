# Cursos, estudo e esteira de produtos

Complemento incremental da área de membros do projeto `jjjtkowvxemvituvywvf`, no domínio existente.

## Membro

- Menu lateral recolhível: início, lista pessoal, comunidade e Pomodoro. No celular, navegação horizontal.
- Lista pessoal persistida por conta. No teste administrativo, os favoritos são separados dos reais.
- Cursos com módulos recolhíveis, aulas e complementos, anterior/próxima aula, descrição, velocidade e saltos de dez segundos.
- Próxima aula automática somente após marcar a opção. Sem reprodução automática ao entrar na biblioteca.
- Modo foco usa a tela inteira e recolhe o sumário; Escape volta ao modo normal.
- PDFs usam PDF.js já instalado no projeto, inclusive arquivos antigos cadastrados como `arquivo` com extensão PDF.
  Leitura com páginas, zoom e texto acessível. Limite de leitura: 64 MB; downloads continuam sujeitos ao direito de acesso.
- Pomodoro de 25/5/15 minutos, pausa, reinício e prazo persistido por conta neste navegador.
  Sessões são locais, sem pontos ou presença inventada. Não dispara som ou notificações do sistema.
- Comunidade por produto, habilitada pelo administrador, com mensagens, respostas, edição própria e moderação.
  A prévia e o teste administrativo acompanham em modo de leitura, sem publicar.
- Próximos produtos seguem as etapas cadastradas da esteira e o progresso real, sem inventar ofertas.

## Administração

Em **Aulas e materiais**, escolha o produto e crie módulos e aulas. Edite título, arquivo, descrição,
visibilidade, ordem, downloads e vínculo de um complemento com sua aula. Arquivar módulo oculta seu conteúdo
no servidor. Arquivos substituídos não são apagados do armazenamento por esta implementação.

Em **Pessoas e acessos**, filtre por produto, compras, acesso, pendência ou prazo encerrado. Cada pessoa abre
produtos e direitos, compras registradas e histórico. Há concessão manual individual ou em lote com prazo
opcional, retirada somente dos direitos manuais e prévia da mesma tela do cliente. Nome de exibição pode ser
editado; email de login e papel de segurança não são alterados. Concessões repetidas atualizam o direito manual,
sem duplicá-lo. Prazo encerrado não é apresentado como prova de ausência de renovação.

Em **Esteira de produtos**, conecte um produto ao próximo e escolha se a indicação aparece quando houver acesso
ou após a conclusão. Produtos já liberados não são ofertados novamente. Páginas de venda e checkout aceitam HTTPS
e abertura interna explicitamente habilitada; sites externos podem recusar iframe. Nova guia permanece disponível.
Nenhuma mensagem recebida do iframe é aceita como prova de pagamento.

Textos da biblioteca são normalizados para remover travessões na leitura e na edição, preservando URLs e caminhos.

## Kiwify preparada, pagamentos desligados

Decisão de Almir: configurar depois. Não foram cadastradas credenciais nem vendas fictícias.

Em **Pagamentos → Conexão Kiwify**, o formulário recebe Client ID, Client secret e Account ID por campos protegidos.
O servidor confirma OAuth e a conta, com permissões de leitura `sales` e `stats`, e guarda os dados no Vault.
A interface recebe somente o estado e o nome da conexão. Não retorna credenciais ou token OAuth.
Consulta opcional de venda confere pedido, produto, comprador e estado na API oficial, sem liberar direitos.

- OAuth: https://docs.kiwify.com.br/api-reference/auth/oauth
- Conta: https://docs.kiwify.com.br/api-reference/account/account-details
- Venda: https://docs.kiwify.com.br/api-reference/sales/single

`membros_pagamentos_habilitados()` continua `false` para Kiwify e Asaas. Não há cron, segunda fila, rotina de
liberação ou alteração de cobrança nova. Webhooks e vínculos existentes são preservados. Ativar vendas exige
uma etapa posterior autorizada, com credenciais reais, oferta vinculada e validação integral de pagamentos,
reembolso e reivindicação do acesso. Configurar a conexão não conclui essa validação.

## Segurança e entrega

Migração criada com CLI: `20261020180352_membros_cursos_comunidade_funil.sql`. Incremental, sem reaplicar históricos.
RLS e funções com busca de schema fixa verificam papel, conta e contexto. Materiais em rascunho ou módulo oculto
não são retornados ao membro, nem ao teste de admin. Cofre não tem acesso REST e credenciais têm RPC somente de servidor.
URLs de arquivo continuam assinadas por 60 segundos e exigem autorização real antes da assinatura.

Teste isolado PostgreSQL cobre direitos, rascunhos, prévia, favoritos, comunidade, histórico e trava de pagamentos.
Testes React cobrem leitor, download no mesmo contexto e relógio persistido. Testes visuais usam dados sintéticos
somente no navegador local, com APIs substituídas e sem conexão de produção, incluindo renderização real do PDF.
O adaptador Kiwify tem testes de contrato com respostas sintéticas, sem afirmar validação comercial real.

## Registro da aplicação em 20/10/2026

- Banco: versão remota `20261020183251`, atribuída pelo conector ao fonte `20261020180352`.
  Ledger passou de 387 para 388 entradas; as 387 anteriores permaneceram idênticas, sem replay ou repair.
- Função `area-membros-kiwify` versão 1 publicada com JWT obrigatório. Configurações reais: zero.
- Produto demonstrativo existente organizado em um módulo, uma aula e um PDF complementar, com comunidade habilitada.
  Nenhum novo comprador, direito ou pagamento criado. Um acesso manual existente preservado; compras: zero.
- Verificações: 36 testes React/modelo, 14 Deno, 101 checagens SQL, 34 estados visuais em cinco larguras,
  tipos app/node, lint do lote, build e compatibilidade Lovable. PDF renderizado em canvas no teste de interface real.
- Backup físico disponível: 20/10/2026 às 03:58:41 UTC, com restauração disponível, conferido antes da aplicação.
