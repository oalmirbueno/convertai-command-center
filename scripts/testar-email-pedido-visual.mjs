/**
 * Pedido do E-mail profissional (/email/pedir) com as ofertas (order bumps), num navegador isolado.
 * Nenhuma conexão de produção: todo pedido ao servidor é respondido aqui ou cortado.
 * Nenhuma cobrança é criada: a "fatura" do Asaas é uma página falsa servida por este script.
 *
 *   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4191 --strictPort   (em outro terminal)
 *   node scripts/testar-email-pedido-visual.mjs
 *
 * O que confere, em 390 e 1440 px:
 *   1. Cobrança LIGADA: as ofertas aparecem (a marcada já vem marcada), o total de hoje e o mensal
 *      mudam ao marcar, pede CPF ou CNPJ, manda o pedido com as ofertas, chama `pagar_email` e vai
 *      para a fatura.
 *   2. Cobrança DESLIGADA: as ofertas vão junto com o pedido, sem pedir documento e sem `pagar_email`.
 *   3. E-mail novo (domínio sem e-mail): a oferta só da migração não aparece e não há migração.
 * Sem transbordo para o lado e sem erro de console. Capturas em outputs/email-pedido-visual.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origem = process.env.PEDIDO_ORIGEM || "http://127.0.0.1:4191";
const saida = resolve("outputs/email-pedido-visual");
await mkdir(saida, { recursive: true });

const EU = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTA = "11111111-1111-4111-8111-111111111111";
const FATURA = "https://sandbox.asaas.invalid/i/simulada";
const dia = (d) => new Date(Date.now() + d * 86400000).toISOString();

const precos = (ligada) => ({ pagamentos_ativos: ligada, teste_dias: 7, tolerancia_dias: 5, email_migracao: 597, email_mensal: 39.9, email_caixas_no_mensal: 5, email_caixa_extra: 14.9 });
const ofertas = [
  { id: "dominio_gerenciado", nome: "Domínio gerenciado", descricao: "A Aceleriq cuida do DNS, da renovação e avisa antes de vencer.", cobranca: "mensal", valor: 14.9, mostra_em: "ambos", marcada: true },
  { id: "site_cuidado", nome: "Site hospedado e cuidado", descricao: "O site da empresa no ar, com cadeado, cópia e ajustes pequenos inclusos.", cobranca: "mensal", valor: 69, mostra_em: "ambos", marcada: false },
  { id: "backup_antigo", nome: "Backup do e-mail antigo", descricao: "Uma cópia de tudo o que está no e-mail de hoje, guardada por 1 ano.", cobranca: "unica", valor: 97, mostra_em: "migracao", marcada: false },
  { id: "migracao_expressa", nome: "Migração expressa em 24 horas", descricao: "A migração começa no mesmo dia e fica pronta em até 24 horas úteis.", cobranca: "unica", valor: 197, mostra_em: "migracao", marcada: false },
];
const estadoSemConta = (ligada) => ({ conta: null, convite: null, dono_da_casa: false, pagamentos_ativos: ligada, teste_dias: 7 });
const estadoComConta = (ligada) => ({
  conta: { id: CONTA, nome: "Clínica Exemplo", estado: "teste", plano_id: "starter", usuarios_contratados: 1, crm_ativo: true, email_ativo: false, email_caixas_contratadas: 0, teste_ate: dia(7), atrasada_desde: null, acesso_ate: null, visibilidade: "todos", aparencia: {}, perfil: {}, documento: null, email_cobranca: "dona@clinicaexemplo.com.br", telefone: null },
  eu: { membro_id: "m1", papel: "admin", nome: "Pessoa de Teste", email: "dona@clinicaexemplo.com.br" },
  plano: { id: "starter", nome: "Starter", preco_usuario: 49.9, limites: {}, email_caixas_incluidas: 0 },
  liberada: true, crm: true, email: false, dono_da_casa: false, pagamentos_ativos: ligada, tolerancia_dias: 5, teste_dias: 7,
  equipe: [], maquina_no_mes: 0,
  assinatura: { estado: "sem", valor_mensal: 0, proximo_vencimento: null, cartao_final: null, cartao_bandeira: null, itens: [], checkout_link: null },
});

// Pessoa já logada (o cadastro tem o próprio teste visual): a página vai direto ao último passo.
const auth = `export function AuthProvider({children}){return children;}
export function useAuth(){
  return {user:{id:'${EU}',email:'dona@clinicaexemplo.com.br',email_confirmed_at:'2026-11-19',invited_at:null,user_metadata:{}},
    profile:{id:'${EU}',role:'member',full_name:'Pessoa de Teste',company_name:'Clínica Exemplo'},
    loading:false,profileError:false,logout:async()=>{},retryProfile:async()=>{},loginWithCredentials:async()=>{},signup:async()=>{}};
}`;

const erros = [];
const feitos = [];
const browser = await chromium.launch({ headless: true });
const exigir = (certo, frase) => {
  if (!certo) erros.push(frase);
};

async function contextoNovo({ largura, ligada, nome, rascunho }) {
  const contexto = await browser.newContext({ viewport: { width: largura, height: largura < 500 ? 844 : 900 }, reducedMotion: "reduce", serviceWorkers: "block", colorScheme: "dark" });
  await contexto.addInitScript((r) => localStorage.setItem("aceleriq:email:pedido", JSON.stringify(r)), rascunho);
  const pagina = await contexto.newPage();
  const chamadas = { pedir: [], pagar: [], criar: [] };
  let temConta = false;
  pagina.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR/.test(m.text())) erros.push(`${nome}@${largura}: ${m.text().slice(0, 300)}`);
  });
  pagina.on("pageerror", (e) => erros.push(`${nome}@${largura}: ${String(e.message).slice(0, 300)}`));
  await pagina.route("**/src/contexts/AuthContext.tsx*", (r) => r.fulfill({ contentType: "text/javascript", body: auth }));
  await pagina.route(`${FATURA}*`, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><title>Fatura simulada</title><body data-fatura-simulada style='font-family:sans-serif;padding:40px'><h1>Fatura simulada</h1><p>Nenhuma cobrança foi criada.</p></body>" }));
  await pagina.route(/supabase\.co\/|\/rest\/v1\/|\/functions\/v1\/|\/auth\/v1\/|\/realtime\/v1\//, async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const json = (corpo, status = 200) => rota.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-range": "0-0/*" }, body: JSON.stringify(corpo) });
    if (pedido.method() === "OPTIONS") return rota.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const corpo = () => {
      try {
        return JSON.parse(pedido.postData() || "{}");
      } catch {
        return {};
      }
    };
    const rpc = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(url.pathname);
    if (rpc) {
      if (rpc[1] === "produto_precos") return json(precos(ligada));
      if (rpc[1] === "produto_ofertas_publicas") return json(ofertas);
      if (rpc[1] === "produto_estado") return json(temConta ? estadoComConta(ligada) : estadoSemConta(ligada));
      if (rpc[1] === "produto_criar_conta") {
        chamadas.criar.push(corpo());
        temConta = true;
        return json(CONTA);
      }
      return json(null);
    }
    if (/\/functions\/v1\/produto$/.test(url.pathname)) {
      const c = corpo();
      if (c.acao === "pedir_email") {
        chamadas.pedir.push(c);
        return json({ ok: true, pedido_id: "p1", novo: true });
      }
      if (c.acao === "pagar_email") {
        chamadas.pagar.push(c);
        return ligada ? json({ link: FATURA, valor: 1, mensal: 1 }) : json({ error: "pagamentos_desligados", mensagem: "Desligada." }, 409);
      }
      return json({ ok: true });
    }
    if (/\/functions\/v1\//.test(url.pathname)) return json({ ok: true });
    if (/\/rest\/v1\//.test(url.pathname)) return json([]);
    if (/\/auth\/v1\/user/.test(url.pathname)) return json({ id: EU, email: "dona@clinicaexemplo.com.br" });
    return rota.abort();
  });
  return { contexto, pagina, chamadas };
}

const semTransbordo = async (pagina, nome, largura) => {
  const m = await pagina.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth }));
  if (m.doc > m.janela + 1) erros.push(`${nome}@${largura}: a página transborda para o lado (${m.doc} > ${m.janela})`);
};
const textoDe = (pagina, seletor) => pagina.locator(seletor).first().innerText();
const reaisNaTela = (t) => Number(String(t).replace(/[^\d,]/g, "").replace(",", "."));

async function chegarAoUltimoPasso(pagina) {
  await pagina.goto(`${origem}/email/pedir`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await pagina.waitForSelector("[data-continuar-pedido]", { timeout: 90000 });
  await pagina.click("[data-continuar-pedido]");
  await pagina.waitForSelector('[data-passo-do-pedido="enviar"]', { timeout: 30000 });
}

/** 1. Cobrança ligada: migração com as ofertas e o pagamento. */
async function pedidoPago(largura) {
  const nome = "pedido-cobranca-ligada";
  const { contexto, pagina, chamadas } = await contextoNovo({ largura, ligada: true, nome, rascunho: { dominio: "clinicaexemplo.com.br", semDominio: false, semEmail: false, caixas: 3, observacao: "", empresa: "Clínica Exemplo", ofertas: null } });
  await chegarAoUltimoPasso(pagina);
  await pagina.waitForSelector("[data-ofertas-do-pedido]", { timeout: 30000 });
  exigir((await pagina.locator("[data-oferta]").count()) === 4, `${nome}@${largura}: a migração deveria mostrar as 4 ofertas`);
  exigir(await pagina.locator('[data-oferta="dominio_gerenciado"] input').isChecked(), `${nome}@${largura}: a oferta marcada não veio marcada`);
  let hoje = reaisNaTela(await textoDe(pagina, "[data-total-hoje] span:last-child"));
  exigir(Math.abs(hoje - (597 + 39.9 + 14.9)) < 0.01, `${nome}@${largura}: total de hoje errado (${hoje})`);
  await pagina.click('[data-oferta="backup_antigo"]');
  hoje = reaisNaTela(await textoDe(pagina, "[data-total-hoje] span:last-child"));
  const mensal = reaisNaTela(await textoDe(pagina, "[data-mensal-depois] span:last-child"));
  exigir(Math.abs(hoje - (597 + 39.9 + 14.9 + 97)) < 0.01, `${nome}@${largura}: total de hoje não somou a oferta (${hoje})`);
  exigir(Math.abs(mensal - (39.9 + 14.9)) < 0.01, `${nome}@${largura}: mensal errado (${mensal})`);
  exigir(/Pagar R\$/.test(await textoDe(pagina, "[data-enviar-pedido]")), `${nome}@${largura}: o botão deveria ser de pagar`);
  await semTransbordo(pagina, nome, largura);
  await pagina.screenshot({ path: resolve(saida, `${nome}-${largura}.png`), fullPage: true });
  await pagina.click("[data-enviar-pedido]");
  exigir((await pagina.locator("[data-erro-do-pedido]").innerText().catch(() => "")).indexOf("CPF") >= 0, `${nome}@${largura}: sem documento deveria pedir CPF ou CNPJ`);
  await pagina.fill('[data-campo="documento"]', "12.345.678/0001-95");
  await pagina.click("[data-enviar-pedido]");
  await pagina.waitForSelector("[data-fatura-simulada]", { timeout: 30000 });
  const p = chamadas.pedir[0] || {};
  exigir(p.tipo === "migracao" && JSON.stringify(p.ofertas) === JSON.stringify(["dominio_gerenciado", "backup_antigo"]), `${nome}@${largura}: o pedido não levou o tipo e as ofertas (${JSON.stringify(p)})`);
  const g = chamadas.pagar[0] || {};
  exigir(g.documento === "12345678000195" && JSON.stringify(g.ofertas) === JSON.stringify(["dominio_gerenciado", "backup_antigo"]), `${nome}@${largura}: o pagamento não levou documento e ofertas (${JSON.stringify(g)})`);
  exigir(chamadas.criar.length === 1 && chamadas.criar[0]._documento === "12345678000195", `${nome}@${largura}: a empresa deveria nascer com o documento`);
  feitos.push(`${nome}@${largura}`);
  await contexto.close();
}

/** 2. Cobrança desligada: o pedido leva as ofertas e não chama o pagamento. */
async function pedidoSemCobranca(largura) {
  const nome = "pedido-cobranca-desligada";
  const { contexto, pagina, chamadas } = await contextoNovo({ largura, ligada: false, nome, rascunho: { dominio: "clinicaexemplo.com.br", semDominio: false, semEmail: false, caixas: 3, observacao: "", empresa: "Clínica Exemplo", ofertas: ["site_cuidado"] } });
  await chegarAoUltimoPasso(pagina);
  exigir((await pagina.locator('[data-campo="documento"]').count()) === 0, `${nome}@${largura}: não deveria pedir documento`);
  exigir(/Enviar pedido/.test(await textoDe(pagina, "[data-enviar-pedido]")), `${nome}@${largura}: o botão deveria ser de enviar`);
  await pagina.click("[data-enviar-pedido]");
  await pagina.waitForSelector("[data-pedido-enviado]", { timeout: 30000 });
  exigir(JSON.stringify((chamadas.pedir[0] || {}).ofertas) === JSON.stringify(["site_cuidado"]), `${nome}@${largura}: o pedido não levou a oferta escolhida`);
  exigir(chamadas.pagar.length === 0, `${nome}@${largura}: não deveria chamar o pagamento`);
  await semTransbordo(pagina, nome, largura);
  await pagina.screenshot({ path: resolve(saida, `${nome}-${largura}.png`), fullPage: true });
  feitos.push(`${nome}@${largura}`);
  await contexto.close();
}

/** 3. E-mail novo: sem migração e sem as ofertas só da migração. */
async function emailNovo(largura) {
  const nome = "pedido-email-novo";
  const { contexto, pagina } = await contextoNovo({ largura, ligada: true, nome, rascunho: { dominio: "jalimpoexemplo.com.br", semDominio: false, semEmail: true, caixas: 1, observacao: "", empresa: "Empresa Nova", ofertas: null } });
  await chegarAoUltimoPasso(pagina);
  exigir((await pagina.locator("[data-oferta]").count()) === 2, `${nome}@${largura}: o e-mail novo deveria mostrar só 2 ofertas`);
  const conta = await textoDe(pagina, "[data-conta-do-pedido]");
  exigir(conta.indexOf("Migração") < 0, `${nome}@${largura}: o e-mail novo não cobra migração`);
  const hoje = reaisNaTela(await textoDe(pagina, "[data-total-hoje] span:last-child"));
  exigir(Math.abs(hoje - (39.9 + 14.9)) < 0.01, `${nome}@${largura}: total de hoje errado (${hoje})`);
  await semTransbordo(pagina, nome, largura);
  await pagina.screenshot({ path: resolve(saida, `${nome}-${largura}.png`), fullPage: true });
  feitos.push(`${nome}@${largura}`);
  await contexto.close();
}

for (const largura of [390, 1440]) {
  await pedidoPago(largura);
  await pedidoSemCobranca(largura);
  await emailNovo(largura);
}
await browser.close();
console.log(`Feitos: ${feitos.join(", ")}`);
if (erros.length) {
  console.error(`\n${erros.length} problema(s):\n- ${erros.join("\n- ")}`);
  process.exit(1);
}
console.log("Tudo certo.");
