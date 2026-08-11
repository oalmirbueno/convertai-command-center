# Plano de migração do Financeiro V2

Status: implementação em branch, sem autorização para produção.

## Objetivo e limites

O Financeiro V2 cria uma fonte canônica para catálogo e versões de planos,
vigências de clientes, obrigações por competência, liquidações de caixa, custos
recorrentes, configurações, fechamento mensal e auditoria.

O lote é aditivo. Ele não altera nem exclui registros históricos de `billing`,
`project_payments`, `payment_installments`, `expenses`, contratos ou perfis. Uma
mudança de preço vale somente para vigências e competências futuras
explicitamente selecionadas.

## Autoridade dos dados

1. Cobranças e pagamentos realizados continuam históricos e imutáveis.
2. Planos atuais em `profiles.plan_name` e `profiles.plan_value` servem apenas
   para criar snapshots de revisão, sem inferir imposto ou tipo do valor.
3. Clientes sem plano ou sem valor permanecem sinalizados para revisão.
4. Nenhuma competência, cobrança ou liquidação é criada durante o backfill.
5. Alterações de preço e vínculo passam a valer no primeiro dia de uma
   competência aberta; nunca há vigência ambígua no meio do mês.

## Ordem de publicação

1. Revisar o draft PR e aprovar o desenho de dados e RLS.
2. Confirmar backup restaurável do banco no gate do workflow.
3. Executar preflight somente leitura e registrar contagens e somas.
4. Aplicar a migration forward-only pelo workflow oficial.
5. Executar pgTAP, smoke das RPCs e reconciliação.
6. Publicar o frontend do mesmo SHA em Preview.
7. Validar os cinco fluxos financeiros e a página Clientes.
8. Publicar o frontend somente após aprovação humana separada.

Banco e frontend não devem ser publicados manualmente pelo painel.

## Preflight de produção

O preflight deve falhar se qualquer condição abaixo não for atendida:

- projeto Supabase esperado e migrations locais alinhadas com o ledger;
- ausência das tabelas V2 ou presença de uma versão idêntica já aplicada;
- integridade referencial das tabelas financeiras legadas;
- contagens e somas-base registradas por tabela e status;
- nenhum período V2 fechado conflitante;
- backup confirmado pelo responsável do release.

Snapshot mínimo de reconciliação:

| Fonte | Contagem observada | Soma observada |
| --- | ---: | ---: |
| `billing` | 27 | R$ 16.356,00 |
| `expenses` | 8 | R$ 2.774,27 |
| `payment_installments` | 8 | R$ 7.288,00 |

Esses valores documentam o diagnóstico de 10/08/2026. O gate deve consultar os
valores atuais e exigir revisão se houver mudança antes do release.

## Reconciliação após a migration

- nenhuma linha legacy atualizada ou excluída;
- uma identidade de plano por nome atual não vazio, sem duplicação;
- uma versão inicial por plano importado;
- no máximo um termo atual de revisão por cliente elegível;
- zero cobranças, liquidações ou competências inventadas pelo backfill;
- RLS nega anon, design e traffic nas tabelas financeiras globais;
- cliente não lê tabelas, views ou RPCs financeiras internas; uma futura visão
  do portal deverá usar contrato próprio com colunas permitidas;
- manager tem somente a leitura explicitamente concedida;
- admin é o único papel com mutações financeiras;
- geração repetida da mesma competência não muda contagem ou soma;
- liquidação repetida com a mesma chave idempotente não duplica caixa;
- a mesma chave idempotente com payload diferente é rejeitada;
- uma obrigação de competência fechada pode ser recebida em um mês de caixa
  aberto, sem reabrir ou reescrever a obrigação;
- fechamento e mutações travam a mesma linha de competência, então o período
  fechado rejeita mutações mesmo sob concorrência;
- uma competência de cliente já materializada não pode receber novo vínculo
  contratual retroativo.

## Cutover gradual

O frontend V2 lê apenas as RPCs e tabelas novas. O legado permanece disponível
durante a validação, mas nenhuma tela V2 escreve em `profiles.plan_*` ou gera
`billing` no carregamento. O botão de competência exige prévia e confirmação.
O modo Caixa usa `settled_on`; Competência usa a obrigação mensal; Previsão
combina saldos materializados com ocorrências futuras virtuais, sem gravá-las.
Manager recebe somente a leitura V2 prevista pela RLS, enquanto vínculos,
liquidações, catálogos e configurações continuam exclusivos do admin.
Clientes continuam no financeiro legado até um lote de portal com payload
reduzido, sem custo direto, margem, reserva fiscal, notas ou chaves internas.

O corte de outros consumidores, como dashboard, projeção, portal do cliente e
lembretes, deve ocorrer em lotes seguintes. A remoção das tabelas ou colunas
legacy não faz parte desta entrega.

## Recuperação de incidente

O banco é forward-only. Não executar `DROP`, restaurar valores antigos sobre
fatos realizados ou reverter a migration destrutivamente.

Em incidente:

1. interromper novas mutações V2 no frontend;
2. republicar o frontend anterior, que continua compatível com o schema
   aditivo;
3. preservar logs, chaves idempotentes e snapshots de reconciliação;
4. preparar uma nova migration de correção revisada;
5. confirmar novo backup e repetir o workflow oficial.

## Checklist funcional de Preview

- cinco abas: Visão geral, Fluxo de caixa, Mensalidades, Custos fixos, Planos e
  preços;
- modos Caixa, Competência e Previsão não misturam fatos;
- gross-up de R$ 1.000,00 a 14% resulta em R$ 1.162,79 e reserva de R$ 162,79;
- pagamento parcial reserva imposto proporcional ao snapshot;
- custo fixo é deduzido uma vez no resultado global;
- cliente pausado ou arquivado não gera competência;
- competência repetida não duplica mensalidade;
- taxa de setup gera uma obrigação separada, com gross-up, uma única vez no
  início do termo;
- nova versão de plano não altera competência passada;
- plano importado em revisão recebe uma nova versão validada no mesmo catálogo
  antes de o cliente ser vinculado à competência escolhida;
- pró-labore atual é R$ 3.000,00 e o alvo de R$ 10.000,00 é apenas sugestão;
- Ferramentas e sistemas é R$ 2.500,00, sem duplicação;
- custo direto estimado de R$ 275,00 aparece identificado como estimativa;
- clientes sem plano ou preço mostram pendência, sem valor sugerido.
