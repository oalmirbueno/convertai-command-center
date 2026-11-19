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

const integracao = {
  existe: true, ativo: true, modo: "teste", webhook_chave: "0123456789abcdef0123456789abcdef", verify_token: "abcdef0123456789abcdef01", pagina_id: "102938475610", formularios: [],
  tem_app_secret: true, tem_token: true, token_final: "xYz9", wa_phone_id: "556677889900", wa_waba_id: "112233445566", wa_numero: "5541988880000", tem_wa_token: false, wa_token_final: null,
  templates: { lead: "crm_boas_vindas", vendedor: "crm_aviso_vendedor", followup: "crm_retomada" }, idioma: "pt_BR", pontuacao: {}, followup_horas: [24, 72], ultimo_erro: null,
  numeros: { leads_7_dias: 18, na_fila: 2, em_nutricao: 5, envios_pendentes: 1, envios_com_erro: 0 },
};
const vendedores = [
  { membro_id: "m4", user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", nome: "Marina Alves", papel: "usuario", cargo: "Corretora", estado: "ativo", recebe_leads: true, bens: ["imovel"], expediente: { inicio: "09:00", fim: "18:00", dias: [1, 2, 3, 4, 5] }, whatsapp: "5541999990001", no_expediente: true, ultimo_lead_em: dia(0) },
  { membro_id: "m2", user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nome: "Rafael Lima", papel: "gerente", cargo: "Gerente comercial", estado: "ativo", recebe_leads: true, bens: ["carro", "moto"], expediente: {}, whatsapp: "5541999990002", no_expediente: true, ultimo_lead_em: dia(-1) },
  { membro_id: "m1", user_id: EU, nome: "Priscila Souza", papel: "admin", cargo: "Diretora", estado: "ativo", recebe_leads: false, bens: [], expediente: {}, whatsapp: null, no_expediente: true, ultimo_lead_em: null },
];
const atividadeDaIntegracao = {
  leads: [
    { id: "ml1", leadgen_id: "9988776655", form_id: "7001", situacao: "criado", de_teste: false, erro: null, criado_em: dia(0), lead_id: "x1", nome: "João Batista", faixa: "quente", nota: 82, fila_desde: null, nutricao: false, vendedor: "Marina Alves", campanha: "Consórcio imóvel novembro" },
    { id: "ml2", leadgen_id: "9988776656", form_id: "7001", situacao: "criado", de_teste: false, erro: null, criado_em: dia(0), lead_id: "x2", nome: "Carla Mendes", faixa: "morno", nota: 55, fila_desde: dia(0), nutricao: false, vendedor: null, campanha: "Consórcio carro" },
    { id: "ml3", leadgen_id: "teste_1", form_id: null, situacao: "criado", de_teste: true, erro: null, criado_em: dia(-1), lead_id: "x3", nome: "Lead de teste", faixa: "frio", nota: 18, fila_desde: null, nutricao: true, vendedor: null, campanha: null },
  ],
  envios: [
    { id: "e1", destino: "lead", situacao: "simulado", erro: null, criado_em: dia(0), enviado_em: null, lead_id: "x1", tipo: "template", resumo: "crm_boas_vindas" },
    { id: "e2", destino: "vendedor", situacao: "simulado", erro: null, criado_em: dia(0), enviado_em: null, lead_id: "x1", tipo: "template", resumo: "crm_aviso_vendedor" },
  ],
};

// E-mail numa rota só (18/11/2026): entradas da casa e o e-mail como o cliente vê.
const integracaoDoDominio = {
  cloudflare_zona_id: "0123456789abcdef0123456789abcdef", zoho_org_id: "60012345678", zoho_dc: "com", zoho_admin: "admin@imobiliariaexemplo.com.br", zoho_plano: "gratuito", zoho_conectado: true, integracao_conferida_em: dia(0),
  integracao: {
    cloudflare: { ok: false, status: "active", name_servers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"], proxied_email: 0, conferido_em: dia(0), itens: [
      { chave: "zona", situacao: "ok", texto: "Zona ativa na Cloudflare (ada.ns.cloudflare.com, bob.ns.cloudflare.com)." },
      { chave: "proxy", situacao: "ok", texto: "Nenhum registro de e-mail passa pelo proxy." },
      { chave: "mx", situacao: "ok", texto: "MX no provedor novo (mx.zoho.com, mx2.zoho.com, mx3.zoho.com)." },
      { chave: "spf", situacao: "ok", texto: "Um SPF só, com o provedor novo." },
      { chave: "dkim", situacao: "falta", texto: "Sem DKIM em zmail._domainkey.imobiliariaexemplo.com.br." },
      { chave: "dmarc", situacao: "ok", texto: "DMARC com p=none." },
    ] },
    zoho: { ok: true, org_id: "60012345678", plano: "free", usuarios: 5, caixas: caixas.slice(0, 5).map((c, i) => ({ endereco: c.endereco, nome: c.pessoa, apelidos: i === 0 ? ["locacao@imobiliariaexemplo.com.br"] : [], ativa: true, admin: i === 2 })), dominio: { verificado: true, mx: "enabled", spf: true, dkim: false, seletor: "zmail" }, avisos: ["O DKIM ainda não foi verificado no Zoho.", "Plano gratuito: sem IMAP, POP, ActiveSync nem encaminhamento. Webmail e aplicativo do Zoho."], conferido_em: dia(0) },
  },
};
Object.assign(dominio, integracaoDoDominio);
const pedidoDeEmail = (parte) => ({ id: "p0", conta_id: CONTA, extra_id: null, dominio_id: null, tipo: "migracao", dominio: "clinicavida.com.br", caixas: 3, provedor_atual: "Locaweb", observacao: null, origem: "pagina", estado: "novo", valor_migracao: 597, valor_mensal: 39.9, pago_em: null, forma_pagamento: null, valor_pago: null, nota: null, criado_em: dia(0), empresa: "Clínica Vida", email_contato: "financeiro1@exemplo.com.br", telefone: "41999990000", client_id: null, extra_nome: null, etapas_feitas: 0, etapas_total: 0, extras_de_email: [], ...parte });
const pedidosDaCasa = [
  pedidoDeEmail({}),
  pedidoDeEmail({ id: "p1", dominio: "imobteste.com.br", empresa: "Imobiliária Teste", caixas: 7, origem: "casa", estado: "aguardando_pagamento", extra_id: "x1", extra_nome: "Migração de e-mail", client_id: "cl1", criado_em: dia(-2) }),
  pedidoDeEmail({ id: "p2", dominio: "imobiliariaexemplo.com.br", empresa: "Imobiliária Exemplo", caixas: 6, origem: "app", estado: "em_andamento", dominio_id: "d1", pago_em: dia(-8), forma_pagamento: "pix", valor_pago: 597, etapas_feitas: 5, etapas_total: 8, criado_em: dia(-9) }),
];
const emailDoCliente = (parte = {}) => ({ liberado: true, pedido: { id: "p2", tipo: "migracao", dominio: "imobiliariaexemplo.com.br", caixas: 6, estado: "em_andamento", valor_migracao: 597, valor_mensal: 54.8, pago_em: dia(-8), criado_em: dia(-9) }, dominios: [dominio], caixas, etapas, ...parte });

// Central de e-mail e correio (18/11/2026).
const dominioDaCentral = (parte) => ({ id: "d1", dominio: "imobiliariaexemplo.com.br", provedor: "zoho", estado: "concluido", dns_pronto: true, dns_faltas: 0, checado_em: dia(-1), zoho_plano: "gratuito", zoho_conectado: true, cloudflare: true, dominio_vence_em: dia(200).slice(0, 10), provedor_vence_em: null, provedor_custo_mensal: null, correio_provedor: "nenhum", correio_ligado: false, etapas_feitas: 8, etapas_total: 8, ...parte });
const clienteDaCentral = (parte) => ({ conta_id: CONTA, empresa: "Imobiliária Exemplo", estado_da_conta: "ativa", client_id: null, email_ativo: true, liberado: true, caixas_contratadas: 5, caixas: 5, apelidos: 2, caixas_pedidas: 0, caixas_sem_dono: 1, dominios: [dominioDaCentral({})], pedido: { id: "p2", estado: "concluido", tipo: "migracao", pago_em: dia(-20), criado_em: dia(-25), valor_mensal: 39.9, extra_id: null }, cobranca: { por: "extra", mensal: 39.9, proximo_vencimento: dia(12).slice(0, 10), em_atraso: 0 }, assinatura: null, ...parte });
const central = [
  clienteDaCentral({}),
  clienteDaCentral({ conta_id: "c2", empresa: "Clínica Vida", caixas: 7, caixas_contratadas: 7, apelidos: 0, dominios: [dominioDaCentral({ id: "d2", dominio: "clinicavida.com.br", dominio_vence_em: dia(5).slice(0, 10), dns_pronto: false, dns_faltas: 1 })], cobranca: { por: "extra", mensal: 69.7, proximo_vencimento: dia(-4).slice(0, 10), em_atraso: 1 } }),
  clienteDaCentral({ conta_id: "c3", empresa: "Auto Center Rota", caixas: 3, caixas_contratadas: 5, caixas_pedidas: 1, dominios: [dominioDaCentral({ id: "d3", dominio: "autocenterrota.com.br", provedor: "outro", zoho_plano: null, provedor_vence_em: dia(20).slice(0, 10), provedor_custo_mensal: 9.5, correio_provedor: "migadu", correio_ligado: true })] }),
  clienteDaCentral({ conta_id: "c4", empresa: "Studio Pilates Leve", caixas: 2, caixas_contratadas: 2, apelidos: 0, dominios: [dominioDaCentral({ id: "d4", dominio: "pilatesleve.com.br", estado: "preparando", dns_pronto: false, dns_faltas: 3, etapas_feitas: 3, dominio_vence_em: null })], cobranca: null, pedido: { id: "p4", estado: "em_andamento", tipo: "migracao", pago_em: dia(-2), criado_em: dia(-3), valor_mensal: 39.9, extra_id: null } }),
  clienteDaCentral({ conta_id: "c5", empresa: "Padaria Sol Nascente", email_ativo: false, liberado: false, caixas: 0, caixas_contratadas: 0, apelidos: 0, caixas_sem_dono: 0, dominios: [], cobranca: null, pedido: { id: "p5", estado: "novo", tipo: "novo", pago_em: null, criado_em: dia(0), valor_mensal: 39.9, extra_id: null } }),
];
const minhasCaixas = { conta: { id: CONTA, nome: "Imobiliária Exemplo" }, master: true, liberado: true, caixas: [
  { id: "cx2", endereco: "priscila@imobiliariaexemplo.com.br", pessoa: "Priscila Souza", minha: true, dono: "Priscila Souza", dominio: "imobiliariaexemplo.com.br", provedor: "migadu", ligado: true },
  { id: "cx0", endereco: "contato@imobiliariaexemplo.com.br", pessoa: "Recepção", minha: false, dono: null, dominio: "imobiliariaexemplo.com.br", provedor: "migadu", ligado: true },
  { id: "cx3", endereco: "rafael@imobiliariaexemplo.com.br", pessoa: "Rafael Lima", minha: false, dono: "Rafael Lima", dominio: "imobiliariaexemplo.com.br", provedor: "nenhum", ligado: false },
] };
const mensagensDoCorreio = ["Proposta do apartamento 302", "Documentos da locação", "Visita confirmada para sábado", "Boleto do condomínio", "Dúvida sobre o contrato"].map((assunto, i) => ({ id: `m${i}`, de: ["cliente@exemplo.com.br", "cartorio@exemplo.com.br", "ana@exemplo.com.br", "sindico@exemplo.com.br", "joao@exemplo.com.br"][i], para: "priscila@imobiliariaexemplo.com.br", assunto, resumo: "Bom dia, segue o que combinamos por telefone. Qualquer dúvida me avise.", recebida_em: dia(-i), lida: i > 1, tem_anexo: i === 1, aguardando: [null, "voce", "outro", "outro", null][i], automatica: i === 4, categoria: ["principal", "principal", "principal", "atualizacoes", "principal"][i] }));
const tarefasDoCorreio = [["Colher a assinatura do fiador", "Do e-mail de cartorio@exemplo.com.br", null], ["Rever a entrada do apartamento 302", "Do e-mail de cliente@exemplo.com.br", null], ["Enviar as fotos novas ao portal", "Criada por você", dia(0)]].map((t, i) => ({ id: `tf${i}`, titulo: t[0], origem: t[1], prazo: null, feita_em: t[2], criado_em: dia(-1) }));
const hojeSP = new Date(agora - 3 * 3600000).toISOString().slice(0, 10);
const compromissosDoCorreio = [["Visita ao apartamento 302", "Com Marcos Andrade", "13:30"], ["Alinhamento do time", "Sala de reunião", "17:00"]].map((c, i) => ({ id: `cp${i}`, titulo: c[0], detalhe: c[1], inicio: `${hojeSP}T${c[2]}:00Z`, fim: null }));

// Central de domínios e sites (19/11/2026).
const dnsCerto = { pronto: true, itens: ["mx", "spf", "dkim", "dmarc"].map((chave) => ({ chave, estado: "certo", achado: chave === "mx" ? ["10 mx.zoho.com"] : [] })) };
const dominioDaCasa = (parte) => ({ id: "cd1", dominio: "imobiliariaexemplo.com.br", origem: "email", cliente: `p:${CONTA}`, cliente_nome: "Imobiliária Exemplo", registrador: "Registro.br", titular: "Imobiliária Exemplo Ltda", nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"], cloudflare_zona_id: "z1", cloudflare_status: "active", na_cloudflare_da_casa: true, vence_em: dia(240).slice(0, 10), vencimento_fonte: "rdap", rdap_lido_em: dia(0), rdap_erro: null, dns_email: dnsCerto, dns_conferido_em: dia(0), email: { dominio_id: "d1", provedor: "zoho", estado: "concluido" }, custo_valor: 40, custo_periodo: "anual", preco_valor: 9.9, preco_periodo: "mensal", observacao: null, arquivado: false, criado_em: dia(-20), ...parte });
const siteDaCasa = (parte) => ({ id: "s1", nome: "site-imobiliaria", endereco: "imobiliariaexemplo.com.br", origem: "cloudflare", cf_tipo: "worker", cf_nome: "site-imobiliaria", hospedagem: "Cloudflare Workers", dominios_personalizados: ["imobiliariaexemplo.com.br", "www.imobiliariaexemplo.com.br"], cliente: `p:${CONTA}`, cliente_nome: "Imobiliária Exemplo", cliente_herdado: true, dominio_id: "cd1", dominio: "imobiliariaexemplo.com.br", ultima_publicacao: dia(-3), http_status: 200, ssl_ok: true, resposta_ms: 212, erro: null, conferido_em: dia(0), custo_valor: 0, custo_periodo: "mensal", preco_valor: 89.9, preco_periodo: "mensal", observacao: null, arquivado: false, criado_em: dia(-30), ...parte });
const centralDeDominios = {
  dominios: [
    dominioDaCasa({}),
    dominioDaCasa({ id: "cd2", dominio: "clinicavida.com.br", origem: "cloudflare", cliente: "c:cl2", cliente_nome: "Clínica Vida", vence_em: dia(6).slice(0, 10), dns_email: { pronto: false, itens: [{ chave: "mx", estado: "certo", achado: ["10 mx.zoho.com"] }, { chave: "spf", estado: "certo" }, { chave: "dkim", estado: "falta" }, { chave: "dmarc", estado: "atencao" }] }, email: { dominio_id: "d2", provedor: "zoho", estado: "concluido" }, preco_valor: 120, preco_periodo: "anual" }),
    dominioDaCasa({ id: "cd3", dominio: "autocenterrota.com.br", origem: "manual", cliente: "c:cl3", cliente_nome: "Auto Center Rota", registrador: "Registro.br", nameservers: ["ns1.dns-parking.com", "ns2.dns-parking.com"], cloudflare_zona_id: null, cloudflare_status: null, na_cloudflare_da_casa: false, vence_em: dia(24).slice(0, 10), dns_email: null, email: null, custo_valor: 40, preco_valor: null }),
    dominioDaCasa({ id: "cd4", dominio: "pilatesleve.com", origem: "cloudflare", cliente: null, cliente_nome: null, registrador: "Hostinger operations, UAB", cloudflare_status: "pending", vence_em: dia(310).slice(0, 10), dns_email: null, email: null, custo_valor: 70, preco_valor: null }),
    dominioDaCasa({ id: null, dominio: "padariasol.com.br", origem: "email", cliente: "c:cl5", cliente_nome: "Padaria Sol Nascente", registrador: null, nameservers: [], cloudflare_zona_id: null, na_cloudflare_da_casa: false, vence_em: null, vencimento_fonte: null, rdap_lido_em: null, dns_email: null, email: { dominio_id: "d5", provedor: "zoho", estado: "preparando" }, custo_valor: null, preco_valor: null }),
  ],
  sites: [
    siteDaCasa({}),
    siteDaCasa({ id: "s2", nome: "clinica-vida", endereco: "www.clinicavida.com.br", cf_nome: "clinica-vida", cliente: "c:cl2", cliente_nome: "Clínica Vida", dominio_id: "cd2", dominio: "clinicavida.com.br", http_status: null, ssl_ok: null, resposta_ms: null, erro: "Não respondeu em 8 segundos.", preco_valor: 149.9 }),
    siteDaCasa({ id: "s3", nome: "loja-rota", endereco: "loja-rota.pages.dev", cf_tipo: "pages", cf_nome: "loja-rota", hospedagem: "Cloudflare Pages", dominios_personalizados: [], cliente: "c:cl3", cliente_nome: "Auto Center Rota", cliente_herdado: false, dominio_id: null, dominio: null, resposta_ms: 3900, ultima_publicacao: dia(-40), preco_valor: 69.9, custo_valor: 5 }),
    siteDaCasa({ id: "s4", nome: "pilatesleve.com", endereco: "pilatesleve.com", origem: "manual", cf_tipo: null, cf_nome: null, hospedagem: "Hostinger", dominios_personalizados: [], cliente: null, cliente_nome: null, cliente_herdado: false, dominio_id: "cd4", http_status: 200, conferido_em: null, ultima_publicacao: null, preco_valor: null, custo_valor: 19.9 }),
  ],
  clientes: [{ valor: "c:cl3", nome: "Auto Center Rota" }, { valor: "c:cl2", nome: "Clínica Vida" }, { valor: `p:${CONTA}`, nome: "Imobiliária Exemplo (produto)" }, { valor: "c:cl5", nome: "Padaria Sol Nascente" }],
  leitura: { dominios_em: dia(0), cloudflare_em: dia(0), sites_em: dia(0) },
};

const tabelas = {
  crm_campos: camposDaEmpresa, crm_automacoes: automacoes, crm_avisos: avisos, crm_paginas: [], crm_formularios: [], crm_conversoes: [], crm_automacao_execucoes: [],
  crm_leads: leads, crm_organizations: organizacoes, crm_contacts: [], crm_activities: atividades, crm_lead_events: eventos, crm_campaigns: campanhas, crm_goals: metas, crm_lead_messages: [],
  produto_chaves_api: [
    { id: "ch1", nome: "Claude", prefixo: "acq_3e1b0e92", criado_em: dia(-6), ultimo_uso_em: dia(0), revogada_em: null },
    { id: "ch2", nome: "Site", prefixo: "acq_a91f77c0", criado_em: dia(-3), ultimo_uso_em: null, revogada_em: null },
  ],
  produto_planos: planos, produto_config: [config], produto_cobrancas: cobrancas, produto_email_dominios: [dominio], produto_email_caixas: caixas, produto_email_etapas: etapas, produto_custos: custos, produto_correio_tarefas: tarefasDoCorreio, produto_correio_compromissos: compromissosDoCorreio,
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
      if (rpc[1] === "produto_email_da_conta") return json(estado.__email || emailDoCliente());
      if (rpc[1] === "produto_email_pedidos_da_casa") return json(pedidosDaCasa);
      if (rpc[1] === "produto_email_central") return json(central);
      if (rpc[1] === "casa_dominios_sites_central") return json(centralDeDominios);
      if (rpc[1] === "produto_precos") return json(config);
      if (rpc[1] === "produto_ofertas_publicas") return json([{ id: "o1", nome: "Domínio gerenciado", descricao: "A Aceleriq renova e cuida do domínio.", cobranca: "mensal", valor: 14.9, mostra_em: "ambos" }, { id: "o2", nome: "Migração expressa", descricao: "Tudo copiado em até 24 horas.", cobranca: "unica", valor: 197, mostra_em: "ambos" }]);
      if (rpc[1] === "produto_correio_eu") return json({ membro_id: "m1", conta_id: CONTA, nome: "Priscila Souza" });
      if (rpc[1] === "produto_email_minhas_caixas") return json(estado.__caixas || minhasCaixas);
      if (rpc[1] === "produto_admin_contas") return json(contasDaCasa);
      if (rpc[1] === "produto_faturamento") return json(faturamento);
      if (rpc[1] === "crm_ranking") return json(ranking);
      if (rpc[1] === "crm_integracao_ler" || rpc[1] === "crm_integracao_salvar") return json(integracao);
      if (rpc[1] === "crm_vendedores_ler") return json(vendedores);
      if (rpc[1] === "crm_integracao_atividade") return json(atividadeDaIntegracao);
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
    if (/\/functions\/v1\/produto-correio/.test(url.pathname)) {
      const corpo = pedido.postDataJSON() || {};
      if (corpo.caixa_id === "cx3") return json({ error: "correio_desligado", mensagem: "O correio desta caixa ainda não foi ligado." }, 409);
      if (corpo.acao === "inicio") return json({ pastas: [{ id: "INBOX", nome: "INBOX", nao_lidas: 2 }, { id: "Sent", nome: "Sent", nao_lidas: 0 }, { id: "Arquivo do Gmail", nome: "Arquivo do Gmail", nao_lidas: 0 }, { id: "Junk", nome: "Junk", nao_lidas: 0 }], mensagens: mensagensDoCorreio });
      if (corpo.acao === "campanhas") return json({ campanhas: [{ quando: dia(-1), assunto: "Novidades de novembro", enviados: 42, falhas: 1 }], usados_hoje: 12, limite_do_dia: 150 });
      if (corpo.acao === "pastas") return json({ pastas: [{ id: "INBOX", nome: "INBOX", nao_lidas: 2 }, { id: "Sent", nome: "Sent", nao_lidas: 0 }, { id: "Arquivo do Gmail", nome: "Arquivo do Gmail", nao_lidas: 0 }, { id: "Junk", nome: "Junk", nao_lidas: 0 }] });
      if (corpo.acao === "ler") return json({ mensagem: { ...mensagensDoCorreio[0], texto: `Bom dia, Priscila.

Segue a proposta do apartamento 302 como combinamos. O cliente pode fechar ainda esta semana.

Abraço,
Marcos`, html: '<table width="100%" style="background:#0b3d2e;border-radius:16px"><tr><td style="padding:28px;color:#fff;font-family:Arial"><h1 style="margin:0 0 8px;color:#00ff6a">Proposta do 302</h1><p style="margin:0">Segue a proposta como combinamos. O cliente pode fechar ainda esta semana.</p><a href="https://exemplo.com" style="display:inline-block;margin-top:16px;background:#00ff6a;color:#0b3d2e;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">Ver a proposta</a></td></tr></table><p style="font-family:Arial">Abraço,<br>Marcos</p>', anexos: [{ nome: "proposta-302.pdf", tamanho: 120000 }] } });
      return json({ mensagens: mensagensDoCorreio });
    }
    if (/\/auth\/v1\/token/.test(url.pathname)) return json({ access_token: "sintetico", token_type: "bearer", expires_in: 3600, refresh_token: "sintetico", user: { id: EU, email: "priscila@imobiliariaexemplo.com.br" } });
    if (/\/functions\/v1\/produto-email/.test(url.pathname)) return json({ estado: { ligada: false, motivo: "A caixa está desligada. Ligar é decisão do dono: veja o custo abaixo.", plano_necessario: "Zoho Mail Lite (ou superior) na conta da Aceleriq", custo: { por_usuario_mes: "R$ 6,25 por usuário por mês (Mail Lite, cobrança anual)", cobranca: "Só anual, sem plano mensal", fonte: "zoho.com/mail/zohomail-pricing.html" } }, dominio: null });
    if (/\/functions\/v1\/casa-dominios/.test(url.pathname)) return json({ cloudflare: false });
    if (/\/functions\/v1\//.test(url.pathname)) return json({ ok: true });
    if (/\/auth\/v1\/user/.test(url.pathname)) return json({ id: EU, email: "priscila@imobiliariaexemplo.com.br" });
    return rota.abort();
  });
  await pagina.goto(`${origem}${caminho}`, { waitUntil: "domcontentloaded", timeout: Number(process.env.PRODUTO_ESPERA) || 180000 });
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

// O tour de boas-vindas reabre a cada tela com o perfil sintético, e clicar em "Pular" fecha a janela
// aberta por baixo: aqui ele só some da frente.
const pularTour = async (p) => {
  await p.addStyleTag({ content: 'div[class="fixed inset-0 z-[9999]"]{display:none !important}' });
  await p.waitForTimeout(400);
};

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
  { nome: "40-integracoes", caminho: "/app/integracoes", espera: "[data-parte]" },
  { nome: "41-integ-meta", caminho: "/app/integracoes?parte=meta", espera: "[data-parte]" },
  { nome: "42-integ-whatsapp", caminho: "/app/integracoes?parte=whatsapp", espera: "[data-parte]" },
  { nome: "43-integ-pontuacao", caminho: "/app/integracoes?parte=pontuacao", espera: "[data-parte]" },
  { nome: "44-integ-vendedores", caminho: "/app/integracoes?parte=vendedores", espera: "[data-parte]" },
  { nome: "30-automacoes", caminho: "/app/automacoes", espera: "[data-produto-lateral]" },
  { nome: "31-captacao", caminho: "/app/captacao", espera: "[data-produto-lateral]" },
  { nome: "32-espaco", caminho: "/app/espaco", espera: "[data-produto-conteudo]" },
  { nome: "33-campos", caminho: "/app/conta?parte=campos", espera: "[data-campos-da-conta]" },
  { nome: "34-vendedor", caminho: "/app", espera: "[data-inicio-do-produto]", estado: estadoDoProduto({ eu: { papel: "usuario", membro_id: "m4", nome: "Marina Alves" }, raiz: { ve_tudo: false } }) },
  { nome: "07-conta-plano", caminho: "/app/conta?parte=plano", espera: "[data-escolha-de-plano]" },
  { nome: "08-conta-faturas", caminho: "/app/conta?parte=faturas", espera: "[data-faturas]" },
  { nome: "09-oferta-de-email", caminho: "/app/email", espera: "[data-oferta-de-email]", estado: estadoDoProduto({ conta: { email_ativo: false, plano_id: "starter" }, raiz: { email: false, plano: { id: "starter", nome: "Starter", preco_usuario: 49.9, limites: planos[0].limites, email_caixas_incluidas: 0 } } }) },
  { nome: "09b-pedido-recebido", caminho: "/app/email", espera: "[data-andamento-do-pedido]", estado: { ...estadoDoProduto({ conta: { email_ativo: false, plano_id: "starter" }, raiz: { email: false, plano: { id: "starter", nome: "Starter", preco_usuario: 49.9, limites: planos[0].limites, email_caixas_incluidas: 0 } } }), __email: emailDoCliente({ liberado: false, pedido: { id: "p0", tipo: "migracao", dominio: "imobiliariaexemplo.com.br", caixas: 3, estado: "novo", valor_migracao: 597, valor_mensal: 39.9, pago_em: null, criado_em: dia(0) }, dominios: [], caixas: [], etapas: [] }) } },
  { nome: "09c-so-email-cai-no-email", caminho: "/app", espera: "[data-email-contratado]", estado: estadoDoProduto({ conta: { teste_ate: dia(-1) }, raiz: { liberada: false, crm: false, email: false } }) },
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
  { nome: "22b-casa-entradas", caminho: "/produto?area=email", papel: "admin", espera: "[data-entradas-de-email]" },
  { nome: "22c-casa-marcar-pago", caminho: "/produto?area=email", papel: "admin", espera: "[data-marcar-pago]", depois: async (p) => { await p.locator("[data-marcar-pago]").first().click(); await p.waitForSelector("[data-confirmar-pago]"); await p.waitForTimeout(400); } },
  { nome: "22d-casa-integracao", caminho: "/produto?area=email", papel: "admin", espera: "[data-conferencia-zoho]", depois: async (p) => { await p.locator("[data-conferencia-cloudflare]").scrollIntoViewIfNeeded(); await p.waitForTimeout(300); } },
  { nome: "22e-casa-caixa", caminho: "/produto?area=caixa", papel: "admin", espera: "[data-caixa-desligada]" },
  { nome: "26-central", caminho: "/produto?area=central", papel: "admin", espera: "[data-clientes-da-central]" },
  { nome: "26b-central-ficha", caminho: "/produto?area=central", papel: "admin", espera: "[data-clientes-da-central]", depois: async (p) => { await p.locator('[data-cliente="critico"]').first().click(); await p.waitForSelector("[data-ficha-do-email]"); await p.waitForTimeout(400); } },
  { nome: "27-dominios", caminho: "/produto/dominios", papel: "admin", espera: "[data-lista-de-dominios]", depois: pularTour },
  { nome: "27b-dominios-ficha", caminho: "/produto/dominios", papel: "admin", espera: "[data-lista-de-dominios]", depois: async (p) => { await pularTour(p); await p.locator('[data-dominio="critico"]').first().click(); await p.waitForSelector("[data-ficha-do-dominio]"); await pularTour(p); } },
  { nome: "27c-sites", caminho: "/produto/dominios/sites", papel: "admin", espera: "[data-lista-de-sites]", depois: pularTour },
  { nome: "27d-sites-claro", caminho: "/produto/dominios/sites", papel: "admin", tema: "light", espera: "[data-lista-de-sites]", depois: pularTour },
  { nome: "27e-cadastro", caminho: "/produto/dominios/sites", papel: "admin", espera: "[data-lista-de-sites]", depois: async (p) => { await pularTour(p); await p.locator("[data-cadastrar]").click(); await p.waitForSelector("[data-confirmar-cadastro]"); await p.fill('[data-campo="endereco"]', "loja.exemplo.com.br"); await p.fill('[data-campo="preco"]', "99,90"); await p.waitForTimeout(300); } },
  { nome: "50-correio-porta", caminho: "/correio", espera: "[data-porta-do-correio]" },
  { nome: "51-correio", caminho: "/correio", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-grupo-da-caixa]"); await p.waitForTimeout(700); } },
  { nome: "51b-correio-claro", caminho: "/correio?de=painel", tema: "light", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-grupo-da-caixa]"); await p.click("[data-mensagem]"); await p.waitForSelector("[data-texto-da-mensagem]"); await p.waitForTimeout(500); } },
  { nome: "51c-correio-seletor", caminho: "/correio", tema: "light", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-caixas-do-correio]"); await p.click("[data-caixas-do-correio]"); await p.waitForSelector("[data-caixa-opcao]"); await p.waitForTimeout(400); } },
  { nome: "52-correio-em-preparo", caminho: "/correio", espera: "[data-porta-do-correio]", estado: { ...estadoDoProduto(), __caixas: { ...minhasCaixas, master: false, caixas: [minhasCaixas.caixas[2]] } }, depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-correio-em-preparo]"); await p.waitForTimeout(500); } },
  { nome: "53-correio-quadro", caminho: "/correio?area=quadro", tema: "light", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-coluna]"); await p.waitForTimeout(500); } },
  { nome: "53b-correio-quadro-aberto", caminho: "/correio?area=quadro", tema: "light", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-cartao]"); await p.click("[data-cartao]"); await p.waitForSelector("[data-quadro-leitura] [data-texto-da-mensagem]"); await p.waitForTimeout(600); } },
  { nome: "54-correio-dia", caminho: "/correio?area=dia", tema: "light", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-meu-dia]"); await p.waitForTimeout(700); } },
  { nome: "55-correio-campanhas", caminho: "/correio?area=campanhas", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-campanhas-do-correio]"); } },
  { nome: "56-correio-ferramentas", caminho: "/correio?area=ferramentas", tema: "light", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-planos-e-precos]"); } },
  { nome: "56b-correio-contratar", caminho: "/correio?area=ferramentas", tema: "light", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-caixa-a-mais]"); await p.click("[data-caixa-a-mais]"); await p.click("[data-caixa-a-mais]"); await p.click("[data-oferta]"); await p.waitForTimeout(300); } },
  { nome: "56c-correio-lista-de-ferramentas", caminho: "/correio?area=ferramentas", tema: "light", espera: "[data-porta-do-correio]", depois: async (p) => { await p.fill('[data-campo="senha-do-correio"]', "senha-sintetica"); await p.keyboard.press("Enter"); await p.waitForSelector('[data-aba-ferramentas="ferramentas"]'); await p.click('[data-aba-ferramentas="ferramentas"]'); await p.waitForSelector("[data-ferramenta]"); } },
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
