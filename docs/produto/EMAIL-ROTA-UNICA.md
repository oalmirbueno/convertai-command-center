# E-mail profissional numa rota só

Feito em 18/11/2026. Pedido do Almir: o fluxo do e-mail profissional rápido, simples e sem burocracia. O cliente pede pela página, o pedido chega no admin, o Almir marca como pago e o cliente cai na área certa do `/app`.

Nada disto está em produção. Para ligar, ver "Para publicar", no fim.

## 1. Auditoria: o que existia

| Onde | O que fazia | Situação |
|---|---|---|
| `/email` (`src/pages/EmailLanding.tsx`) | Página de venda, preços pela RPC `produto_precos` | Fica igual |
| `/email/pedir` (`src/pages/EmailPedir.tsx`) | Pedido em 3 passos: domínio e caixas, acesso, envio | Fica, e passa a ser **o** caminho do pedido |
| `/app/email`, oferta (`EmailDoProduto.tsx`, `OfertaDeEmail`) | **Segundo formulário de pedido**, com outra validação | Removido: virou um botão para `/email/pedir` e mostra o andamento do pedido |
| Ação `pedir_email` (função `produto`) | Gravava só histórico, um aviso no sino e **um negócio novo no Comercial a cada envio** | Agora grava a entrada; o negócio no Comercial só nasce com entrada nova |
| `/produto` › E-mail (`EmailDaCasa.tsx`) | Domínio cadastrado **à mão** ("Novo domínio"), etapas, caixas, DNS | O domínio nasce quando a entrada é paga; o botão solto de novo domínio saiu |
| `/produto` › Empresas (`ContasDaCasa.tsx`) | Caixa "E-mail profissional" na ficha, "Cobrar a migração" (Asaas) | Fica. Pagar a migração pelo Asaas agora também anda a entrada |
| Ficha do cliente › Extras (`ExtrasDoCliente.tsx`) | Extra "E-mail profissional" com cobrança no `billing`, **sem ligação** com o produto | Fica, e a entrada pode apontar para o extra (o pagamento mora lá) |
| Financeiro › "CRM e E-mail" | Soma `produto_cobrancas` pagas | Fica igual; o "marcar como pago" lança aqui uma vez |
| Acesso ao `/app/email` | `email_ativo` **e** a empresa liberada pelo CRM | Quem comprou só o e-mail perdia a tela no fim do teste de 7 dias do CRM. Agora o e-mail tem liberação própria |
| MCP | Nenhuma ferramenta de e-mail | 5 ferramentas novas (2.33.0) |
| Funções Supabase | `produto` (pedido, DNS, cobrança da migração), `produto-asaas-webhook` | Mais a função nova `produto-email` (Cloudflare, Zoho, caixa oficial) |

Duplicidades encontradas: dois formulários de pedido; dois cadastros do mesmo serviço (extra na ficha e produto); dois livros de dinheiro sem regra de quem vale (`billing` e `produto_cobrancas`); um negócio no Comercial por envio; domínio cadastrado à mão depois do pedido.

Caso real: a **Imobiliária Prix** está só como extra na ficha (migração R$ 597 em 2 parcelas, a 1ª paga), sem empresa no produto e sem domínio cadastrado. Fica como está até o Almir decidir passar para a rota nova (ver "Prix", abaixo).

## 2. A rota única

```
/email  →  /email/pedir  →  entrada em /produto › E-mail  →  Marcar como pago  →  /app/email
 (venda)    (o pedido)       (Almir vê e combina)           (dinheiro num livro,   (cliente vê o
                                                             e-mail ligado,         andamento)
                                                             domínio + 8 etapas)
```

- **Pedido:** uma entrada aberta por empresa (`produto_email_pedidos`, índice único parcial). Pedir de novo completa a mesma.
- **Marcar como pago** (`produto_email_marcar_pago`), num livro só:
  - entrada ligada a um extra do cliente: quita a cobrança aberta mais antiga do extra;
  - sem extra: lança a cobrança paga no produto (`produto_cobrancas`, forma `manual:pix` etc.);
  - cortesia: não lança valor;
  - "Já está no Financeiro" (`ja_lancado`): não lança nada de novo (a parcela já paga da Prix, por exemplo).

  Depois disso o e-mail da empresa liga, as caixas contratadas sobem, o domínio nasce com o passo a passo de 8 etapas e a entrada vira "Migrando". Repetir não lança de novo.
- **Asaas:** quando o aviso do Asaas confirma a cobrança da migração, a entrada aberta anda sozinha, igual ao manual.
- **Cliente:** `/app/email` segue `produto_email_liberado()` (pedido pago libera, mesmo com o CRM fora do teste). Empresa que só tem o e-mail cai direto em `/app/email` ao abrir o `/app`.

## 3. Ferramentas MCP (2.33.0)

Só para credencial da casa (sem restrição de cliente). Todas passam pelas funções do banco, que deixam histórico com o autor.

| Ferramenta | Faz |
|---|---|
| `aceleriq_email_entradas` | Lista as entradas (abertas por padrão) |
| `aceleriq_email_migracao` | Lê um pedido ou domínio inteiro, com `proximo_passo` |
| `aceleriq_email_registrar` | `pedido`, `dominio` (e integração), `caixa`, `etapa` ou `andamento` |
| `aceleriq_email_marcar_pago` | Só quando o Almir disser que recebeu |
| `aceleriq_email_conferir` | DNS público, Cloudflare ou Zoho, e guarda o resultado |

Recusam senha, token e código (schema fechado e texto com cara de segredo).

## 4. Integração por cliente (Cloudflare e Zoho)

Em `/produto` › E-mail, em cada migração, a seção **Integração**:

- **Cloudflare:** id da zona (a conferência acha pelo domínio e guarda). Lê os registros e aponta proxy ligado em registro de e-mail, MX, SPF duplicado, DKIM, DMARC e a verificação do Zoho. Só leitura.
- **Zoho:** organização (zoid), região, plano e o endereço do admin. O **refresh token** do Zoho do cliente vai direto para o **Vault** (`vault.secrets`, nome `produto_email_zoho_<dominio>`) pela função `produto-email` e não volta para a tela. A conferência lê caixas, apelidos, o limite de 5 do gratuito, a verificação do domínio e o DKIM. Só leitura.
- Nenhuma senha no banco. Campos com nome de segredo são recusados pelo banco.

## 5. Caixa da Aceleriq

Em `/produto` › Caixa da Aceleriq. **Pronta e desligada.**

O que os docs do Zoho dizem (18/11/2026):
- plano gratuito: até 5 usuários, 5 GB, 1 domínio; **sem IMAP, POP e ActiveSync** (página de preços e comparação de planos);
- a documentação da API (`zoho.com/mail/help/api`) **não diz** se o gratuito tem acesso à API. A conferência do Zoho foi feita para responder isso na prática: se o Zoho recusar, a tela mostra "sem API" em vez de erro;
- qualquer plano pago tem IMAP, POP e ActiveSync. O de entrada é o **Mail Lite**, só anual. O valor de R$ 6,25 por usuário por mês vem do levantamento de 13/11 (skill `migracao-email-cliente`); a página de hoje mostra "a partir de R$ 5". Conferir o valor do dia antes de contratar.

Para ligar (decisão do Almir): contratar o Mail Lite só para a caixa da Aceleriq, guardar o token do Zoho da Aceleriq no domínio dela, e nos segredos da função `produto-email` pôr `ACELERIQ_CAIXA_DOMINIO_ID` e `ACELERIQ_CAIXA_LIGADA=sim`. Ligada, a tela lista as mensagens recentes; responder continua no webmail.

## 6. Prix

Para passar a Prix para a rota nova (quando o Almir quiser): criar a empresa da Prix em `/produto` › Empresas ligada ao cliente do painel, criar a entrada apontando para o extra "Migração de e-mail" e marcar como pago com **"Já está no Financeiro"** (a 1ª parcela já está paga; a 2ª continua no extra, para 05/12). Assim nada é lançado duas vezes.

## 7. Testes

- `supabase/testes/email_rota_unica_runner.mjs`: a migration em PGlite, aplicada duas vezes, com **50 cenários** (entrada única, valores, permissões, marcar pago nos três livros, já lançado, Asaas, acesso do e-mail com o CRM vencido, caixas, etapas, integração, Vault).
  `PGLITE_DIR=C:/AI/lf-bolso/work/bolso-db-test node supabase/testes/email_rota_unica_runner.mjs`
- `supabase/functions/mcp-server/modulos/email-profissional_test.ts`: as 5 ferramentas sem banco nem rede (11 testes) e o catálogo em `mcp_test.ts`.
- `src/test/produto-email-rota-unica.test.ts`: regras da tela, conferência da Cloudflare e do Zoho, caixa oficial e convenções.

## 8. Para publicar (só com o ok do Almir)

1. Aplicar `supabase/migrations/20261118170000_produto_email_rota_unica.sql`.
2. Publicar as funções `produto` (pedido vira entrada), `produto-email` (nova) e `mcp-server` (2.33.0).
3. Segredos da função `produto-email`, conforme for usar: `CLOUDFLARE_API_TOKEN` (Zone:Read e DNS:Read na conta da Aceleriq) e `CLOUDFLARE_ACCOUNT_ID`; `ZOHO_CLIENT_ID` e `ZOHO_CLIENT_SECRET` (app OAuth da Aceleriq no console da Zoho).
4. Front: publicar pelo Lovable.

Nenhuma cobrança nova é criada: marcar como pago só registra o que o Almir recebeu. A cobrança no cartão (Asaas) continua como está.

Retorno lógico: tudo é acréscimo. Sem uso, as funções novas ficam paradas; a tabela de pedidos e as colunas novas não mudam regra antiga. Voltar o front devolve as telas de antes.

## 9. Central de e-mail e correio (18/11/2026, segunda rodada)

Pedido do Almir: uma central para administrar os clientes e ver a saúde e os vencimentos; e o correio em link separado, com senha, cada usuário com a sua caixa e um master vendo todas. A estrutura fica pronta e o provedor entra depois.

### Central (`/produto` › Central de e-mail)

Uma linha por cliente com e-mail, do mais urgente para o mais tranquilo. No topo: clientes e caixas, quantos precisam de atenção, quantos vencem em 30 dias, receita, custo e margem.

A saúde (`src/lib/produto/email-central.ts`, com teste) junta:

- cobrança em atraso e acesso do cliente fechado (crítico);
- registro do domínio vencendo: aviso com 45 dias, crítico com 7 e depois de vencido;
- plano de e-mail vencendo: aviso com 30 dias;
- DNS de domínio no ar com item faltando (crítico) ou nunca conferido (atenção);
- Zoho gratuito com mais de 5 caixas (crítico) e no limite de 5 (lembrete);
- caixas acima do contratado e caixas pedidas pelo cliente esperando.

Abrir o cliente mostra os avisos e deixa anotar quando vence o registro do domínio, quando vence o plano de e-mail, o custo mensal do provedor e qual provedor atende o correio.

### Correio (`/correio`)

Link próprio, fora do painel e do CRM. Mesmo logado, pede a senha de novo ao abrir (vale 8 horas naquele navegador). Cada pessoa vê a própria caixa; quem administra a empresa, ou quem for marcado como master, vê todas. Em Entradas e migrações, cada caixa tem o campo "de quem é".

Sem provedor contratado, a caixa aparece "em preparação" com o botão do webmail. Para ligar depois: escrever o adaptador do provedor em `supabase/functions/produto-correio/modulos/` (o contrato está em `adaptador.ts`), registrar em `ADAPTADORES`, marcar o provedor e "Ligado" no domínio e guardar a senha de aplicativo de cada caixa (vai para o Vault). A tela não muda.

Decisão que fica com o Almir antes de ligar: o master lê o conteúdo das caixas dos outros. Isso precisa estar combinado com a equipe de cada cliente.

### Zoho Mail Lite x Migadu (páginas oficiais lidas em 18/11/2026)

| | Zoho Mail Lite | Migadu |
|---|---|---|
| Como cobra | Por usuário, por mês, só anual | Preço fixo por conta, caixas e domínios ilimitados |
| Preço | A página não mostrou o valor na leitura; a referência de 13/11 é R$ 6,25 por usuário por mês | Mini US$ 90 por ano (ou US$ 9 por mês); Standard US$ 290 por ano |
| 10 clientes com 5 caixas | 50 usuários: cerca de R$ 312 por mês pela referência | Uma conta Mini: US$ 7,50 por mês |
| Armazenamento | 5 ou 10 GB por usuário | 30 GB na conta inteira (Mini), 100 GB (Standard) |
| Limite de envio | Não informado na página | Mini: 100 enviados e 1.000 recebidos por dia, somando TODOS os clientes; Standard: 500 e 3.000 |
| IMAP, POP, SMTP | Sim nos planos pagos | Sim |
| API para criar caixas | Sim | Sim (ainda em beta) |
| Master lendo outras caixas pela API | Não: as mensagens são por conta de usuário | Não há API de mensagens; a leitura é por IMAP, com a senha de cada caixa |

Leitura: para revenda o Migadu custa uma fração e cabe no modelo (uma conta da Aceleriq com os domínios de todos os clientes). Os riscos dele são o limite diário dividido entre todos os clientes (um cliente que dispara muito trava os outros, e o Mini com 100 envios por dia é pouco para 10 clientes), a API em beta e a empresa ser pequena. O caminho prudente é começar no Standard, ou no Mini só para o piloto. Nos dois provedores o master depende da senha de aplicativo de cada caixa guardada no Vault, que é como a estrutura foi feita. Conferir os preços do dia antes de contratar.

### Testes desta rodada

- PGlite: 70 cenários (os 50 de antes e 20 novos: caixa por pessoa, master, permissão entre empresas, segredo no Vault, vencimentos e a leitura da central).
- `src/test/produto-email-central.test.ts`: saúde, vencimentos, resumo, contrato do correio e convenções.

### Para publicar esta rodada

Aplicar `20261118190000_produto_email_central_e_correio.sql`, publicar a função nova `produto-correio` e o front. Nada disso liga o correio: ele continua desligado até existir provedor e adaptador.
