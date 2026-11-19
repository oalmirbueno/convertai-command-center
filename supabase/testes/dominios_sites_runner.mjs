// Teste isolado da migration 20261119120000_casa_dominios_e_sites em PGlite.
// Usa as tabelas reais do produto (seções 1 a 4 de 20261113120000), a rota única e a central do e-mail.
// Não usa credencial nem projeto Supabase. PGlite fica fora do package.json:
//   PGLITE_DIR=<pasta com node_modules/@electric-sql/pglite> node supabase/testes/dominios_sites_runner.mjs
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const requireTest = createRequire(resolve(process.env.PGLITE_DIR || 'work/bolso-db-test', 'package.json'));
const { PGlite } = requireTest('@electric-sql/pglite');
const db = new PGlite();

const BASE = 'supabase/migrations/20261113120000_produto_crm_e_email.sql';
const ANTES = ['supabase/migrations/20261118170000_produto_email_rota_unica.sql', 'supabase/migrations/20261118200000_produto_email_central_e_correio.sql'];
const NOVA = 'supabase/migrations/20261119120000_casa_dominios_e_sites.sql';
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

async function aplicar(caminho, vezes = 1) {
  for (let i = 0; i < vezes; i++) {
    try {
      await db.exec(caminho === BASE ? base : readFileSync(caminho, 'utf8'));
      console.log(i ? 'Reaplicada (idempotente)' : 'Aplicada', caminho);
    } catch (e) {
      console.error('Erro em', caminho, e.message, e.where, e.position);
      process.exit(1);
    }
  }
}
await aplicar(BASE);
for (const m of ANTES) await aplicar(m);
await aplicar(NOVA, 2);

const DONO = '00000000-0000-4000-8000-00000000d0d0';
const CLIENTE = '00000000-0000-4000-8000-0000000000c1';
const OUTRO = '00000000-0000-4000-8000-0000000000c2';
const ADMIN_A = '00000000-0000-4000-8000-0000000000a1';
const A = '10000000-0000-4000-8000-00000000000a';
await db.exec(`
INSERT INTO auth.users (id, email) VALUES ('${DONO}', 'dono@x.com'), ('${ADMIN_A}', 'a@empresa-a.com.br');
INSERT INTO public.user_roles VALUES ('${DONO}', 'admin'), ('${CLIENTE}', 'client'), ('${OUTRO}', 'client');
INSERT INTO public.profiles (id, company_name, full_name) VALUES ('${CLIENTE}', 'Imobiliária Teste', null), ('${OUTRO}', null, 'Clínica Vida');
INSERT INTO public.produto_contas (id, nome, estado, teste_ate, email_cobranca, client_id) VALUES
  ('${A}', 'Empresa A', 'ativa', now() + interval '3 days', 'a@empresa-a.com.br', '${CLIENTE}');
INSERT INTO public.produto_membros (conta_id, user_id, email, papel, estado) VALUES ('${A}', '${ADMIN_A}', 'a@empresa-a.com.br', 'admin', 'ativo');
INSERT INTO public.produto_email_dominios (conta_id, dominio, provedor, estado, registro_em) VALUES ('${A}', 'empresa-a.com.br', 'zoho', 'concluido', 'Registro.br');
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
const central = () => um(`SELECT public.casa_dominios_sites_central()`);

// 1. Só a casa lê e escreve.
await como('authenticated', ADMIN_A);
conferir('cliente do produto não lê a central', /administração/.test(await recusa(`SELECT public.casa_dominios_sites_central()`) || ''));
conferir('cliente do produto não cadastra domínio', /administração/.test(await recusa(`SELECT public.casa_dominio_salvar(null, '{"dominio":"x.com.br"}')`) || ''));
conferir('quem não é serviço não grava leitura', /servidor/.test(await recusa(`SELECT public.casa_dominios_sites_gravar_leitura('{}')`) || ''));

// 2. O domínio do e-mail aparece mesmo sem cadastro, com o cliente da empresa.
await como('authenticated', DONO);
let c = await central();
const virtual = c.dominios.find((d) => d.dominio === 'empresa-a.com.br');
conferir('domínio do e-mail aparece sem id', virtual && virtual.id === null && virtual.email && virtual.email.provedor === 'zoho', JSON.stringify(virtual));
conferir('herda o cliente da empresa', virtual && virtual.cliente === `c:${CLIENTE}` && virtual.cliente_nome === 'Imobiliária Teste', JSON.stringify(virtual));
conferir('lista de clientes traz clientes e empresas sem cliente', c.clientes.length === 2 && c.clientes.some((k) => k.nome === 'Clínica Vida'), JSON.stringify(c.clientes));

// 3. Cadastro manual: normaliza, recusa inválido e segredo, aceita preço com vírgula.
let r = await um(`SELECT public.casa_dominio_salvar(null, $1)`, [{ dominio: 'https://www.ClinicaVida.com.br/contato', cliente: `c:${OUTRO}`, registrador: 'Registro.br', custo_valor: '40', custo_periodo: 'anual', preco_valor: '9,90', preco_periodo: 'mensal' }]);
conferir('cadastro normaliza o domínio', r && r.dominio === 'clinicavida.com.br', JSON.stringify(r));
const dClinica = r.id;
conferir('domínio inválido recusa', /empresa\.com\.br/.test(await recusa(`SELECT public.casa_dominio_salvar(null, '{"dominio":"sem ponto"}')`) || ''));
conferir('token não entra no banco', /cofre/.test(await recusa(`SELECT public.casa_dominio_salvar(null, '{"dominio":"a.com.br","token":"x"}')`) || ''));
conferir('valor torto recusa', /Valor inválido/.test(await recusa(`SELECT public.casa_dominio_salvar($1, '{"preco_valor":"abc"}')`, [dClinica]) || ''));
conferir('cliente inexistente recusa', /não foi encontrado/.test(await recusa(`SELECT public.casa_dominio_salvar($1, '{"cliente":"c:00000000-0000-4000-8000-000000000999"}')`, [dClinica]) || ''));
r = await um(`SELECT public.casa_dominio_salvar(null, '{"dominio":"clinicavida.com.br"}')`);
conferir('cadastrar de novo reaproveita a linha', r.id === dClinica);
c = await central();
const clinica = c.dominios.find((d) => d.id === dClinica);
conferir('preço e custo gravados', Number(clinica.preco_valor) === 9.9 && Number(clinica.custo_valor) === 40 && clinica.custo_periodo === 'anual' && clinica.cliente === `c:${OUTRO}`, JSON.stringify(clinica));
conferir('cadastrar não apagou o cliente', clinica.cliente_nome === 'Clínica Vida');

// 4. Salvar o domínio do e-mail cria a linha e herda o cliente.
r = await um(`SELECT public.casa_dominio_salvar(null, '{"dominio":"empresa-a.com.br","email_dominio_id":"x","preco_valor":"5"}')`);
c = await central();
const empresaA = c.dominios.filter((d) => d.dominio === 'empresa-a.com.br');
conferir('domínio do e-mail vira cadastro (sem duplicar)', empresaA.length === 1 && empresaA[0].id === r.id && empresaA[0].origem === 'email' && empresaA[0].cliente === `c:${CLIENTE}`, JSON.stringify(empresaA));

// 5. A leitura da função: Cloudflare, RDAP e DNS sem tocar no que é da casa.
await como('service_role', null);
r = await um(`SELECT public.casa_dominios_sites_gravar_leitura($1)`, [{
  dominios: [
    { dominio: 'clinicavida.com.br', registrador: 'Registro.br', nameservers: ['ADA.ns.cloudflare.com', 'bob.ns.cloudflare.com'], cloudflare_zona_id: 'z1', cloudflare_status: 'active', na_cloudflare_da_casa: true, rdap: true, vence_em: '2027-02-01', dns_email: { pronto: false, itens: [{ chave: 'mx', estado: 'falta' }] } },
    { dominio: 'novosite.com', origem: 'cloudflare', nameservers: ['ada.ns.cloudflare.com'], cloudflare_zona_id: 'z2', cloudflare_status: 'pending', na_cloudflare_da_casa: true },
    { dominio: 'empresa-a.com.br', rdap: true, vence_em: '2027-05-10' },
    { dominio: 'lixo sem ponto' },
  ],
  sites: [
    { cf_tipo: 'worker', cf_nome: 'site-clinica', nome: 'site-clinica', endereco: 'https://www.clinicavida.com.br/', dominios_personalizados: ['www.clinicavida.com.br'], ultima_publicacao: '2026-11-10T12:00:00Z' },
    { cf_tipo: 'pages', cf_nome: 'novosite', nome: 'novosite', endereco: 'novosite.pages.dev' },
    { cf_tipo: 'outro', cf_nome: 'x' },
  ],
}]);
conferir('grava domínios e sites válidos', r.dominios === 3 && r.sites === 2, JSON.stringify(r));
await como('authenticated', DONO);
c = await central();
const clinica2 = c.dominios.find((d) => d.id === dClinica);
conferir('nameservers em minúsculas e zona da casa', clinica2.nameservers[0] === 'ada.ns.cloudflare.com' && clinica2.na_cloudflare_da_casa === true, JSON.stringify(clinica2.nameservers));
conferir('RDAP manda no vencimento', clinica2.vence_em === '2027-02-01' && clinica2.vencimento_fonte === 'rdap');
conferir('leitura não mexe no preço nem no cliente', Number(clinica2.preco_valor) === 9.9 && clinica2.cliente === `c:${OUTRO}`);
conferir('zona nova da Cloudflare entra sozinha', c.dominios.some((d) => d.dominio === 'novosite.com' && d.origem === 'cloudflare'));
conferir('vencimento vale para a central de e-mail', (await um(`SELECT dominio_vence_em::text FROM public.produto_email_dominios WHERE dominio = 'empresa-a.com.br'`)) === '2027-05-10');
const siteClinica = c.sites.find((s) => s.cf_nome === 'site-clinica');
conferir('site ligado ao domínio pelo endereço', siteClinica && siteClinica.endereco === 'www.clinicavida.com.br' && siteClinica.dominio_id === dClinica, JSON.stringify(siteClinica));
conferir('site herda o cliente do domínio', siteClinica && siteClinica.cliente === `c:${OUTRO}` && siteClinica.cliente_herdado === true);
conferir('site do Pages com hospedagem certa', c.sites.some((s) => s.cf_nome === 'novosite' && s.hospedagem === 'Cloudflare Pages'));

// 6. Ler de novo não duplica nem apaga o preço do site.
await um(`SELECT public.casa_site_salvar($1, '{"preco_valor":"89,90","custo_valor":"0","cliente":"c:${CLIENTE}"}')`, [siteClinica.id]);
await como('service_role', null);
await um(`SELECT public.casa_dominios_sites_gravar_leitura($1)`, [{ sites: [{ cf_tipo: 'worker', cf_nome: 'site-clinica', endereco: 'www.clinicavida.com.br' }], saude_sites: [{ id: siteClinica.id, http_status: 200, ssl_ok: true, resposta_ms: 180 }] }]);
await como('authenticated', DONO);
c = await central();
const s2 = c.sites.filter((s) => s.cf_nome === 'site-clinica');
conferir('ler de novo não duplica o site', s2.length === 1);
conferir('preço e cliente do site ficam', Number(s2[0].preco_valor) === 89.9 && s2[0].cliente === `c:${CLIENTE}` && s2[0].cliente_herdado === false, JSON.stringify(s2[0]));
conferir('saúde do site gravada', s2[0].http_status === 200 && s2[0].ssl_ok === true && s2[0].resposta_ms === 180 && s2[0].conferido_em);
conferir('publicação antiga preservada', !!s2[0].ultima_publicacao);

// 7. Site manual, endereço torto e arquivar.
r = await um(`SELECT public.casa_site_salvar(null, '{"endereco":"HTTPS://Loja.Exemplo.com.br/","hospedagem":"Hostinger","preco_valor":"120"}')`);
c = await central();
conferir('site manual com endereço limpo', c.sites.some((s) => s.id === r.id && s.endereco === 'loja.exemplo.com.br' && s.origem === 'manual' && s.nome === 'loja.exemplo.com.br'));
conferir('site sem nome nem endereço recusa', /nome ou o endereço/.test(await recusa(`SELECT public.casa_site_salvar(null, '{}')`) || ''));
conferir('endereço inválido recusa', !!(await recusa(`SELECT public.casa_site_salvar($1, '{"endereco":"não é site"}')`, [r.id])));
await um(`SELECT public.casa_dominios_sites_arquivar('site', $1)`, [r.id]);
c = await central();
conferir('arquivar marca e mantém guardado', c.sites.find((s) => s.id === r.id).arquivado === true);
conferir('tipo desconhecido recusa', /Tipo/.test(await recusa(`SELECT public.casa_dominios_sites_arquivar('x', $1)`, [r.id]) || ''));

// 8. RLS: a tabela não se escreve direto, e só a casa lê.
await db.exec(`GRANT USAGE ON SCHEMA public, auth TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;`);
const comoPessoa = async (uid, fn) => { await como('authenticated', uid); await db.exec('SET ROLE authenticated'); try { return await fn(); } finally { await db.exec('RESET ROLE'); } };
conferir('cliente do produto não lê a tabela', (await comoPessoa(ADMIN_A, () => um(`SELECT count(*)::int FROM public.casa_dominios`))) === 0);
conferir('a casa lê a tabela', (await comoPessoa(DONO, () => um(`SELECT count(*)::int FROM public.casa_dominios`))) === 3);
conferir('ninguém escreve direto na tabela', !!(await comoPessoa(DONO, () => recusa(`INSERT INTO public.casa_dominios (dominio) VALUES ('z.com.br')`))));
conferir('ninguém muda preço direto', !!(await comoPessoa(DONO, () => recusa(`UPDATE public.casa_sites SET preco_valor = 1`))));

for (const [i, x] of resultados.entries()) console.log(x.ok ? 'OK  ' : 'FAIL', i + 1, x.teste, x.ok ? '' : x.detalhe);
console.log(`${resultados.filter((x) => x.ok).length}/${resultados.length} passaram`);
if (resultados.some((x) => !x.ok)) process.exitCode = 1;
await db.close();
