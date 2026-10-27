# Bolso: carteiras, recargas e OpenRouter

Plano incremental de 27/10/2026. Não é autorização de publicação ou alteração de produção.

## Escopo e estado

A aprovação comercial existente é R$ 97 pelo acesso anual, com um pacote inicial e recargas avulsas. Quantidade inicial, tarifas finais, preços/quantidades dos pacotes e provisão de IA precisam de definição. Esta migração não cria políticas, acessos, créditos ou ofertas; não altera flags, não cobra e não habilita pagamentos.

O backend Bolso já existe no banco atual. O baseline `20261027120000_aceleriq_de_bolso.sql` não consta no histórico de migrações remoto segundo o levantamento anterior. **Não reaplicar o baseline nem executar db push, db reset ou replay geral.** Conferir o schema real, e aplicar somente o incremento explicitamente revisado no projeto existente `jjjtkowvxemvituvywvf`. Não criar outro projeto Supabase.

Baseline local utilizado nos testes, SHA-256 dos bytes: `b42c139cd5ffc15ba57c0e36771d9135b9b39f9173c602d7bf93f0cdec1815a5`.
Incremento: `supabase/migrations/20261027220000_bolso_carteiras_recargas_openrouter.sql`.

## Decisões de implementação

- Direitos continuam por `auth.uid()`. Uma conta não consulta nem consome créditos da outra; não há carteira compartilhada com o administrador ou com a Mesa Ads. Carteiras real e teste permanecem distintas.
- Anual/mensal/teste habilitam acesso. Recarga é exclusivamente um lote de créditos; nunca concede ou renova acesso. O fim do anual pode deixar saldo guardado e visível na carteira real, mas não permite nova geração. Um novo acesso válido pode voltar a consumir lotes que ainda estejam válidos.
- A política do acesso ativo de maior vencimento define tarifa e formatos, tanto na tela quanto no pedido. Critério de desempate determinístico: criação e id. Recarga não muda a tarifa do cliente.
- Cada pedido reserva a tarifa entre lotes válidos, primeiro os que vencem antes. Lotes vazios são ignorados. `bolso_jobs.direito_id` identifica o acesso que autorizou o trabalho; as linhas `reserva` identificam os lotes que pagaram por ele.
- Captura e liberação reproduzem exatamente essas linhas. Cada par trabalho/lote só pode encerrar uma vez. Histórico antigo continua válido: um lote por pedido é um caso particular.
- Expiração/estorno passa a ser idempotente pela soma do lote sob lock. Se uma reserva for devolvida depois de o lote vencer ou ser revogado, a devolução é encerrada na mesma transação; não ressuscita saldo. Isso exige remover a antiga unicidade de uma expiração por direito.
- Mutações financeiras usam advisory lock por pessoa. A admissão usa também um lock global para validar o teto diário de forma serializada entre contas. Worker/cancelamento/reconciliação preservam row lock do trabalho e idempotência já existentes.
- Novos trabalhos reais recebem `openrouter`; históricos `openai` não são renomeados. Lease vencido dos dois provedores reais vira `incerto`, exigindo conciliação. Não há retry automático da chamada incerta.
- Catálogo é versionado: salvar cria rascunho novo; publicar exige política comercial aprovada e arquiva a versão publicada anterior do mesmo código. Valores e autoria não podem ser reescritos. Nenhum seed é criado.
- `provisao_ia_centavos` é uma condição interna planejada por pacote, entre zero e o preço. Ainda não movimenta dinheiro nem comprova reserva financeira. O custo operacional do fornecedor continua separado do crédito comercial. Uma integração futura precisa transformar a provisão do pedido pago em lançamento financeiro efetivo.
- Aprovações pelo contrato legado de pagamento ficam guardadas, mesmo se alguém habilitar a flag, pois não contêm pedido, valor, moeda ou oferta verificados. Não concedem anual, mensal nem recarga. Refunds históricos preservam o tratamento existente e o lock por titular. A colisão histórica de referências entre provedores permanece uma limitação do legado; não conectar mais provedores antes da integração nova.

## Contrato do catálogo

`bolso_admin_ofertas_listar()` retorna array de ofertas completo, somente para administrador.

`bolso_admin_oferta_salvar(_dados jsonb)` retorna UUID de uma **nova versão rascunho**. Campos obrigatórios: `codigo`, `nome`, `preco_centavos`, `creditos`, `validade_dias`, `provisao_ia_centavos`, `politica_id`; `descricao` é opcional. `codigo` possui 3 a 64 caracteres minúsculos, números ou hífen. Valores monetários são centavos inteiros de BRL. Tipo nesta fase: somente `recarga`.

`bolso_admin_oferta_aprovar(_id uuid)` publica um rascunho; `bolso_admin_oferta_arquivar(_id uuid)` retira a oferta de exibição. Essas operações não ativam checkout ou concessões e deixam auditoria.

`bolso_ofertas_listar()` retorna `{pagamentos_habilitados:false, acesso_ativo:boolean, ofertas:[]}`. Cada item contém id, código, versão, tipo, nome, descrição, preço em centavos, moeda, créditos, validade em dias, tarifas de texto/imagem e formatos. Não devolve provisão, autores ou política interna. Com acesso ativo, mostra apenas ofertas vinculadas à política desse acesso; sem acesso, mostra o catálogo publicado, mas continua sem compra. Políticas arquivadas retiram suas ofertas da lista pública.

## Preflight somente leitura

Executar com ferramenta de banco autorizada, sem publicar, e guardar apenas agregados sem PII/segredos. Confirmar destino do projeto fora da consulta. Primeiro inventariar objetos; se faltar algo, parar antes das consultas que dependem dele.

```sql
SELECT current_database(), current_user, version();
SELECT to_regclass('public.bolso_config') AS config,
       to_regclass('public.bolso_creditos') AS creditos,
       to_regprocedure('public.bolso_pedir(uuid,text,text,text,integer)') AS pedir,
       to_regclass('public.bolso_ofertas') AS ofertas;
SELECT version FROM supabase_migrations.schema_migrations
WHERE version IN ('20261027120000','20261027220000');
SELECT modulo_exposto,geracao_real,pagamentos,modo_simulado,kill_switch,limites
FROM public.bolso_config;
SELECT estado,provedor,count(*) FROM public.bolso_jobs GROUP BY estado,provedor ORDER BY estado,provedor;
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'
AND tablename='bolso_creditos' ORDER BY indexname;
SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.bolso_jobs'::regclass AND contype='c';
-- Todos os agregados abaixo precisam ser zero.
SELECT count(*) AS lotes_negativos FROM (
 SELECT direito_id FROM public.bolso_creditos GROUP BY direito_id
 HAVING sum(delta_disponivel)<0 OR sum(delta_reservado)<0
) x;
SELECT count(*) AS titulares_incoerentes
FROM public.bolso_creditos c JOIN public.bolso_direitos d ON d.id=c.direito_id
WHERE c.user_id<>d.user_id OR c.carteira<>d.carteira;
SELECT count(*) AS jobs_incoerentes
FROM public.bolso_creditos c JOIN public.bolso_jobs j ON j.id=c.job_id
WHERE c.user_id<>j.user_id OR c.carteira<>j.carteira;
SELECT count(*) AS reservas_incoerentes FROM (
 SELECT j.id,j.tarifa,COALESCE(sum(c.quantidade) FILTER(WHERE c.tipo='reserva'),0) AS reservado
 FROM public.bolso_jobs j LEFT JOIN public.bolso_creditos c ON c.job_id=j.id
 GROUP BY j.id HAVING COALESCE(sum(c.quantidade) FILTER(WHERE c.tipo='reserva'),0)<>j.tarifa
) x;
SELECT count(*) AS saldo_reservado_sem_trabalho_ativo FROM (
 SELECT c.job_id FROM public.bolso_creditos c JOIN public.bolso_jobs j ON j.id=c.job_id
 WHERE j.estado NOT IN ('na_fila','processando','incerto') GROUP BY c.job_id HAVING sum(c.delta_reservado)<>0
) x;
-- Guardar hashes das funções reais para detectar divergência do baseline.
SELECT p.oid::regprocedure::text AS funcao,md5(pg_get_functiondef(p.oid)) AS hash
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='bolso_privado' AND p.proname IN
 ('expirar','saldo','direito_ativo','liberar','capturar','conceder'))
 OR (n.nspname='public' AND p.proname IN
 ('bolso_estado','bolso_pedir','bolso_trabalho_pegar','bolso_admin_revogar','bolso_evento_pagamento'))
ORDER BY 1;
```

Conferir as definições reais contra o baseline quando os hashes/assinaturas divergirem; não sobrepor alterações desconhecidas. Os índices e o nome da constraint de provedor precisam corresponder aos nomes do incremento. O catálogo novo deve estar ausente. A migração aborta caso exista qualquer pedido na fila, processando ou incerto; não cancela trabalhos existentes. As flags de pagamento devem continuar OFF conforme autorização do dono. O SQL não as muda automaticamente.

## Aplicação controlada e verificação

1. Revisar diff e testes, conferir integração do worker OpenRouter e registrar autorização específica para o incremento. Nenhuma instrução deste documento substitui essa autorização.
2. Pausar a admissão/geração durante a janela, após autorização operacional; reconciliar fila incerta antes. Preservar os valores anteriores para restaurar somente o que estava autorizado. Não alterar pagamentos.
3. Aplicar somente este arquivo, com sua própria transação. Se o baseline não estiver registrado, não usar replay automático como forma de corrigir o histórico. O registro do incremento deve seguir o mecanismo de migrations do ambiente sem mentir que o baseline foi reaplicado.
4. Conferir `pagamentos` inalterado, catálogo vazio, índices novos e schema RLS. Conferir que o worker aceita `openrouter` antes de retomar geração.
5. Homologar conta autorizada sem misturar contas; uma campanha de teste, um texto e uma imagem reais são operação separada e devem respeitar orçamento e limites. Os testes PGlite abaixo não chamam fornecedor.

## Testes reproduzíveis sem produção

Na raiz do checkout, usando Node já instalado:

```powershell
npm install --prefix work/bolso-db-test --no-save --package-lock=false @electric-sql/pglite@0.3.14
node supabase/testes/bolso_recargas_runner.mjs
```

O runner cria PostgreSQL WebAssembly em memória, stubs mínimos explícitos de auth/storage e aplica baseline + incremento **somente nessa memória**. Executa `supabase/testes/bolso_recargas_cenarios.sql` dentro de BEGIN/ROLLBACK, com contas `.invalid` e valores comerciais sintéticos. Não importa `.env`, não lê credenciais, não usa CLI Supabase, não acessa banco remoto e não chama IA. Dependência fica em `work/`, fora da app. Não rodar o script antigo `bolso-testar-banco.mjs` para validar este incremento: ele aponta o projeto remoto e tenta criar o baseline novamente.

Os cenários cobrem reserva em três lotes, anual zerado seguido de recarga, tarifa do acesso, cancelamento/falha/reconciliação, expiração durante geração, revogação, idempotência, isolamento A/B, OpenRouter incerto, catálogo sem seeds, política de publicação, imutabilidade, campos internos omitidos e pagamentos fail-closed.

Limites da evidência: auth/storage usam fixtures, não o PostgREST/GoTrue real; PGlite executa uma conexão, portanto não comprova contenção multi-sessão. Antes da liberação comercial, executar em PostgreSQL isolado com duas sessões simultâneas: (a) duas reservas disputando o último saldo; (b) reserva versus revogação; (c) falha versus conclusão do mesmo job; (d) dois usuários disputando a última vaga global; (e) mesma referência de evento e publicação simultânea do mesmo código. Esperado: serialização, nenhum saldo negativo e no máximo um encerramento por lote. Não simular esses casos no banco de clientes.

## Rollback lógico

Não voltar aos índices antigos depois de existir um trabalho com mais de um lote, e não recriar o antigo `capturar/liberar`: eles perderiam a correspondência das reservas. Não apagar histórico, ofertas ou direitos.

Se houver problema, sob autorização operacional: pausar geração (`kill_switch`) e retirar o catálogo público arquivando as ofertas necessárias. Manter frontend de consulta/extrato e o worker alinhado à conciliação. Preservar pendências para análise; não reenfileirar jobs incertos sem conferir o fornecedor. Corrigir por novo incremento compatível. O frontend pode voltar à tela de créditos anterior sem tocar o ledger. Pagamentos permanecem desligados.

Se a migração abortar antes do COMMIT, PostgreSQL desfaz os objetos/índices/funções da transação. Se já houve COMMIT, o retorno seguro é operacional, não reversão destrutiva do schema.

## Próxima integração de pagamentos

Criar pedido server-side com titular autenticado, oferta/versão, preço/moeda, créditos, validade, política e provisão congelados. Validar assinatura do provedor e valor realmente pago; namespace de referência por provedor; registrar provisão operacional com idempotência; conceder lote somente uma vez. A recarga deve exigir acesso válido e preservar a validade do acesso. Reembolso/chargeback precisam apontar a ordem exata e estornar apenas o saldo remanescente dos lotes vinculados. Não utilizar a política global mais recente e não aceitar quantidade/valor/titular fornecidos pelo browser. Não expor chave ou saldo operacional OpenRouter ao cliente.
