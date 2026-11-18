// Teste isolado da migration 20261118140000_produto_email_rota_unica em PGlite.
// Usa as tabelas reais do produto (seções 1 a 4 de 20261113120000) e recortes mínimos do resto.
// Não usa credencial nem projeto Supabase. PGlite fica fora do package.json:
//   PGLITE_DIR=<pasta com node_modules/@electric-sql/pglite> node supabase/testes/email_rota_unica_runner.mjs
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const requireTest = createRequire(resolve(process.env.PGLITE_DIR || 'work/bolso-db-test', 'package.json'));
const { PGlite } = requireTest('@electric-sql/pglite');
const db = new PGlite();

const BASE = 'supabase/migrations/20261113120000_produto_crm_e_email.sql';
const NOVA = 'supabase/migrations/20261118140000_produto_email_rota_unica.sql';
const linhas = readFileSync(BASE, 'utf8').split('\n');
// 1..356: catálogo, contas, cobranças, e-mail (tabelas e etapas) e as funções de quem é quem.
// 1385..1397: produto_avisar_casa.
const base = linhas.slice(0, 356).join('\n') + '\n' + linhas.slice(1384, 1397).join('\n');

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA vault;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.role', true), '') $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'client', 'member');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_u uuid, _r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _u AND role = _r) $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, company_name text, full_name text, email text);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid, message text, notification_type text, link text);
CREATE TABLE public.client_extras (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, nome text NOT NULL,
  categoria text NOT NULL, cobranca text NOT NULL, valor numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'ativo');
CREATE TABLE public.billing (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, type text NOT NULL,
  amount numeric NOT NULL, status text NOT NULL DEFAULT 'pending', due_date date NOT NULL, paid_date date, paid_amount numeric,
  description text, extra_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
CREATE FUNCTION vault.create_secret(_s text, _n text, _d text) RETURNS uuid LANGUAGE sql AS
  $$ INSERT INTO vault.secrets (secret, name, description) VALUES (_s, _n, _d) RETURNING id $$;
CREATE FUNCTION vault.update_secret(_id uuid, _s text) RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = _s WHERE id = _id $$;
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
`);

try {
  await db.exec(base);
  console.log('Base do produto aplicada');
} catch (e) {
  console.error('Erro na base', e.message, e.where, e.position);
  process.exit(1);
}
for (const vez of ['Aplicada', 'Reaplicada (idempotente)']) {
  try {
    await db.exec(readFileSync(NOVA, 'utf8'));
    console.log(vez, NOVA);
  } catch (e) {
    console.error('Erro na migration', e.message, e.where, e.position);
    process.exit(1);
  }
}

const DONO = '00000000-0000-4000-8000-00000000d0d0';
const CLIENTE = '00000000-0000-4000-8000-0000000000c1';
const ADMIN_A = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_B = '00000000-0000-4000-8000-0000000000b1';
await db.exec(`
INSERT INTO auth.users (id, email) VALUES ('${DONO}', 'dono@x.com'), ('${ADMIN_A}', 'a@empresa-a.com.br'), ('${ADMIN_B}', 'b@empresa-b.com.br');
INSERT INTO public.user_roles VALUES ('${DONO}', 'admin');
INSERT INTO public.profiles (id, company_name) VALUES ('${CLIENTE}', 'Imobiliária Teste');
INSERT INTO public.produto_contas (id, nome, estado, teste_ate, email_cobranca) VALUES
  ('10000000-0000-4000-8000-00000000000a', 'Empresa A', 'teste', now() - interval '1 day', 'a@empresa-a.com.br'),
  ('10000000-0000-4000-8000-00000000000b', 'Empresa B', 'teste', now() + interval '3 days', 'b@empresa-b.com.br');
UPDATE public.produto_contas SET client_id = '${CLIENTE}' WHERE id = '10000000-0000-4000-8000-00000000000b';
INSERT INTO public.produto_membros (conta_id, user_id, email, papel, estado) VALUES
  ('10000000-0000-4000-8000-00000000000a', '${ADMIN_A}', 'a@empresa-a.com.br', 'admin', 'ativo'),
  ('10000000-0000-4000-8000-00000000000b', '${ADMIN_B}', 'b@empresa-b.com.br', 'admin', 'ativo');
INSERT INTO public.client_extras (id, client_id, nome, categoria, cobranca, valor) VALUES
  ('20000000-0000-4000-8000-0000000000e1', '${CLIENTE}', 'Migração de e-mail', 'email', 'unico', 597);
INSERT INTO public.billing (client_id, type, amount, status, due_date, extra_id) VALUES
  ('${CLIENTE}', 'one_off', 298.50, 'paid', '2026-11-05', '20000000-0000-4000-8000-0000000000e1'),
  ('${CLIENTE}', 'one_off', 298.50, 'pending', '2026-12-05', '20000000-0000-4000-8000-0000000000e1');
`);
const A = '10000000-0000-4000-8000-00000000000a';
const B = '10000000-0000-4000-8000-00000000000b';

async function como(papel, uid) {
  await db.exec(`SELECT set_config('app.role', '${papel}', false), set_config('app.uid', '${uid || ''}', false);`);
}
async function um(sql, params) {
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : null;
}
async function recusa(sql, params) {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
}

const resultados = [];
const conferir = (teste, ok, detalhe = '') => resultados.push({ teste, ok: !!ok, detalhe });

// 1. A empresa pede pela página: nasce UMA entrada; pedir de novo completa a mesma.
await como('authenticated', ADMIN_A);
let r = await um(`SELECT public.produto_email_registrar_pedido($1, 'Empresa-A.com.br', 3, null, 'Hoje no UOL', 'pagina', $2)`, [A, ADMIN_A]);
conferir('pedido novo pela página nasce', r && r.novo === true && r.pedido.estado === 'novo' && r.pedido.tipo === 'migracao', JSON.stringify(r && r.pedido));
conferir('valores pela tabela de preços', r && Number(r.pedido.valor_migracao) === 597 && Number(r.pedido.valor_mensal) === 39.9);
const pedidoA = r.pedido.id;
r = await um(`SELECT public.produto_email_registrar_pedido($1, null, 7, null, 'São 7 pessoas', 'app', $2)`, [A, ADMIN_A]);
conferir('pedir de novo não duplica', r.novo === false && r.pedido.id === pedidoA && r.pedido.caixas === 7 && r.pedido.dominio === 'empresa-a.com.br');
conferir('caixa extra entra na mensalidade', Number(r.pedido.valor_mensal) === Math.round((39.9 + 2 * 14.9) * 100) / 100, r.pedido.valor_mensal);
conferir('uma entrada aberta por empresa', (await um(`SELECT count(*)::int FROM public.produto_email_pedidos WHERE conta_id = $1`, [A])) === 1);
conferir('aviso no sino só uma vez', (await um(`SELECT count(*)::int FROM public.notifications WHERE message LIKE 'E-mail profissional: Empresa A%'`)) === 1);
conferir('domínio inválido recusa', /Confira o domínio/.test(await recusa(`SELECT public.produto_email_registrar_pedido($1, 'sem ponto', 1)`, [A]) || ''));

// 2. Outra empresa não pede pela A, nem marca pago.
await como('authenticated', ADMIN_B);
conferir('empresa não registra pedido de outra', /administra/.test(await recusa(`SELECT public.produto_email_registrar_pedido($1, 'x.com.br', 1)`, [A]) || ''));
conferir('empresa não marca pago', /administração/.test(await recusa(`SELECT public.produto_email_marcar_pago($1, 'pix')`, [pedidoA]) || ''));
conferir('empresa não lê as entradas da casa', /administração/.test(await recusa(`SELECT public.produto_email_pedidos_da_casa()`) || ''));

// 3. Antes de pagar, a A (teste do CRM vencido) não tem o e-mail liberado.
conferir('sem pagamento, e-mail fechado', (await um(`SELECT public.produto_email_liberado($1)`, [A])) === false);

// 4. O dono marca como pago (Pix): cobrança paga no produto, e-mail ligado, domínio com 8 etapas.
await como('authenticated', DONO);
const lista = await um(`SELECT public.produto_email_pedidos_da_casa('abertos')`);
conferir('casa lê a entrada com a empresa', Array.isArray(lista) && lista.length === 1 && lista[0].empresa === 'Empresa A');
conferir('data no futuro recusa', /futuro/.test(await recusa(`SELECT public.produto_email_marcar_pago($1, 'pix', null, (now() + interval '3 days')::date)`, [pedidoA]) || ''));
conferir('forma desconhecida recusa', /desconhecida/.test(await recusa(`SELECT public.produto_email_marcar_pago($1, 'bitcoin')`, [pedidoA]) || ''));
r = await um(`SELECT public.produto_email_marcar_pago($1, 'pix')`, [pedidoA]);
conferir('marcar pago anda o pedido', r.pedido.estado === 'em_andamento' && r.livro === 'produto' && r.pedido.dominio_id, JSON.stringify(r));
conferir('cobrança paga no produto, valor da migração', (await um(`SELECT count(*)::int FROM public.produto_cobrancas WHERE conta_id = $1 AND estado = 'paga' AND tipo = 'migracao' AND valor = 597 AND forma = 'manual:pix'`, [A])) === 1);
conferir('e-mail ligado com as caixas', (await um(`SELECT email_ativo AND email_caixas_contratadas = 7 FROM public.produto_contas WHERE id = $1`, [A])) === true);
conferir('domínio com o passo a passo', (await um(`SELECT count(*)::int FROM public.produto_email_etapas e JOIN public.produto_email_dominios d ON d.id = e.dominio_id WHERE d.dominio = 'empresa-a.com.br'`)) === 8);
conferir('e-mail liberado mesmo com o teste do CRM vencido', (await um(`SELECT public.produto_email_liberado($1)`, [A])) === true);
r = await um(`SELECT public.produto_email_marcar_pago($1, 'pix')`, [pedidoA]);
conferir('marcar de novo não lança de novo', r.ja_estava_pago === true && (await um(`SELECT count(*)::int FROM public.produto_cobrancas WHERE conta_id = $1`, [A])) === 1);

// 5. A empresa vê o pedido e a liberação na própria área.
await como('authenticated', ADMIN_A);
r = await um(`SELECT public.produto_email_da_conta()`);
conferir('área do cliente: liberado, pedido e domínio', r.liberado === true && r.pedido.estado === 'em_andamento' && r.dominios.length === 1 && r.etapas.length === 8);

// 6. Cliente da Aceleriq com extra de e-mail: quita a cobrança do extra, nada no produto.
await como('service_role', null);
r = await um(`SELECT public.produto_email_registrar_pedido($1, 'imobteste.com.br', 4, 'migracao', null, 'agente', $2, '20000000-0000-4000-8000-0000000000e1')`, [B, DONO]);
const pedidoB = r.pedido.id;
conferir('agente registra pedido ligado ao extra', r.novo && r.pedido.extra_id === '20000000-0000-4000-8000-0000000000e1' && r.pedido.origem === 'agente');
r = await um(`SELECT public.produto_email_marcar_pago($1, 'pix', null, null, $2)`, [pedidoB, DONO]);
conferir('pago pelo extra', r.livro === 'extra' && r.pedido.forma_pagamento === 'extra' && Number(r.pedido.valor_pago) === 298.5, JSON.stringify(r));
conferir('a cobrança aberta do extra foi quitada', (await um(`SELECT count(*)::int FROM public.billing WHERE extra_id = '20000000-0000-4000-8000-0000000000e1' AND status = 'paid'`)) === 2);
conferir('sem lançamento duplicado no produto', (await um(`SELECT count(*)::int FROM public.produto_cobrancas WHERE conta_id = $1`, [B])) === 0);

// 7. O avanço pelo MCP: caixa, etapa, integração; segredo não entra.
const dominioB = await um(`SELECT dominio_id FROM public.produto_email_pedidos WHERE id = $1`, [pedidoB]);
r = await um(`SELECT public.produto_email_caixa_salvar($1, 'joao', 'João', null, 'ativa', '2 GB', null, $2)`, [dominioB, DONO]);
conferir('caixa criada pelo nome curto', r.nova === true && r.endereco === 'joao@imobteste.com.br');
r = await um(`SELECT public.produto_email_caixa_salvar($1, 'joao@imobteste.com.br', null, 'apelido', null, null, null, $2)`, [dominioB, DONO]);
conferir('repetir o endereço atualiza', r.nova === false && (await um(`SELECT tipo FROM public.produto_email_caixas WHERE endereco = 'joao@imobteste.com.br'`)) === 'apelido');
conferir('endereço de outro domínio recusa', /deste domínio/.test(await recusa(`SELECT public.produto_email_caixa_salvar($1, 'x@outro.com.br')`, [dominioB]) || ''));
r = await um(`SELECT public.produto_email_etapa_marcar($1, 'levantamento', true, 'Feito pelo agente', $2)`, [dominioB, DONO]);
conferir('etapa pela chave', r.feitas === 1 && r.total === 8);
r = await um(`SELECT public.produto_email_etapa_marcar($1, '2', true, null, $2)`, [dominioB, DONO]);
conferir('etapa pela ordem', r.etapa === 'contas' && r.feitas === 2);
conferir('etapa inexistente recusa', /não existe/.test(await recusa(`SELECT public.produto_email_etapa_marcar($1, 'voar')`, [dominioB]) || ''));
r = await um(`SELECT public.produto_email_dominio_atualizar($1, '{"cloudflare_zona_id":"0123456789abcdef0123456789abcdef","zoho_dc":"com","zoho_plano":"gratuito"}'::jsonb, $2)`, [dominioB, DONO]);
conferir('integração gravada', r.dominio.cloudflare_zona_id === '0123456789abcdef0123456789abcdef' && r.dominio.zoho_plano === 'gratuito');
conferir('senha não entra no banco', /cofre/.test(await recusa(`SELECT public.produto_email_dominio_atualizar($1, '{"observacao":"x","senha":"123"}'::jsonb)`, [dominioB]) || ''));
conferir('zona inválida recusa', !!(await recusa(`SELECT public.produto_email_dominio_atualizar($1, '{"cloudflare_zona_id":"abc"}'::jsonb)`, [dominioB])));

// 8. Token do Zoho só no Vault, só pela chave de serviço.
conferir('token vai para o Vault', (await um(`SELECT public.produto_email_guardar_token_zoho($1, 'tok-123')`, [dominioB])) === true);
conferir('token lido pelo servidor', (await um(`SELECT public.produto_email_ler_token_zoho($1)`, [dominioB])) === 'tok-123');
conferir('nenhuma coluna guarda o token', (await um(`SELECT count(*)::int FROM public.produto_email_dominios WHERE integracao::text LIKE '%tok-123%'`)) === 0);
await como('authenticated', DONO);
conferir('nem o dono lê o token pela tela', /servidor/.test(await recusa(`SELECT public.produto_email_ler_token_zoho($1)`, [dominioB]) || ''));
await como('service_role', null);
await um(`SELECT public.produto_email_gravar_conferencia($1, 'zoho', '{"ok":true,"usuarios":4}'::jsonb)`, [dominioB]);
conferir('conferência do Zoho marca conectado', (await um(`SELECT zoho_conectado AND integracao->'zoho'->>'usuarios' = '4' FROM public.produto_email_dominios WHERE id = $1`, [dominioB])) === true);

// 9. Leitura completa da migração (MCP).
r = await um(`SELECT public.produto_email_migracao($1)`, [pedidoB]);
conferir('migração inteira numa leitura', r.pedido.id === pedidoB && r.dominio.dominio === 'imobteste.com.br' && r.caixas.length === 1 && r.etapas.length === 8 && r.empresa.email_liberado === true && r.historico.length > 0);

// 10. Andamento: concluir pede pagamento; cancelado não paga; reabrir respeita a regra de um aberto.
await como('authenticated', ADMIN_B);
await como('service_role', null);
const C = await um(`INSERT INTO public.produto_contas (nome) VALUES ('Empresa C') RETURNING id`);
r = await um(`SELECT public.produto_email_registrar_pedido($1, null, 2, null, null, 'casa', $2)`, [C, DONO]);
conferir('sem domínio vira e-mail novo, sem migração', r.pedido.tipo === 'novo' && Number(r.pedido.valor_migracao) === 0);
const pedidoC = r.pedido.id;
conferir('concluir sem pagar recusa', /pagamento/.test(await recusa(`SELECT public.produto_email_pedido_mudar($1, 'concluido')`, [pedidoC]) || ''));
await um(`SELECT public.produto_email_pedido_mudar($1, 'cancelado', 'Desistiu')`, [pedidoC]);
conferir('cancelado não marca pago', /cancelado/.test(await recusa(`SELECT public.produto_email_marcar_pago($1, 'pix')`, [pedidoC]) || ''));
r = await um(`SELECT public.produto_email_registrar_pedido($1, null, 1, null, null, 'casa', $2)`, [C, DONO]);
conferir('depois de cancelado nasce outro', r.novo === true);
conferir('reabrir com outro aberto recusa', /outro pedido aberto/.test(await recusa(`SELECT public.produto_email_pedido_mudar($1, 'reabrir')`, [pedidoC]) || ''));
r = await um(`SELECT public.produto_email_marcar_pago($1, 'cortesia')`, [r.pedido.id]);
conferir('cortesia não lança dinheiro e libera', r.livro === 'nenhum' && r.pedido.estado === 'pago' && (await um(`SELECT public.produto_email_liberado($1)`, [C])) === true);

// 10b. Já lançado no Financeiro (a parcela já paga no extra): pago sem lançar dinheiro de novo.
const E = await um(`INSERT INTO public.produto_contas (nome, client_id) VALUES ('Empresa E', '${CLIENTE}') RETURNING id`);
const extraE = await um(`INSERT INTO public.client_extras (client_id, nome, categoria, cobranca, valor) VALUES ('${CLIENTE}', 'E-mail E', 'email', 'unico', 597) RETURNING id`);
await db.query(`INSERT INTO public.billing (client_id, type, amount, status, due_date, extra_id) VALUES ($1, 'one_off', 597, 'pending', '2026-12-10', $2)`, [CLIENTE, extraE]);
r = await um(`SELECT public.produto_email_registrar_pedido($1, 'empresa-e.com.br', 2, 'migracao', null, 'casa', $2, $3)`, [E, DONO, extraE]);
const antesE = await um(`SELECT count(*)::int FROM public.billing WHERE status = 'paid'`);
r = await um(`SELECT public.produto_email_marcar_pago($1, 'ja_lancado', null, null, $2)`, [r.pedido.id, DONO]);
conferir('já lançado: pago sem mexer no extra nem no produto', r.livro === 'nenhum' && r.pedido.estado === 'em_andamento'
  && (await um(`SELECT count(*)::int FROM public.billing WHERE status = 'paid'`)) === antesE
  && (await um(`SELECT count(*)::int FROM public.produto_cobrancas WHERE conta_id = $1`, [E])) === 0, JSON.stringify(r));

// 11. O Asaas confirma a migração: o pedido aberto anda sozinho.
const D = await um(`INSERT INTO public.produto_contas (nome) VALUES ('Empresa D') RETURNING id`);
r = await um(`SELECT public.produto_email_registrar_pedido($1, 'empresa-d.com.br', 2, null, null, 'casa', $2)`, [D, DONO]);
await db.query(`INSERT INTO public.produto_cobrancas (conta_id, asaas_pagamento_id, tipo, valor, estado) VALUES ($1, 'pay_1', 'migracao', 597, 'aberta')`, [D]);
conferir('cobrança aberta não anda o pedido', (await um(`SELECT estado FROM public.produto_email_pedidos WHERE id = $1`, [r.pedido.id])) === 'novo');
await db.query(`UPDATE public.produto_cobrancas SET estado = 'paga', pago_em = now() WHERE asaas_pagamento_id = 'pay_1'`);
conferir('Asaas pago anda o pedido', (await um(`SELECT estado || ':' || forma_pagamento FROM public.produto_email_pedidos WHERE id = $1`, [r.pedido.id])) === 'em_andamento:asaas');
conferir('conclusão leva o domínio a concluído', !!(await um(`SELECT public.produto_email_pedido_mudar($1, 'concluido')`, [r.pedido.id]))
  && (await um(`SELECT estado FROM public.produto_email_dominios WHERE conta_id = $1`, [D])) === 'concluido');

for (const [i, x] of resultados.entries()) console.log(x.ok ? 'OK  ' : 'FAIL', i + 1, x.teste, x.ok ? '' : x.detalhe);
console.log(`${resultados.filter((x) => x.ok).length}/${resultados.length} passaram`);
if (resultados.some((x) => !x.ok)) process.exitCode = 1;
await db.close();
