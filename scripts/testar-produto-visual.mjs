/**
 * Produto CRM e E-mail: a interface real com dados sintéticos, num navegador isolado.
 * Nenhuma conexão de produção: todo pedido ao servidor é respondido aqui ou cortado.
 *
 *   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4179 --strictPort   (em outro terminal)
 *   node scripts/testar-produto-visual.mjs
 *
 * Capturas em outputs/produto-visual (390 e 1440 px). Sai com erro se alguma tela
 * transbordar para o lado, se faltar o que a tela promete ou se o console acusar erro.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origem = process.env.PRODUTO_ORIGEM || "http://127.0.0.1:4179";
const saida = resolve("outputs/produto-visual");
await mkdir(saida, { recursive: true });

const agora = Date.now();
const dia = (d) => new Date(agora + d * 86400000).toISOString();
const EU = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTA = "11111111-1111-4111-8111-111111111111";

const planos = [
  { id: "starter", nome: "Starter", resumo: "O CRM completo para organizar a venda.", preco_usuario: 49.9, minimo_usuarios: 1, recursos: ["Funil de vendas com arrastar e soltar", "Empresas, contatos e histórico", "Agenda e lembretes", "Metas do mês", "Máquina de leads: 5 buscas por mês"], limites: { maquina_buscas_mes: 5, maquina_google_maps: false, maquina_limite_por_busca: 50, privacidade_por_vendedor: false, campanhas: false }, email_caixas_incluidas: 0, destaque: false, ativo: true, ordem: 1 },
  { id: "pro", nome: "Pro", resumo: "Para a equipe que prospecta todo dia.", preco_usuario: 79.9, minimo_usuarios: 1, recursos: ["Tudo do Starter", "Máquina de leads: 30 buscas por mês, com Google Maps", "Campanhas e custo por cliente", "Cada vendedor vê só os próprios negócios", "E-mail profissional incluído na mensalidade"], limites: { maquina_buscas_mes: 30, maquina_google_maps: true, maquina_limite_por_busca: 150, privacidade_por_vendedor: true, campanhas: true }, email_caixas_incluidas: 5, destaque: true, ordem: 2, ativo: true },
];
const config = { id: true, pagamentos_ativos: true, teste_dias: 7, tolerancia_dias: 5, email_migracao: 597, email_mensal: 39.9, email_caixas_no_mensal: 5, email_caixa_extra: 14.9, custo_fixo_mensal: 60, custo_email_caixa_extra: 7, custo_lugar_google_usd: 0.004, dolar: 5.6, imposto_pct: 6 };
const equipe = [
  { id: "m1", user_id: EU, nome: "Priscila Souza", email: "priscila@imobiliariaexemplo.com.br", papel: "admin", estado: "ativo", entrou_em: dia(-20) },
  { id: "m2", user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nome: "Rafael Lima", email: "rafael@imobiliariaexemplo.com.br", papel: "gerente", cargo: "Gerente comercial", estado: "ativo", entrou_em: dia(-12) },
  { id: "m4", user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", nome: "Marina Alves", email: "marina@imobiliariaexemplo.com.br", papel: "usuario", cargo: "Corretora", gerente_id: "m2", meta_mensal: 30000, estado: "ativo", entrou_em: dia(-9) },
  { id: "m3", user_id: null, nome: "Camila Rocha", email: "camila@imobiliariaexemplo.com.br", papel: "usuario", gerente_id: "m2", estado: "convidado", entrou_em: null },
];
const estadoDoProduto = (parte = {}) => ({
  conta: { id: CONTA, nome: "Imobiliária Exemplo", estado: "teste", plano_id: "pro", usuarios_contratados: 4, crm_ativo: true, email_ativo: true, email_caixas_contratadas: 6, teste_ate: dia(5), atrasada_desde: null, acesso_ate: null, visibilidade: "todos", aparencia: {}, perfil: { nicho: "imobiliaria", objetivo: "organizar", etapas: { novo: "Interessado", contato: "Atendimento", diagnostico: "Visita", negociacao: "Documentação", ganho: "Fechado" } }, documento: "12345678000195", email_cobranca: "financeiro@imobiliariaexemplo.com.br", telefone: "41999990000", ...(parte.conta || {}) },
  eu: { membro_id: "m1", papel: "admin", nome: "Priscila Souza", email: "priscila@imobiliariaexemplo.com.br", ...(parte.eu || {}) },
  plano: { id: "pro", nome: "Pro", preco_usuario: 79.9, limites: planos[1].limites, email_caixas_incluidas: 5 },
  liberada: true, crm: true, email: true, dono_da_casa: false, pagamentos_ativos: true, tolerancia_dias: 5, teste_dias: 7,
  equipe, maquina_no_mes: 3, ve_tudo: true, avisos_novos: 2,
  assinatura: { estado: "sem", valor_mensal: 0, proximo_vencimento: null, cartao_final: null, cartao_bandeira: null, itens: [], checkout_link: null },
  ...(parte.raiz || {}),
});

const ETAPAS = ["novo", "contato", "diagnostico", "proposta", "negociacao", "ganho", "perdido"];
const nomes = ["Ana Paula", "Bruno Dias", "Carla Nunes", "Diego Alves", "Elisa Prado", "Fábio Reis", "Gisele Tavares", "Hugo Martins", "Íris Campos", "João Vitor", "Karen Luz", "Leandro Paz"];
const empresas = ["Padaria Sol Nascente", "Clínica Vida", "Auto Center Rota", "Studio Pilates Leve", "Pet Shop Amigo", "Ótica Visão", "Restaurante Sabor da Serra", "Academia Pulso", "Escola Aprender", "Construtora Base", "Floricultura Jardim", "Loja de Móveis Casa Nova"];
const leads = nomes.map((nome, i) => ({
  id: `00000000-0000-4000-8000-0000000000${String(10 + i)}`, conta_id: CONTA, name: nome, company: empresas[i], email: `contato${i}@exemplo.com.br`, whatsapp: `+55419999900${String(10 + i)}`,
  origin: i % 3 === 0 ? "maquina_de_leads" : i % 3 === 1 ? "indicacao" : "instagram", campaign_id: null, quiz_submission_id: null,
  stage: ETAPAS[i % 6], monthly_value: 300 + i * 120, one_off_value: i % 2 ? 900 : 0, owner_id: i % 2 ? EU : equipe[1].user_id,
  next_action: i % 4 === 3 ? null : "Ligar para confirmar a proposta", next_action_at: null, notes: null, lost_reason: null, won_client_id: null,
  closed_at: ETAPAS[i % 6] === "ganho" ? dia(-2) : null, archived_at: null, created_by: EU, created_at: dia(-30 + i * 2), updated_at: dia(-i),
  expected_close_date: dia(10 + i).slice(0, 10), organization_id: `10000000-0000-4000-8000-0000000000${String(10 + i)}`, contact_id: null, classe: "novo_prospect", qualificacao: {}, origem_clique: null,
  agente_slug: null, agente_desde: null, ads_campaign_id: null, entrada_recebida: null, entrada_parcelas: null, mensalidade_inicio: null,
}));
const organizacoes = empresas.map((nome, i) => ({ id: `10000000-0000-4000-8000-0000000000${String(10 + i)}`, conta_id: CONTA, name: nome, segment: "Comércio local", website: null, city: "Curitiba", notes: null, owner_id: EU, client_id: null, archived_at: null, created_by: EU, created_at: dia(-30), updated_at: dia(-1), instagram: null, phone: null, address: null, cnpj: null, size: null }));
const atividades = leads.slice(0, 7).map((l, i) => ({ id: `20000000-0000-4000-8000-0000000000${String(10 + i)}`, conta_id: CONTA, lead_id: l.id, kind: i % 2 ? "ligacao" : "reuniao", title: i % 2 ? "Ligar de volta" : "Reunião de apresentação", notes: null, due_at: dia(i - 1), done_at: null, owner_id: EU, created_by: EU, created_at: dia(-3), updated_at: dia(-3), duration_minutes: 30 }));
const eventos = leads.map((l, i) => ({ lead_id: l.id, kind: "stage", from_stage: "novo", to_stage: l.stage, note: null, created_at: dia(-i - 1) }));
const metas = [{ id: "g1", conta_id: CONTA, period: `${new Date(agora - 3 * 3600000).toISOString().slice(0, 7)}-01`, metric: "receita", target: 12000, created_by: EU, created_at: dia(-10), updated_at: dia(-10) }];
const campanhas = [{ id: "c1", conta_id: CONTA, name: "Anúncio de inverno", channel: "meta", status: "ativa", budget: 1500, spent: 640, starts_on: dia(-20).slice(0, 10), ends_on: dia(10).slice(0, 10), goal: "Trazer visitas", notes: null, archived_at: null, created_by: EU, created_at: dia(-20), updated_at: dia(-1), meta_campaign_ids: [], mercurio_ativo: false }];
const dominio = { id: "d1", conta_id: CONTA, dominio: "imobiliariaexemplo.com.br", provedor: "zoho", provedor_antigo: "UOL Host", dns_em: "Cloudflare", registro_em: "Registro.br", webmail_url: null, dkim_seletor: null, estado: "virada", observacao: "Sete caixas no provedor antigo, duas com POP.", checado_em: dia(0), checagem: { dominio: "imobiliariaexemplo.com.br", pronto: false, conferido_em: dia(0), itens: [
  { chave: "mx", titulo: "Recebimento (MX)", estado: "certo", achado: ["10 mx.zoho.com", "20 mx2.zoho.com"], esperado: "mx.zoho.com (10), mx2.zoho.com (20), mx3.zoho.com (50)", explicacao: "As mensagens chegam no provedor certo." },
  { chave: "spf", titulo: "Quem pode enviar (SPF)", estado: "certo", achado: ["v=spf1 include:zoho.com ~all"], esperado: "v=spf1 include:zoho.com ~all", explicacao: "O provedor está autorizado a enviar pelo domínio." },
  { chave: "dkim", titulo: "Assinatura (DKIM)", estado: "falta", achado: [], esperado: "registro em zmail._domainkey.imobiliariaexemplo.com.br com a chave que o provedor gera", explicacao: "Não achei a chave no seletor \"zmail\". Gere o DKIM no provedor e publique o registro, ou corrija o seletor." },
  { chave: "dmarc", titulo: "Política contra falsificação (DMARC)", estado: "atencao", achado: ["v=DMARC1; p=none"], esperado: "v=DMARC1; p=quarantine; rua=mailto:dmarc@imobiliariaexemplo.com.br", explicacao: "O DMARC só observa (p=none). Depois de alguns dias sem erro, suba para quarantine." },
] } };
const caixas = ["contato", "financeiro", "priscila", "rafael", "camila", "locacao"].map((u, i) => ({ id: `cx${i}`, dominio_id: "d1", conta_id: CONTA, endereco: `${u}@imobiliariaexemplo.com.br`, pessoa: ["Recepção", "Financeiro", "Priscila Souza", "Rafael Lima", "Camila Rocha", "Locação"][i], tipo: "caixa", estado: i === 5 ? "pedida" : i === 4 ? "copiando" : "ativa", tamanho_origem: "4 GB", observacao: null }));
const titulosDasEtapas = ["Levantar caixas e DNS de hoje", "Contas do cliente criadas", "Zona de DNS copiada e conferida", "Domínio verificado e caixas criadas", "Histórico copiado", "Virada do e-mail", "Envio e recebimento testados", "Contrato antigo encerrado"];
const etapas = titulosDasEtapas.map((t, i) => ({ id: `e${i}`, dominio_id: "d1", conta_id: CONTA, ordem: i + 1, chave: `k${i}`, titulo: t, ajuda: "O que fazer nesta etapa, em uma frase curta.", feito_em: i < 5 ? dia(-8 + i) : null, feito_por: null, nota: i === 4 ? "Faltam duas caixas com POP." : null }));
const cobrancas = [
  { id: "cb1", conta_id: CONTA, tipo: "mensalidade", descricao: "CRM Pro x 4", valor: 319.6, valor_liquido: 309.2, vencimento: dia(-31).slice(0, 10), estado: "paga", pago_em: dia(-31), forma: "CREDIT_CARD", link: "https://example.invalid/fatura/1" },
  { id: "cb2", conta_id: CONTA, tipo: "migracao", descricao: "Migração do e-mail profissional", valor: 597, valor_liquido: null, vencimento: dia(2).slice(0, 10), estado: "aberta", pago_em: null, forma: null, link: "https://example.invalid/fatura/2" },
];
const contaNaCasa = (i, parte) => ({
  id: i === 0 ? CONTA : `2222222${i}-2222-4222-8222-222222222222`, nome: ["Imobiliária Exemplo", "Clínica Vida", "Auto Center Rota", "Studio Pilates Leve"][i], documento: "12345678000195", email_cobranca: `financeiro${i}@exemplo.com.br`, telefone: "41999990000", client_id: null,
  plano_id: i % 2 ? "starter" : "pro", usuarios_contratados: [4, 2, 6, 1][i], crm_ativo: true, email_ativo: i === 0, email_caixas_contratadas: i === 0 ? 6 : 0, estado: ["ativa", "teste", "atrasada", "cortesia"][i], teste_ate: dia(4), atrasada_desde: i === 2 ? dia(-2) : null, acesso_ate: null,
  visibilidade: "todos", origem: i % 2 ? "site" : "painel", observacao: null, criado_em: dia(-40 + i * 9), liberada: true, valor_mensal: [334.5, 99.8, 479.4, 49.9][i], itens: [], usuarios_ativos: [3, 1, 5, 1][i], convites: i === 0 ? 1 : 0,
  equipe: i === 0 ? equipe.map((m) => ({ ...m })) : [], assinatura: i === 0 ? { estado: "ativa", valor_mensal: 334.5, proximo_vencimento: dia(12).slice(0, 10), cartao_final: "8829", asaas_assinatura_id: "sub_1" } : { estado: "sem", valor_mensal: 0, proximo_vencimento: null, cartao_final: null, asaas_assinatura_id: null },
  dominios: i === 0 ? 1 : 0, negocios: [12, 3, 41, 0][i], ultimo_uso: i === 3 ? null : dia(-i), ...parte,
});
const contasDaCasa = [0, 1, 2, 3].map((i) => contaNaCasa(i, {}));
const mesDeHoje = `${new Date(agora - 3 * 3600000).toISOString().slice(0, 7)}-01`;
const faturamento = {
  mes: mesDeHoje, mrr: 813.9, recebido: 733.9, recebido_liquido: 709.6, taxas: 24.3, a_receber: 99.8, atrasado: 479.4, imposto: 44.03, custos_lancados: 61.5, custo_fixo: 60, custo_email: 7, custo_total: 172.53,
  contas: { ativas: 1, teste: 1, atrasadas: 1, suspensas: 0, canceladas: 0, cortesia: 1, usuarios_pagos: 10, com_email: 1 },
  custos_por_tipo: { taxa_asaas: 24.3, maquina_de_leads: 37.2 },
  serie: [-5, -4, -3, -2, -1, 0].map((p, i) => { const d = new Date(agora); d.setMonth(d.getMonth() + p, 1); return { mes: `${d.toISOString().slice(0, 7)}-01`, recebido: [0, 49.9, 149.7, 389.3, 569.2, 733.9][i], custos: [0, 4, 18, 32, 55, 61.5][i] }; }),
  por_conta: contasDaCasa.map((c, i) => ({ conta_id: c.id, nome: c.nome, estado: c.estado, plano_id: c.plano_id, usuarios: c.usuarios_contratados, mensal: c.valor_mensal, recebido: [334.5, 0, 399.4, 0][i], aberto: [0, 0, 479.4, 0][i], custo: [38.4, 0, 23.1, 0][i] })),
};
const custos = [
  { id: "k1", conta_id: CONTA, tipo: "taxa_asaas", valor: 10.4, descricao: "Taxa do Asaas (CREDIT_CARD)", estimado: false, criado_em: dia(-3) },
  { id: "k2", conta_id: CONTA, tipo: "maquina_de_leads", valor: 3.36, descricao: "Google Maps: até 150 lugares (dentista em Curitiba)", estimado: true, criado_em: dia(-2) },
];
const buscas = [{ id: "b1", nicho: "dentista", cidade: "Curitiba", uf: "PR", fontes: ["osm", "sites"], limite: 50, situacao: "pronta", erro: null, encontrados: 38, progresso: {}, campanha_id: null, entregar_ao_mercurio: false, criado_por: EU, pego_em: dia(-1), terminado_em: dia(-1), created_at: dia(-1), urls: [] }];

const ranking = [
  { membro_id: "m4", user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", nome: "Marina Alves", cargo: "Corretora", papel: "usuario", foto: null, gerente_id: "m2", meta_mensal: 30000, ganhos: 3, vendido: 24600, abertos: 5, em_jogo: 61200, perdidos: 1, atrasadas: 0 },
  { membro_id: "m1", user_id: EU, nome: "Priscila Souza", cargo: "Diretora", papel: "admin", foto: null, gerente_id: null, meta_mensal: 0, ganhos: 2, vendido: 15840, abertos: 4, em_jogo: 38400, perdidos: 0, atrasadas: 2 },
  { membro_id: "m2", user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nome: "Rafael Lima", cargo: "Gerente comercial", papel: "gerente", foto: null, gerente_id: null, meta_mensal: 20000, ganhos: 1, vendido: 6480, abertos: 3, em_jogo: 22300, perdidos: 2, atrasadas: 1 },
];
const camposDaEmpresa = [
  { id: "f1", chave: "finalidade", rotulo: "Finalidade", tipo: "lista", opcoes: ["Compra", "Locação", "Temporada"], grupo: "Imóvel", no_cartao: true, obrigatorio: false, ordem: 0, ativo: true },
  { id: "f2", chave: "bairro", rotulo: "Bairro de interesse", tipo: "texto", opcoes: [], grupo: "Imóvel", no_cartao: true, obrigatorio: false, ordem: 1, ativo: true },
];
const automacoes = [
  { id: "a1", nome: "Rodízio de negócios novos", gatilho: "negocio_criado", condicao: { sem_dono: true }, acao: "atribuir_rodizio", parametros: {}, ativa: true, execucoes: 14, ultima_em: dia(-1), criado_em: dia(-10) },
  { id: "a2", nome: "Retorno da proposta", gatilho: "etapa_mudou", condicao: { etapa: "proposta" }, acao: "criar_tarefa", parametros: { titulo: "Ligar sobre a proposta", em_dias: 2, tipo: "ligacao" }, ativa: true, execucoes: 6, ultima_em: dia(-2), criado_em: dia(-10) },
];
const avisos = [
  { id: "v1", titulo: "Negócio novo para você", texto: "Padaria Sol Nascente", lead_id: null, lido_em: null, criado_em: dia(0) },
  { id: "v2", titulo: "Parado há 5 dias", texto: "Clínica Vida", lead_id: null, lido_em: null, criado_em: dia(-1) },
];

const tabelas = {
  crm_campos: camposDaEmpresa, crm_automacoes: automacoes, crm_avisos: avisos, crm_paginas: [], crm_formularios: [], crm_conversoes: [], crm_automacao_execucoes: [],
  crm_leads: leads, crm_organizations: organizacoes, crm_contacts: [], crm_activities: atividades, crm_lead_events: eventos, crm_campaigns: campanhas, crm_goals: metas, crm_lead_messages: [],
  produto_chaves_api: [
    { id: "ch1", nome: "Claude", prefixo: "acq_3e1b0e92", criado_em: dia(-6), ultimo_uso_em: dia(0), revogada_em: null },
    { id: "ch2", nome: "Site", prefixo: "acq_a91f77c0", criado_em: dia(-3), ultimo_uso_em: null, revogada_em: null },
  ],
  produto_planos: planos, produto_config: [config], produto_cobrancas: cobrancas, produto_email_dominios: [dominio], produto_email_caixas: caixas, produto_email_etapas: etapas, produto_custos: custos,
};

const auth = (papel) => `export function AuthProvider({children}){return children;}
export function useAuth(){return {user:{id:'${EU}',email:'priscila@imobiliariaexemplo.com.br',email_confirmed_at:'2026-10-01',invited_at:null,user_metadata:{}},profile:{id:'${EU}',role:'${papel}',full_name:'Priscila Souza',company_name:'Imobiliária Exemplo'},loading:false,profileError:false,logout:async()=>{},retryProfile:async()=>{},loginWithCredentials:async()=>{},signup:async()=>{}};}`;

const erros = [];
const resultados = [];
const browser = await chromium.launch({ headless: true });

async function abrir({ nome, caminho, largura, papel = "member", estado = estadoDoProduto(), espera, depois, tema = "dark" }) {
  const contexto = await browser.newContext({ viewport: { width: largura, height: largura < 500 ? 844 : 900 }, reducedMotion: "reduce", serviceWorkers: "block", colorScheme: tema });
  // O tema do painel fica guardado no aparelho: aqui o teste escolhe antes de a página abrir.
  await contexto.addInitScript((t) => {
    try {
      localStorage.setItem("aceleriq_theme", t);
    } catch {
      /* sem armazenamento */
    }
  }, tema);
  const pagina = await contexto.newPage();
  pagina.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR/.test(m.text())) erros.push(`${nome}@${largura}: ${m.text().slice(0, Number(process.env.PRODUTO_DETALHE) || 240)}`);
  });
  pagina.on("pageerror", (e) => erros.push(`${nome}@${largura}: ${String(e.message).slice(0, 240)}`));
  await pagina.route("**/src/contexts/AuthContext.tsx*", (r) => r.fulfill({ contentType: "text/javascript", body: auth(papel) }));
  // Tudo o que iria ao servidor é respondido aqui. O que não tem resposta é cortado.
  await pagina.route(/supabase\.co\/|\/rest\/v1\/|\/functions\/v1\/|\/auth\/v1\/|\/realtime\/v1\//, async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const json = (corpo, status = 200) => rota.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-range": "0-0/*" }, body: JSON.stringify(corpo) });
    if (pedido.method() === "OPTIONS") return rota.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const rpc = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(url.pathname);
    if (rpc) {
      if (rpc[1] === "produto_estado") return json(estado);
      if (rpc[1] === "produto_admin_contas") return json(contasDaCasa);
      if (rpc[1] === "produto_faturamento") return json(faturamento);
      if (rpc[1] === "crm_ranking") return json(ranking);
      if (rpc[1] === "crm_origens") return json([]);
      return json(null);
    }
    const tabela = /\/rest\/v1\/([a-z_]+)/.exec(url.pathname);
    if (tabela) {
      if (pedido.method() !== "GET") return json([]);
      // Os filtros mais comuns valem aqui também, senão duas leituras da mesma tabela devolvem as mesmas linhas.
      let linhas = tabelas[tabela[1]] || [];
      url.searchParams.forEach((valor, coluna) => {
        if (valor === "is.null") linhas = linhas.filter((l) => l[coluna] === null || l[coluna] === undefined);
        else if (valor === "not.is.null") linhas = linhas.filter((l) => l[coluna] !== null && l[coluna] !== undefined);
        else if (valor.indexOf("eq.") === 0 && coluna !== "select") linhas = linhas.filter((l) => !(coluna in l) || String(l[coluna]) === valor.slice(3));
      });
      const um = (pedido.headers().accept || "").indexOf("vnd.pgrst.object") >= 0;
      return json(um ? linhas[0] || null : linhas);
    }
    if (/\/functions\/v1\/comercial-leads/.test(url.pathname)) return json({ buscas, candidatos: [], busca: buscas[0] });
    if (/\/functions\/v1\//.test(url.pathname)) return json({ ok: true });
    if (/\/auth\/v1\/user/.test(url.pathname)) return json({ id: EU, email: "priscila@imobiliariaexemplo.com.br" });
    return rota.abort();
  });
  await pagina.goto(`${origem}${caminho}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  try {
    await pagina.waitForSelector(espera, { timeout: 30000 });
  } catch {
    erros.push(`${nome}@${largura}: não apareceu ${espera}`);
  }
  await pagina.waitForTimeout(900);
  // O tour de boas-vindas do painel abre para o perfil sintético: sai da frente.
  const pular = pagina.getByText("Pular tour");
  if (await pular.count()) {
    await pular.first().click();
    await pagina.waitForTimeout(400);
  }
  if (depois) await depois(pagina);
  const medida = await pagina.evaluate(() => ({ larguraDoDocumento: document.documentElement.scrollWidth, janela: window.innerWidth }));
  if (medida.larguraDoDocumento > medida.janela + 1) erros.push(`${nome}@${largura}: a página transborda para o lado (${medida.larguraDoDocumento} > ${medida.janela})`);
  await pagina.screenshot({ path: resolve(saida, `${nome}-${largura}.png`) });
  resultados.push(`${nome}@${largura}`);
  await contexto.close();
}

const telas = [
  { nome: "01-inicio", caminho: "/app", espera: "[data-inicio-do-produto]" },
  { nome: "02-crm-funil", caminho: "/app/crm/crm", espera: "[data-produto-conteudo] header" },
  { nome: "03-crm-visao", caminho: "/app/crm", espera: "[data-produto-conteudo] header" },
  { nome: "04-crm-maquina", caminho: "/app/crm/leads", espera: "[data-maquina-de-leads]" },
  { nome: "05-email", caminho: "/app/email", espera: "[data-email-contratado]" },
  { nome: "06-equipe", caminho: "/app/equipe", espera: "[data-ranking]" },
  { nome: "35-recolhida", caminho: "/app", espera: "[data-inicio-do-produto]", depois: async (p) => { const b = p.locator("[data-recolher-lateral]"); if (await b.isVisible()) { await b.click(); await p.waitForTimeout(400); } } },
  { nome: "06b-equipe-claro", caminho: "/app/equipe", espera: "[data-ranking]", tema: "light" },
  { nome: "06c-perfil", caminho: "/app/equipe", espera: "[data-ranking]", depois: async (p) => { await p.click('[data-pessoa="m4"]'); await p.waitForSelector("[data-salvar-perfil]"); } },
  { nome: "30-automacoes", caminho: "/app/automacoes", espera: "[data-produto-lateral]" },
  { nome: "31-captacao", caminho: "/app/captacao", espera: "[data-produto-lateral]" },
  { nome: "32-espaco", caminho: "/app/espaco", espera: "[data-produto-conteudo]" },
  { nome: "33-campos", caminho: "/app/conta?parte=campos", espera: "[data-campos-da-conta]" },
  { nome: "34-vendedor", caminho: "/app", espera: "[data-inicio-do-produto]", estado: estadoDoProduto({ eu: { papel: "usuario", membro_id: "m4", nome: "Marina Alves" }, raiz: { ve_tudo: false } }) },
  { nome: "07-conta-plano", caminho: "/app/conta?parte=plano", espera: "[data-escolha-de-plano]" },
  { nome: "08-conta-faturas", caminho: "/app/conta?parte=faturas", espera: "[data-faturas]" },
  { nome: "09-oferta-de-email", caminho: "/app/email", espera: "[data-oferta-de-email]", estado: estadoDoProduto({ conta: { email_ativo: false, plano_id: "starter" }, raiz: { email: false, plano: { id: "starter", nome: "Starter", preco_usuario: 49.9, limites: planos[0].limites, email_caixas_incluidas: 0 } } }) },
  { nome: "10-abrir-empresa", caminho: "/app", espera: "[data-onboarding-do-produto]", estado: { conta: null, convite: null, dono_da_casa: false, pagamentos_ativos: true, teste_dias: 7 } },
  { nome: "10b-onboarding-funil", caminho: "/app", espera: "[data-onboarding-do-produto]", estado: { conta: null, convite: null, dono_da_casa: false, pagamentos_ativos: true, teste_dias: 7 }, depois: async (p) => { await p.click('[data-opcao="saude"]'); await p.click('[data-opcao="organizar"]'); await p.fill('input[autocomplete="organization"]', "Clínica Vida"); await p.click("[data-avancar]"); await p.waitForSelector("[data-funil-do-onboarding]"); await p.waitForTimeout(400); } },
  { nome: "10c-onboarding-claro", caminho: "/app", espera: "[data-onboarding-do-produto]", tema: "light", estado: { conta: null, convite: null, dono_da_casa: false, pagamentos_ativos: true, teste_dias: 7 } },
  { nome: "11-teste-vencido", caminho: "/app/crm", espera: "[data-aviso-da-conta]", estado: estadoDoProduto({ conta: { teste_ate: dia(-1) }, raiz: { liberada: false, crm: false, email: false } }) },
  { nome: "12-usuario-comum", caminho: "/app/equipe", espera: "[data-ranking]", estado: estadoDoProduto({ eu: { papel: "usuario", membro_id: "m2" }, raiz: { assinatura: null } }) },
  { nome: "13-venda", caminho: "/crm", espera: "[data-pagina-de-venda]" },
  { nome: "14-aparencia", caminho: "/app/conta?parte=aparencia", espera: "[data-aparencia-da-conta]" },
  { nome: "14b-funil", caminho: "/app/conta?parte=funil", espera: "[data-funil-da-conta]" },
  { nome: "14c-conexoes", caminho: "/app/conta?parte=conexoes", espera: "[data-chaves-de-api]" },
  { nome: "14d-conexoes-claro", caminho: "/app/conta?parte=conexoes", espera: "[data-chaves-de-api]", tema: "light" },
  { nome: "15-inicio-claro", caminho: "/app", espera: "[data-inicio-do-produto]", tema: "light" },
  { nome: "16-crm-claro", caminho: "/app/crm/crm", espera: "[data-produto-conteudo] header", tema: "light" },
  { nome: "17-inicio-azul", caminho: "/app", espera: "[data-inicio-do-produto]", estado: estadoDoProduto({ conta: { aparencia: { cor: "azul", nome_curto: "Imob Exemplo" } } }) },
  { nome: "18-conta-plano-claro", caminho: "/app/conta?parte=plano", espera: "[data-escolha-de-plano]", tema: "light", estado: estadoDoProduto({ conta: { aparencia: { cor: "roxo" } } }) },
  { nome: "20-casa-empresas", caminho: "/produto", papel: "admin", espera: "[data-lista-de-contas]" },
  { nome: "21-casa-ficha", caminho: "/produto", papel: "admin", espera: "[data-lista-de-contas]", depois: async (p) => { await p.click(`[data-conta="${CONTA}"]`); await p.waitForSelector("[data-salvar-conta]", { timeout: 10000 }); await p.waitForTimeout(500); } },
  { nome: "22-casa-email", caminho: "/produto?area=email", papel: "admin", espera: "[data-passo-a-passo]" },
  { nome: "23-casa-precos", caminho: "/produto?area=precos", papel: "admin", espera: "[data-planos-do-produto]" },
  { nome: "24-casa-faturamento", caminho: "/produto?area=faturamento", papel: "admin", espera: "[data-faturamento-por-conta]" },
  { nome: "25-financeiro", caminho: "/financeiro", papel: "admin", espera: "body", depois: async (p) => { await p.getByRole("button", { name: /Visão geral/ }).first().click(); await p.getByText("CRM e E-mail", { exact: true }).last().click(); await p.waitForSelector("[data-faturamento-do-produto]", { timeout: 15000 }); await p.waitForTimeout(500); } },
];

try {
  const so = process.argv[2];
  for (const tela of telas.filter((t) => !so || t.nome.indexOf(so) >= 0)) {
    for (const largura of [390, 1440]) await abrir({ ...tela, largura });
  }
} finally {
  await browser.close();
}
console.log(`${resultados.length} capturas em ${saida}`);
if (erros.length) {
  console.log(`\n${erros.length} problema(s):\n${erros.join("\n")}`);
  process.exit(1);
}
console.log("Sem transbordo e sem erro de console.");
