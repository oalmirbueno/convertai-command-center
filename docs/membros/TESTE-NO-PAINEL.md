# Testar a biblioteca

- Biblioteca: https://aceleriq.online/membros
- Administração: https://aceleriq.online/membros/administrar

Na administração, cadastre um produto, seus materiais e publique o produto. Para testar conteúdo
restrito, conceda acesso manual à pessoa desejada em **Acessos e benefícios**. Nenhum produto,
pagamento ou acesso de demonstração foi criado no banco real.

Em **Ver como cliente**, escolha uma pessoa e clique em **Abrir visão do cliente**. A biblioteca e o
leitor são os mesmos usados pelo membro. A consulta no servidor considera os direitos reais dessa
pessoa, inclusive os bloqueios. A faixa superior identifica a prévia; ela não grava progresso.
**Sair da visão do cliente** volta à administração. A função exige administrador, inclusive para
consultar os materiais e abrir arquivos privados. Compartilhar o endereço da prévia não concede acesso.

## Pagamentos pausados

Kiwify e Asaas não concedem acesso nesta publicação. A trava `membros_pagamentos_habilitados()` retorna
`false` no banco; tanto a conciliação quanto a reivindicação de compras respeitam essa trava. A Edge
Function também interrompe o pedido antes de consultar qualquer provedor. A função interna de
validação não pode ser chamada por navegador nem diretamente pelo papel de serviço.

Cadastrar um vínculo de produto não ativa pagamentos. Nenhum webhook de cobrança ou credencial foi
alterado. A liberação futura requer validação dos pagamentos e uma alteração explícita da trava,
com nova autorização. Concessões manuais e benefícios explícitos de plano continuam independentes.

## Aplicação autorizada em 20/10/2026

Almir autorizou aplicar as migrações e publicar para testes, mantendo pagamentos desligados.
O backup físico restaurável de 20/10/2026, 03:58:41 UTC, foi conferido no painel do projeto.
Nenhum objeto existente do Storage foi removido ou alterado.

O workflow de banco está sem credenciais no repositório e no ambiente `production`. Neste lote foi
usada a conexão oficial Supabase já autorizada pelo usuário, após preflight e ensaio isolado.
Não houve reset, seed, repair, replay nem escrita manual na ledger. As duas versões atribuídas pelo
conector e os hashes do SQL integral foram conferidos contra os arquivos locais:

| Fonte revisada | Versão registrada no Supabase |
| --- | --- |
| `20261020150633_area_membros_biblioteca.sql` | `20261020162025` |
| `20261020180000_membros_previa_admin_pagamentos_pausados.sql` | `20261020162028` |

O snapshot de implantação registra as 386 versões efetivamente aplicadas, preservando as 384
anteriores sem alterações. Não há migrações pendentes da biblioteca nesse snapshot. Os arquivos
fonte locais mantêm seus nomes de revisão; não tentar reaplicá-los para igualar timestamps.

`area-membros` versão 1 foi publicada com validação JWT ativada. A publicação do frontend usa o
Worker Cloudflare existente, com as mesmas rotas e domínio; não cria outra hospedagem ou projeto.

Testes deste complemento: 28 testes Vitest, 7 Deno e 43 verificações SQL (incluindo persistência
após reinício). O ensaio usa dados sintéticos isolados e não valida pagamentos reais. As capturas
anteriores da biblioteca continuam identificadas como testes locais.

O CI amplo não deve ser descrito como verde: seu empacotamento do banco vazio encontra um hash
histórico divergente em `20260223193634_53550802-f9c7-4caf-8aca-9dbd9741eb24.sql`. A falha foi
reproduzida com os arquivos canônicos de `origin/main` (`00d55d38`), extraídos diretamente do Git,
sem as alterações desta entrega. O empacotador de produção do projeto atual passou com 386/386
registros, zero drift e zero pendências. O histórico antigo não foi reescrito para ocultar a falha.
