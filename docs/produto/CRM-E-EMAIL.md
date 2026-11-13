# Produto CRM e E-mail

Feito em 13/11/2026. Um produto à parte do painel e da área de membros, vendido por usuário, por mês.

## Os três lugares

| Lugar | Endereço | Quem usa |
|---|---|---|
| Produto (CRM, E-mail, Conta) | `/app` | A empresa cliente: quem administra e os usuários |
| Administração do produto | `/produto` (menu Gestão) | Só o admin da Aceleriq |
| Página de venda | `/crm` | Público, sem login |

O painel (`/dashboard`) e a área de membros (`/membros`) continuam como eram. Cada um tem um atalho para o produto, e quem tem empresa no produto vê os botões CRM e E-mail em destaque no painel do cliente e no Início da área de membros.

## As três visões

- **Admin da Aceleriq** (`/produto`): Empresas (situação, plano, usuários, mensalidade, ficha), E-mail (domínio, passo a passo da migração, caixas, conferência do DNS), Preços (planos, e-mail, prazos, custos, chave da cobrança) e Faturamento. O faturamento também é a aba "CRM e E-mail" do Financeiro.
- **Quem administra a empresa** (`/app/conta`): equipe e convites, plano e assinatura no cartão, faturas e dados da empresa.
- **Usuário da empresa**: CRM e e-mail. Na Conta vê só a equipe e o próprio acesso.

## O CRM é o mesmo do Comercial

A tela é a `AdminComercial`. O que muda é onde o dado mora: a casa usa `commercial_*`; a empresa usa `crm_*`, que têm a mesma estrutura mais `conta_id`. O banco só entrega as linhas da empresa de quem está logado (`crm_conta_atual()`), e por isso o front não manda `conta_id`: só troca o nome da tabela (`src/lib/comercial/escopo.ts`).

Fora do CRM da empresa: Caixa do comercial, Mercúrio, Marketing da casa, campanhas da Meta, proposta pela Mesa e o cadastro de cliente no ganho. A nota de encaixe do Jev também fica só na casa, porque a régua é a do cliente ideal da Aceleriq.

A Máquina de leads usa a mesma fila e o mesmo motor. A busca da empresa leva `conta_id`, respeita o limite de buscas do plano no mês e, quando usa o Google Maps, anota o custo estimado em `produto_custos`.

O admin da Aceleriq não lê o CRM dos clientes: vê só contagens (negócios, último uso).

## Chegada, ramo e aparência

- **Chegada antes do cadastro** (`/crm/comecar`, e dentro de `/app` para quem já tem login): ramo, objetivo, empresa e funil, uma pergunta por tela. O acesso é o último passo. As respostas ficam guardadas no aparelho, então confirmar o e-mail e voltar não faz perguntar de novo.
- **CRM por ramo:** o ramo dá ao funil os nomes que ele usa (a imobiliária tem "Visita", a clínica tem "Avaliação"). As sete etapas são as mesmas por dentro; o nome que a equipe lê pode ser trocado em Conta, Funil (`src/lib/produto/nichos.ts`).
- **Aparência** (Conta, Aparência): logo, nome do topo e cor de destaque da empresa. O tema claro ou escuro é de cada pessoa (botão no topo).
- **Visual:** fundo com brilho suave e vidro leve no topo, na barra de baixo e no cartão da chegada (`src/components/produto/produto.css`), com saída lisa para navegador sem desfoque.

## Conexões: API, Claude e ChatGPT

- Em Conta, Conexões, quem administra cria chaves de API (até 10 ativas). A chave aparece inteira uma vez; no banco fica só o resumo sha256 (`produto_chaves_api`).
- **API REST** em `/functions/v1/produto-api/v1` (função `produto-api`, pública só com chave): negócios, empresas, compromissos e funil. Cada chave faz 120 chamadas por minuto. Negócio repetido (mesmo e-mail ou WhatsApp em aberto) não é duplicado.
- **Claude e ChatGPT** entram pela porta MCP em `/functions/v1/produto-api/mcp/<chave>`: 11 ferramentas para ler o funil, criar, mover e anotar negócios e marcar compromissos. Nenhuma apaga dados.
- A chave vai no endereço só para os assistentes, porque os conectores deles pedem um endereço. Quem tem o endereço tem o acesso: uma chave por conexão, e revogar quando não usar mais.
- Não testado com o Claude e o ChatGPT de verdade: o protocolo foi conferido por teste, mas a conexão real só existe depois de publicar a função.

## Planos e preços (valores iniciais, editáveis em Preços)

- **Starter**: R$ 49,90 por usuário. CRM completo e 5 buscas por mês na Máquina de leads.
- **Pro**: R$ 79,90 por usuário. 30 buscas com Google Maps, campanhas, cada vendedor vê só os próprios negócios e e-mail profissional incluído (5 caixas).
- **E-mail profissional** para quem não tem o Pro: migração de R$ 597 uma vez, R$ 39,90 por mês com até 5 caixas e R$ 14,90 por caixa adicional.

A mensalidade é calculada no banco (`produto_itens_da_conta`) e a tela mostra a mesma conta (`mensalidadePrevista`).

## Cobrança (Asaas)

- A assinatura nasce no Checkout hospedado do Asaas, recorrente no cartão. O cartão nunca passa pelo nosso servidor.
- O pagamento só vale pelo aviso do Asaas (`produto-asaas-webhook`), conferido de novo na API. Cada aviso entra uma vez (`produto_eventos`).
- Mudar plano ou usuários de quem já assina muda o valor da assinatura no Asaas, a partir da próxima cobrança.
- A migração do e-mail é uma cobrança avulsa (Pix, boleto ou cartão), criada pela ficha da empresa.
- Teste: 7 dias. Atraso: 5 dias de tolerância e depois o acesso pausa. Os dados nunca são apagados.

### Para ligar a cobrança

1. Aplicar a migration `20261113120000_produto_crm_e_email.sql` e publicar as funções `produto`, `produto-api`, `produto-asaas-webhook`, `comercial-leads` e `send-transactional-email`.
2. Conferir a chave `ASAAS_API_KEY` e o `ASAAS_WEBHOOK_TOKEN` em Configurações, Chaves e custos (são os mesmos do Comercial).
3. No Asaas, em Integrações, Webhooks, criar um webhook para `https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/produto-asaas-webhook`, com o mesmo token, versão 3 e os eventos de cobrança (PAYMENT), assinatura (SUBSCRIPTION) e checkout (CHECKOUT).
4. Fazer uma assinatura de teste com uma chave de sandbox (`_hmlg_`) e conferir: checkout abre, pagamento confirma, empresa vira Ativa, a troca de usuários muda o valor.
5. Em `/produto`, Preços, ligar "Cobrança no cartão".

Ainda não confirmado na prática (a documentação do Asaas não fecha): se o `PUT /v3/subscriptions/{id}` aceita `value` em assinatura criada por checkout, e o formato de `nextDueDate` do checkout. O código recusa a mudança quando o Asaas não devolve o valor novo, então o erro aparece na tela em vez de passar calado.

## E-mail profissional

O serviço segue o piloto: contas do próprio cliente no provedor (Zoho) e no DNS (Cloudflare), a Aceleriq faz a migração e cobra a mensalidade. Ao cadastrar o domínio em `/produto`, E-mail, o passo a passo de 8 etapas nasce pronto. A conferência do DNS (MX, SPF, DKIM, DMARC) só lê o DNS público.

Para o cliente ver a área de E-mail, a empresa precisa estar com "E-mail profissional" marcado na ficha.

## Testes

- `src/test/produto-crm-email.test.tsx`: regras de escopo, mensalidade, Asaas, DNS e convenções.
- `scripts/testar-produto-visual.mjs`: as telas em 390 e 1440 px com dados sintéticos.
- A migration foi ensaiada num Postgres embutido com as migrations reais do Comercial: aplica duas vezes sem erro e passa 71 conferências de isolamento entre empresas, situação da conta, mensalidade e faturamento.

## Retorno lógico

Tudo é acréscimo. Para tirar do ar sem apagar nada: desligar "Cobrança no cartão" em Preços e voltar o front. As tabelas `produto_*` e `crm_*` ficam; as do Comercial da casa não mudaram de regra (só `leads_buscas` e `leads_candidatos` ganharam colunas opcionais).
