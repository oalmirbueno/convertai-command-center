// Teste isolado da migration 20261119150000_produto_email_venda_automatica em PGlite.
// Usa as tabelas reais do produto (seções 1 a 4 de 20261113120000), a rota única (20261118170000) e recortes mínimos do resto.
// Não usa credencial nem projeto Supabase. PGlite fica fora do package.json:
//   PGLITE_DIR=<pasta com node_modules/@electric-sql/pglite> node supabase/testes/email_venda_automatica_runner.mjs
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const requireTest = createRequire(resolve(process.env.PGLITE_DIR || 'work/bolso-db-test', 'package.json'));
const { PGlite } = requireTest('@electric-sql/pglite');
const db = new PGlite();

const BASE = 'supabase/migrations/20261113120000_produto_crm_e_email.sql';
const ROTA = 'supabase/migrations/20261118170000_produto_email_rota_unica.sql';
const CENTRAL = 'supabase/migrations/20261118200000_produto_email_central_e_correio.sql';
const NOVA = 'supabase/migrations/20261119150000_produto_email_venda_automatica.sql';
const linhas = readFileSync(BASE, 'utf8').split('\n');
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
  categoria text NOT NULL, cobranca text NOT NULL, valor numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'ativo', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.billing (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, type text NOT NULL,
  amount numeric NOT NULL, status text NOT NULL DEFAULT 'pending', due_date date NOT NULL, paid_date date, paid_amount numeric,
  description text, extra_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
CREATE FUNCTION vault.create_secret(_s text, _n text, _d text) RETURNS uuid LANGUAGE sql AS
  $$ INSERT INTO vault.secrets (secret, name, description) VALUES (_s, _n, _d) RETURNING id $$;
CREATE FUNCTION vault.update_secret(_id uuid, _s text) RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = _s WHERE id = _id $$;
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
`);

for (const [nome, sql] of [['base', base], [ROTA, readFileSync(ROTA, 'utf8')], [CENTRAL, readFileSync(CENTRAL, 'utf8')], [NOVA, readFileSync(NOVA, 'utf8')], [`${NOVA} (de novo)`, readFileSync(NOVA, 'utf8')]]) {
  try {
    await db.exec(sql);
    console.log('Aplicada', nome);
  } catch (e) {
    console.error('Erro em', nome, e.message, e.where, e.position);
    process.exit(1);
  }
}

const DONO = '00000000-0000-4000-8000-00000000d0d0';
const ADMIN_A = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_B = '00000000-0000-4000-8000-0000000000b1';
const A = '10000000-0000-4000-8000-00000000000a';
const B = '10000000-0000-4000-8000-00000000000b';
await db.exec(`
INSERT INTO auth.users (id, email) VALUES ('${DONO}', 'dono@x.com'), ('${ADMIN_A}', 'a@empresa-a.com.br'), ('${ADMIN_B}', 'b@empresa-b.com.br');
INSERT INTO public.user_roles VALUES ('${DONO}', 'admin');
INSERT INTO public.produto_contas (id, nome, estado, teste_ate, email_cobranca) VALUES
  ('${A}', 'Empresa A', 'teste', now() + interval '3 days', 'a@empresa-a.com.br'),
  ('${B}', 'Empresa B', 'teste', now() + interval '3 days', 'b@empresa-b.com.br');
INSERT INTO public.produto_membros (conta_id, user_id, email, papel, estado) VALUES
  ('${A}', '${ADMIN_A}', 'a@empresa-a.com.br', 'admin', 'ativo'),
  ('${B}', '${ADMIN_B}', 'b@empresa-b.com.br', 'admin', 'ativo');
`);

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
const n = (v) => Math.round(Number(v) * 100) / 100;

// 1. O catálogo: a página pública lê só o que está ativo, sem nada da casa.
await como('anon', null);
let ofertas = await um(`SELECT public.produto_ofertas_publicas()`);
conferir('catálogo público tem as 4 ofertas iniciais', Array.isArray(ofertas) && ofertas.length === 4, JSON.stringify(ofertas));
conferir('a oferta pública não mostra ordem nem datas', ofertas && !('ordem' in ofertas[0]) && !('criado_em' in ofertas[0]));
conferir('reaplicar não duplica as ofertas', (await um(`SELECT count(*)::int FROM public.produto_ofertas`)) === 4);

// 2. A empresa pede a migração e escolhe ofertas: entra só o que existe e cabe no tipo do pedido.
await como('authenticated', ADMIN_A);
let r = await um(`SELECT public.produto_email_registrar_pedido($1, 'empresa-a.com.br', 3, 'migracao', null, 'pagina', $2)`, [A, ADMIN_A]);
const pedidoA = r.pedido.id;
let p = await um(`SELECT public.produto_email_escolher_ofertas($1, ARRAY['dominio_gerenciado','backup_antigo','nao_existe'], $2)`, [pedidoA, ADMIN_A]);
conferir('ofertas escolhidas viram foto no pedido', p.ofertas.length === 2 && p.ofertas.map((o) => o.id).join(',') === 'dominio_gerenciado,backup_antigo', JSON.stringify(p.ofertas));
conferir('a foto guarda o preço de agora', n(p.ofertas[0].valor) === 14.9 && n(p.ofertas[1].valor) === 97);

// 3. Outra empresa não escolhe pela A.
await como('authenticated', ADMIN_B);
conferir('outra empresa não escolhe ofertas', /administra/.test(await recusa(`SELECT public.produto_email_escolher_ofertas($1, ARRAY['site_cuidado'])`, [pedidoA]) || ''));

// 4. E-mail novo: oferta só da migração não entra.
r = await um(`SELECT public.produto_email_registrar_pedido($1, 'empresa-b.com.br', 1, 'novo', null, 'pagina', $2)`, [B, ADMIN_B]);
const pedidoB = r.pedido.id;
p = await um(`SELECT public.produto_email_escolher_ofertas($1, ARRAY['backup_antigo','site_cuidado'], $2)`, [pedidoB, ADMIN_B]);
conferir('no e-mail novo, a oferta só da migração fica de fora', p.ofertas.length === 1 && p.ofertas[0].id === 'site_cuidado', JSON.stringify(p.ofertas));

// 5. O que se paga hoje e o que vira mensalidade.
await como('service_role', null);
let c = await um(`SELECT public.produto_email_cobranca_do_pedido($1)`, [pedidoA]);
conferir('hoje: migração, 1º mês e ofertas', n(c.total_hoje) === n(597 + 39.9 + 14.9 + 97) && c.itens_hoje.length === 4, JSON.stringify(c));
conferir('mensal: e-mail e ofertas mensais', n(c.total_mensal) === n(39.9 + 14.9) && c.itens_mensais.length === 2, JSON.stringify(c.itens_mensais));
conferir('a oferta mensal aparece como 1º mês no pagamento de hoje', c.itens_hoje.some((i) => i.nome === 'Domínio gerenciado, 1º mês'));
c = await um(`SELECT public.produto_email_cobranca_do_pedido($1)`, [pedidoB]);
conferir('e-mail novo não cobra migração', n(c.total_hoje) === n(39.9 + 69) && !c.itens_hoje.some((i) => i.chave === 'migracao'), JSON.stringify(c));
conferir('pedido que não existe devolve nada', (await um(`SELECT public.produto_email_cobranca_do_pedido('99999999-0000-4000-8000-000000000000')`)) === null);
conferir('a empresa não lê a cobrança calculada direto', /permission|denied/i.test(await (async () => { await db.exec('SET ROLE authenticated'); try { return await recusa(`SELECT public.produto_email_cobranca_do_pedido($1)`, [pedidoA]); } finally { await db.exec('RESET ROLE'); } })() || ''));

// 6. A casa muda o preço: o pedido já feito fica com o preço que o cliente viu.
await como('authenticated', ADMIN_A);
conferir('empresa não muda oferta', /administração/.test(await recusa(`SELECT public.produto_oferta_salvar('dominio_gerenciado', 'Domínio', 'mensal', 1)`) || ''));
await como('authenticated', DONO);
await um(`SELECT public.produto_oferta_salvar('dominio_gerenciado', 'Domínio gerenciado', 'mensal', 19.9, 'DNS e renovação', 'ambos', true, true, 10)`);
conferir('preço novo no catálogo', n(await um(`SELECT valor FROM public.produto_ofertas WHERE id = 'dominio_gerenciado'`)) === 19.9);
conferir('pedido feito mantém o preço visto', n(await um(`SELECT (ofertas->0->>'valor')::numeric FROM public.produto_email_pedidos WHERE id = $1`, [pedidoA])) === 14.9);
conferir('valor zero recusa', /valor/.test(await recusa(`SELECT public.produto_oferta_salvar('x_y', 'Teste', 'unica', 0)`) || ''));
conferir('código fora do formato recusa', /código/.test(await recusa(`SELECT public.produto_oferta_salvar('Com Espaco', 'Teste', 'unica', 10)`) || ''));
await um(`SELECT public.produto_oferta_salvar('site_cuidado', 'Site hospedado e cuidado', 'mensal', 69, '', 'ambos', false, false, 20)`);
await como('anon', null);
conferir('oferta desligada some da página', (await um(`SELECT public.produto_ofertas_publicas()`)).length === 3);

// 7. Depois de pago, as ofertas não mudam.
await como('authenticated', DONO);
await um(`SELECT public.produto_email_marcar_pago($1, 'pix', null, null, $2)`, [pedidoA, DONO]);
await como('authenticated', ADMIN_A);
conferir('pedido pago não troca ofertas', /pago/.test(await recusa(`SELECT public.produto_email_escolher_ofertas($1, ARRAY['site_cuidado'])`, [pedidoA]) || ''));

// 8. A mensalidade do CRM não cobra o e-mail que já tem assinatura própria.
await como('service_role', null);
await db.exec(`UPDATE public.produto_contas SET email_ativo = true, email_caixas_contratadas = 7 WHERE id = '${A}'`);
let itens = await um(`SELECT public.produto_itens_da_conta($1)`, [A]);
conferir('sem assinatura do e-mail, o CRM leva o e-mail como antes', itens.some((i) => i.chave === 'email') && itens.some((i) => i.chave === 'email_caixa_extra') && itens.some((i) => i.chave === 'crm'), JSON.stringify(itens));
await db.exec(`INSERT INTO public.produto_email_assinaturas (conta_id, pedido_id, asaas_assinatura_id, valor_mensal) VALUES ('${A}', '${pedidoA}', 'sub_teste123', 54.80)`);
itens = await um(`SELECT public.produto_itens_da_conta($1)`, [A]);
conferir('com assinatura do e-mail, o CRM não cobra o e-mail de novo', !itens.some((i) => i.chave === 'email' || i.chave === 'email_caixa_extra') && itens.some((i) => i.chave === 'crm'), JSON.stringify(itens));
await db.exec(`UPDATE public.produto_email_assinaturas SET estado = 'cancelada' WHERE conta_id = '${A}'`);
itens = await um(`SELECT public.produto_itens_da_conta($1)`, [A]);
conferir('assinatura do e-mail cancelada volta para o CRM', itens.some((i) => i.chave === 'email'));
conferir('id de assinatura fora do formato recusa', !!(await recusa(`INSERT INTO public.produto_email_assinaturas (conta_id, asaas_assinatura_id) VALUES ('${B}', 'qualquer')`)));

// 9. Migadu: o pagamento cria o domínio no Migadu; a lista de provedores aceita o novo.
conferir('o domínio que nasce do pagamento é do Migadu', (await um(`SELECT provedor || '/' || correio_provedor FROM public.produto_email_dominios WHERE dominio = 'empresa-a.com.br'`)) === 'migadu/migadu');
conferir('o correio do domínio novo começa desligado', (await um(`SELECT correio_ligado FROM public.produto_email_dominios WHERE dominio = 'empresa-a.com.br'`)) === false);
conferir('provedor desconhecido recusa', !!(await recusa(`UPDATE public.produto_email_dominios SET provedor = 'xyz' WHERE dominio = 'empresa-a.com.br'`)));
conferir('Zoho continua aceito', !(await recusa(`INSERT INTO public.produto_email_dominios (conta_id, dominio, provedor) VALUES ('${B}', 'empresa-b.com.br', 'zoho')`)));
const dominioA = await um(`SELECT id FROM public.produto_email_dominios WHERE dominio = 'empresa-a.com.br'`);
conferir('convite com e-mail inválido recusa', !!(await recusa(`INSERT INTO public.produto_email_caixas (conta_id, dominio_id, endereco, email_convite) VALUES ('${A}', $1, 'joao@empresa-a.com.br', 'sem arroba')`, [dominioA])));
conferir('caixa com convite e apelido com destinos', !(await recusa(`INSERT INTO public.produto_email_caixas (conta_id, dominio_id, endereco, estado, email_convite) VALUES ('${A}', $1, 'joao@empresa-a.com.br', 'pedida', 'joao@gmail.com'); INSERT INTO public.produto_email_caixas (conta_id, dominio_id, endereco, tipo, destinos) VALUES ('${A}', $1, 'contato@empresa-a.com.br', 'apelido', ARRAY['joao@empresa-a.com.br'])`.split('; ')[0], [dominioA])));
await db.query(`SELECT public.produto_email_gravar_conferencia($1, 'migadu', '{"ok": false, "existe": true}'::jsonb)`, [dominioA]);
conferir('a conferência do Migadu fica em integracao.migadu', (await um(`SELECT integracao->'migadu'->>'existe' FROM public.produto_email_dominios WHERE id = $1`, [dominioA])) === 'true');

// 10. O pedido lido pela casa mostra as ofertas.
const json = await um(`SELECT public.produto_email_pedido_json(p) FROM public.produto_email_pedidos p WHERE id = $1`, [pedidoA]);
conferir('pedido mostra ofertas e cobrança', Array.isArray(json.ofertas) && 'cobranca_link' in json);

for (const [i, x] of resultados.entries()) console.log(x.ok ? 'OK  ' : 'FAIL', i + 1, x.teste, x.ok ? '' : x.detalhe);
console.log(`${resultados.filter((x) => x.ok).length}/${resultados.length} passaram`);
if (resultados.some((x) => !x.ok)) process.exitCode = 1;
await db.close();
