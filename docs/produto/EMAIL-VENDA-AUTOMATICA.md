# Venda automática do E-mail profissional (fase 1, 19/11/2026)

## O que muda

- **Ofertas no pedido (order bumps).** Catálogo em `produto_ofertas`, editado em Produto › E-mail › Preços › "Ofertas no pedido". Ofertas iniciais:

  | Oferta | Valor | Cobrança | Aparece em | Já vem marcada |
  |---|---|---|---|---|
  | Domínio gerenciado | R$ 14,90 | mensal | todos | sim |
  | Site hospedado e cuidado | R$ 69 | mensal | todos | não |
  | Backup do e-mail antigo | R$ 97 | uma vez | só migração | não |
  | Migração expressa 24 h | R$ 197 | uma vez | só migração | não |

  O pedido guarda o preço que o cliente viu. Mudar o preço depois não muda pedido já feito.
- **Uma fatura só no Asaas** (Pix, boleto ou cartão) com:
  - a migração;
  - o 1º mês do e-mail;
  - o 1º mês das ofertas mensais;
  - as ofertas de uma vez.

  Ela usa a referência `conta:<id>:migracao`, que o aviso do Asaas e o gatilho `produto_email_cobranca_paga` já entendem. Quando a fatura é paga, o pedido é liberado sozinho.
- **Mensalidade automática.** O aviso do Asaas cria a assinatura do e-mail para o mês seguinte (`produto_email_assinaturas`, referência `email:<id>`). Ela fica separada da assinatura do CRM:
  - quem compra só o e-mail não paga o CRM que está em teste;
  - `produto_itens_da_conta` deixa o e-mail de fora quando ele já tem assinatura própria, então o cliente não paga o e-mail duas vezes.
- **Quando a assinatura não nasce:** cliente da Aceleriq com o e-mail no extra da ficha, empresa em cortesia, ou e-mail incluído no plano do CRM.
- **Mensalidade do e-mail atrasada ou estornada:** a casa é avisada e o e-mail não é cortado (fase 1).
- **Quem pode pagar ou gerar o link:**
  - O cliente paga sozinho em `/email/pedir` só com `pagamentos_ativos` ligado.
  - A casa gera o link em Entradas › "Gerar o link de pagamento". Esse caminho funciona mesmo com a cobrança geral desligada.
- **Domínio que existe mas ainda não tem e-mail:** o pedido marca "e-mail novo". Não há migração e as ofertas só da migração não aparecem.

## Testes

- Banco, em PGlite (25 cenários):

  ```
  PGLITE_DIR=C:/AI/lf-bolso/work/bolso-db-test node supabase/testes/email_venda_automatica_runner.mjs
  ```

- `src/test/produto-email-venda-automatica.test.ts` (19 testes): fatura, assinatura com Asaas e banco falsos, a mesma conta na tela e no banco, e as travas do aviso.
- Tela `/email/pedir`: `scripts/testar-email-pedido-visual.mjs` com o servidor do Vite na porta 4191. Cobre cobrança ligada, desligada e e-mail novo, em 390 e 1440 px.

## Para publicar (só com o ok do Almir)

1. Aplicar a migration `20261119150000_produto_email_venda_automatica.sql`.
2. Publicar as funções `produto` e `produto-asaas-webhook`:

   ```
   npx --yes supabase@2.117.0 functions deploy <função> --project-ref jjjtkowvxemvituvywvf --use-api
   ```

   O `produto-asaas-webhook` vai com `--no-verify-jwt`, como hoje.
3. Publicar o painel com `npm run publicar`.
4. **Teste em sandbox antes de qualquer cobrança real.** Com a chave do Asaas de teste (`_hmlg_`):
   1. gerar o link de um pedido de teste em Entradas;
   2. pagar na fatura do sandbox;
   3. conferir que o pedido foi para "em andamento";
   4. conferir que nasceu uma linha em `produto_email_assinaturas` com a assinatura do mês seguinte.
5. Só depois disso, ligar `pagamentos_ativos` para o cliente pagar sozinho.

O Asaas exige que o domínio do painel esteja cadastrado na conta para aceitar o `successUrl` da fatura. Hoje ele já está, porque o checkout do CRM usa o mesmo domínio.

## Migadu, o correio da Aceleriq (escolha do Almir em 19/11/2026)

- **Plano:** Standard, US$ 290 por ano, conferido na página do Migadu em 19/11. Uma conta só para todos os clientes, com domínios e caixas ilimitados. Os limites valem para a conta toda:
  - 100 GB de espaço;
  - 3.000 mensagens recebidas por dia;
  - 500 mensagens enviadas por dia.

  A conta abre em teste grátis, sem cartão. O plano é escolhido depois, em Billing.
- **Contratar é com o Almir.** Ele faz o cadastro em https://admin.migadu.com/public/signup, aceita os termos e paga. Depois cria a chave em My Account › API Keys.
- **Segredos da função `produto-email`** (nunca em arquivo, banco ou commit):
  - `MIGADU_USUARIO`: o e-mail da conta Migadu;
  - `MIGADU_API_KEY`: a chave da API.
- **No painel**, em Produto › E-mail › domínio com provedor Migadu, há uma seção "Migadu" com três botões:
  - **Montar:** cria o domínio com o DNS de fora, as caixas por convite (o Migadu manda o link de criar a senha para o e-mail de hoje da pessoa) e os apelidos. Mostra os registros para a Cloudflare.
  - **Conferir.**
  - **Ativar.**
- **Domínios novos que nascem de um pagamento** já entram com provedor `migadu`. Os que já existem (Zoho, Google) não mudam.
- **A conferência do DNS** reconhece o Migadu: MX aspmx1/aspmx2, SPF `include:spf.migadu.com` e DKIM por CNAME em key1, key2 e key3.
- **Ainda falta:**
  - ler e enviar dentro do painel (o correio), que precisa de IMAP e SMTP: `imap.migadu.com:993` e `smtp.migadu.com:465`. Vai ser testado com a conta real antes de ligar;
  - publicar o DNS sozinho pela Cloudflare (fase 3).

## Próximas fases

- 2: criar o domínio e as caixas no Migadu pela API depois do pagamento. Fica em modo simulado até a conta ser contratada.
- 3: DNS automático na Cloudflare e um vigia que manda as boas-vindas quando o DNS fica certo.
- 4: robô de migração IMAP.
