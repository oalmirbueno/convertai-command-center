/**
 * Página de venda do CRM (/crm) e caminho de compra, num navegador isolado.
 * Nenhuma conexão de produção: todo pedido ao servidor é respondido aqui ou cortado.
 * Nenhuma cobrança é criada: o "checkout" é uma página falsa servida por este script.
 *
 *   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4183 --strictPort   (em outro terminal)
 *   node scripts/testar-venda-visual.mjs
 *
 * O que confere:
 *   1. /crm em 390 e 1440 px, parada (menos movimento) e animada, com a cobrança
 *      desligada e ligada: sem transbordo para o lado e sem erro de console.
 *   2. Compra com a cobrança DESLIGADA: plano na página, cadastro curto, empresa
 *      criada em teste, sem pedir documento e sem chamar a assinatura.
 *   3. Compra com a cobrança LIGADA: pede CPF ou CNPJ, cria a empresa, chama a
 *      assinatura com o plano e os usuários escolhidos e vai para o checkout.
 *
 * Capturas em outputs/venda-visual.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origem = process.env.VENDA_ORIGEM || "http://127.0.0.1:4183";
const saida = resolve("outputs/venda-visual");
await mkdir(saida, { recursive: true });

const EU = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTA = "11111111-1111-4111-8111-111111111111";
const CHECKOUT = "https://checkout.asaas.invalid/c/simulado";
const dia = (d) => new Date(Date.now() + d * 86400000).toISOString();

const planos = [
  { id: "starter", nome: "Starter", resumo: "O CRM completo para organizar a venda.", preco_usuario: 49.9, minimo_usuarios: 1, recursos: ["Funil de vendas com arrastar e soltar", "Empresas, contatos e histórico", "Agenda e lembretes", "Metas do mês", "Máquina de leads: 5 buscas por mês"], limites: { maquina_buscas_mes: 5, maquina_google_maps: false, maquina_limite_por_busca: 50, privacidade_por_vendedor: false, campanhas: false }, email_caixas_incluidas: 0, destaque: false, ativo: true, ordem: 1 },
  { id: "pro", nome: "Pro", resumo: "Para a equipe que prospecta todo dia.", preco_usuario: 79.9, minimo_usuarios: 1, recursos: ["Tudo do Starter", "Máquina de leads: 30 buscas por mês, com Google Maps", "Campanhas e custo por cliente", "Cada vendedor vê só os próprios negócios", "E-mail profissional incluído na mensalidade"], limites: { maquina_buscas_mes: 30, maquina_google_maps: true, maquina_limite_por_busca: 150, privacidade_por_vendedor: true, campanhas: true }, email_caixas_incluidas: 5, destaque: true, ordem: 2, ativo: true },
];
const precos = (ligada) => ({ pagamentos_ativos: ligada, teste_dias: 7, tolerancia_dias: 5, email_migracao: 597, email_mensal: 39.9, email_caixas_no_mensal: 5, email_caixa_extra: 14.9 });
const estadoSemConta = (ligada) => ({ conta: null, convite: null, dono_da_casa: false, pagamentos_ativos: ligada, teste_dias: 7 });
const estadoComConta = (ligada, pedido) => ({
  conta: { id: CONTA, nome: pedido._nome, estado: "teste", plano_id: pedido._plano, usuarios_contratados: pedido._usuarios, crm_ativo: true, email_ativo: false, email_caixas_contratadas: 0, teste_ate: dia(7), atrasada_desde: null, acesso_ate: null, visibilidade: "todos", aparencia: {}, perfil: pedido._perfil || {}, documento: pedido._documento, email_cobranca: null, telefone: null },
  eu: { membro_id: "m1", papel: "admin", nome: "Pessoa de Teste", email: "teste@exemplo.com.br" },
  plano: { id: pedido._plano, nome: pedido._plano === "pro" ? "Pro" : "Starter", preco_usuario: pedido._plano === "pro" ? 79.9 : 49.9, limites: planos[pedido._plano === "pro" ? 1 : 0].limites, email_caixas_incluidas: 0 },
  liberada: true, crm: true, email: false, dono_da_casa: false, pagamentos_ativos: ligada, tolerancia_dias: 5, teste_dias: 7,
  equipe: [{ id: "m1", user_id: EU, nome: "Pessoa de Teste", email: "teste@exemplo.com.br", papel: "admin", estado: "ativo", entrou_em: dia(0) }], maquina_no_mes: 0,
  assinatura: { estado: "sem", valor_mensal: 0, proximo_vencimento: null, cartao_final: null, cartao_bandeira: null, itens: [], checkout_link: null },
});

// O login de mentira: ninguém logado até o cadastro; o cadastro guarda a pessoa nesta aba e abre o produto.
const auth = `const K='venda-teste-usuario';
export function AuthProvider({children}){return children;}
export function useAuth(){
  let u=null; try{u=JSON.parse(sessionStorage.getItem(K)||'null')}catch(e){}
  return {user:u?{id:'${EU}',email:u.email,email_confirmed_at:'2026-11-13',invited_at:null,user_metadata:{}}:null,
    profile:u?{id:'${EU}',role:'member',full_name:u.nome,company_name:u.empresa}:null,
    loading:false,profileError:false,logout:async()=>{},retryProfile:async()=>{},loginWithCredentials:async()=>{},
    signup:async(email,senha,nome,empresa)=>{sessionStorage.setItem(K,JSON.stringify({email,nome,empresa}));window.location.assign('/app');}};
}`;

const erros = [];
const feitos = [];
const browser = await chromium.launch({ headless: true });

async function contextoNovo({ largura, ligada, parado, nome }) {
  const contexto = await browser.newContext({ viewport: { width: largura, height: largura < 500 ? 844 : 900 }, reducedMotion: parado ? "reduce" : "no-preference", serviceWorkers: "block", colorScheme: "dark" });
  const pagina = await contexto.newPage();
  const chamadas = { criar: [], assinar: [] };
  let conta = null;
  pagina.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR/.test(m.text())) erros.push(`${nome}@${largura}: ${m.text().slice(0, 300)}`);
  });
  pagina.on("pageerror", (e) => erros.push(`${nome}@${largura}: ${String(e.message).slice(0, 300)}`));
  await pagina.route("**/src/contexts/AuthContext.tsx*", (r) => r.fulfill({ contentType: "text/javascript", body: auth }));
  await pagina.route(`${CHECKOUT}*`, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><title>Checkout simulado</title><body data-checkout-simulado style='font-family:sans-serif;padding:40px'><h1>Checkout simulado</h1><p>Nenhuma cobrança foi criada.</p></body>" }));
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
      if (rpc[1] === "produto_estado") return json(conta ? estadoComConta(ligada, conta) : estadoSemConta(ligada));
      if (rpc[1] === "produto_criar_conta") {
        conta = corpo();
        chamadas.criar.push(conta);
        return json(CONTA);
      }
      return json(null);
    }
    if (/\/functions\/v1\/produto$/.test(url.pathname)) {
      const c = corpo();
      if (c.acao === "assinar") {
        chamadas.assinar.push(c);
        return ligada ? json({ link: CHECKOUT, valor: 1 }) : json({ error: "pagamentos_desligados", mensagem: "A assinatura pelo cartão ainda não foi aberta." }, 409);
      }
      return json({ ok: true });
    }
    if (/\/functions\/v1\//.test(url.pathname)) return json({ ok: true });
    const tabela = /\/rest\/v1\/([a-z_]+)/.exec(url.pathname);
    if (tabela) {
      const linhas = tabela[1] === "produto_planos" ? planos : [];
      const um = (pedido.headers().accept || "").indexOf("vnd.pgrst.object") >= 0;
      return json(um ? linhas[0] || null : linhas);
    }
    if (/\/auth\/v1\/user/.test(url.pathname)) return json({ id: EU, email: "teste@exemplo.com.br" });
    return rota.abort();
  });
  return { contexto, pagina, chamadas };
}

const semTransbordo = async (pagina, nome, largura) => {
  const m = await pagina.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth }));
  if (m.doc > m.janela + 1) erros.push(`${nome}@${largura}: a página transborda para o lado (${m.doc} > ${m.janela})`);
};
const exigir = (certo, frase) => {
  if (!certo) erros.push(frase);
};

/** 1. A página, parada e animada. */
async function verPagina({ largura, ligada, parado }) {
  const nome = `venda-${ligada ? "cobranca-ligada" : "teste-gratis"}-${parado ? "parada" : "animada"}`;
  const { contexto, pagina } = await contextoNovo({ largura, ligada, parado, nome });
  await pagina.goto(`${origem}/crm`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await pagina.waitForSelector("[data-pagina-de-venda]", { timeout: 60000 });
  await pagina.waitForSelector("[data-planos-da-venda]", { timeout: 30000 });
  await pagina.waitForTimeout(parado ? 500 : 1800);
  await semTransbordo(pagina, nome, largura);
  await pagina.screenshot({ path: resolve(saida, `${nome}-topo-${largura}.png`) });
  if (!parado) {
    // Rola a página inteira para as entradas acontecerem, medindo o transbordo no caminho.
    const altura = await pagina.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < altura; y += 500) {
      await pagina.evaluate((v) => window.scrollTo(0, v), y);
      await pagina.waitForTimeout(180);
      await semTransbordo(pagina, `${nome} (rolagem ${y})`, largura);
    }
    await pagina.waitForTimeout(1900);
    const escondidos = await pagina.evaluate(() => Array.prototype.filter.call(document.querySelectorAll(".vd-rev"), (e) => !e.classList.contains("vd-on")).length);
    exigir(escondidos === 0, `${nome}@${largura}: ${escondidos} bloco(s) não apareceram ao rolar`);
    await pagina.evaluate(() => window.scrollTo(0, 0));
    await pagina.waitForTimeout(300);
  }
  const cobranca = await pagina.getAttribute("[data-pagina-de-venda]", "data-cobranca");
  exigir(cobranca === (ligada ? "ligada" : "desligada"), `${nome}@${largura}: a página não percebeu a cobrança ${ligada ? "ligada" : "desligada"}`);
  const botao = (await pagina.textContent('[data-comprar="pro"]')) || "";
  exigir(ligada ? /Assinar o Pro/.test(botao) : /Testar o Pro por 7 dias/.test(botao), `${nome}@${largura}: botão do plano com texto errado (${botao})`);
  await pagina.screenshot({ path: resolve(saida, `${nome}-inteira-${largura}.png`), fullPage: true });
  feitos.push(`${nome}@${largura}`);
  await contexto.close();
}

/** 2 e 3. Da página de venda até o teste ou o checkout. */
async function comprar({ largura, ligada }) {
  const nome = ligada ? "compra-com-checkout" : "compra-em-teste";
  const { contexto, pagina, chamadas } = await contextoNovo({ largura, ligada, parado: true, nome });
  await pagina.goto(`${origem}/crm?utm_source=meta&utm_campaign=crm`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await pagina.waitForSelector("[data-planos-da-venda]", { timeout: 60000 });
  await pagina.click('[data-seletor-de-usuarios] button[aria-label="Mais um usuário"]');
  await pagina.click('[data-comprar="pro"]');
  await pagina.waitForSelector("[data-onboarding-do-produto]", { timeout: 60000 });
  exigir(/\/crm\/comecar\?plano=pro&usuarios=4&utm_source=meta&utm_campaign=crm$/.test(pagina.url()), `${nome}@${largura}: endereço do cadastro errado (${pagina.url()})`);
  exigir(((await pagina.textContent("[data-onboarding-do-produto]")) || "").indexOf("1 de 3") >= 0, `${nome}@${largura}: o caminho direto deveria ter 3 passos`);
  await pagina.click('[data-opcao="imobiliaria"]');
  await pagina.waitForSelector('[data-passo-do-onboarding="empresa"]');
  await pagina.fill('input[autocomplete="organization"]', "Imobiliária de Teste");
  const temDocumento = (await pagina.locator("[data-documento]").count()) > 0;
  exigir(temDocumento === ligada, `${nome}@${largura}: o campo de CPF/CNPJ ${ligada ? "deveria" : "não deveria"} aparecer`);
  if (ligada) {
    await pagina.fill("[data-documento]", "11222333000182");
    exigir(await pagina.isDisabled("[data-avancar]"), `${nome}@${largura}: documento errado não deveria deixar avançar`);
    await pagina.fill("[data-documento]", "11222333000181");
  }
  await semTransbordo(pagina, `${nome} (empresa)`, largura);
  await pagina.screenshot({ path: resolve(saida, `${nome}-1-empresa-${largura}.png`) });
  await pagina.click("[data-avancar]");
  await pagina.waitForSelector('[data-passo-do-onboarding="acesso"]');
  await pagina.fill('input[autocomplete="name"]', "Pessoa de Teste");
  await pagina.fill('input[type="email"]', "teste@exemplo.com.br");
  await pagina.fill('input[autocomplete="new-password"]', `teste-${Math.random().toString(36).slice(2)}-A1`);
  await pagina.check('input[type="checkbox"]');
  await pagina.screenshot({ path: resolve(saida, `${nome}-2-acesso-${largura}.png`) });
  await pagina.click("[data-criar-acesso]");
  if (ligada) {
    await pagina.waitForSelector("[data-checkout-simulado]", { timeout: 60000 });
    exigir(chamadas.assinar.length === 1 && chamadas.assinar[0].plano_id === "pro" && chamadas.assinar[0].usuarios === 4, `${nome}@${largura}: a assinatura não foi pedida com Pro e 4 usuários (${JSON.stringify(chamadas.assinar)})`);
    exigir(chamadas.criar.length === 1 && chamadas.criar[0]._documento === "11222333000181", `${nome}@${largura}: a empresa deveria nascer com o CNPJ (${JSON.stringify(chamadas.criar)})`);
  } else {
    await pagina.waitForURL(/\/app/, { timeout: 60000 });
    await pagina.getByText("7 dias de teste, sem cartão").first().waitFor({ timeout: 60000 });
    exigir(chamadas.assinar.length === 0, `${nome}@${largura}: com a cobrança desligada ninguém pode chamar a assinatura`);
    exigir(chamadas.criar.length === 1 && chamadas.criar[0]._documento === null, `${nome}@${largura}: a empresa de teste nasce sem documento (${JSON.stringify(chamadas.criar)})`);
    await pagina.waitForTimeout(800);
  }
  const criada = chamadas.criar[0] || {};
  exigir(criada._plano === "pro" && criada._usuarios === 4 && criada._nome === "Imobiliária de Teste", `${nome}@${largura}: a empresa não foi criada com a escolha da página (${JSON.stringify(criada)})`);
  exigir(criada._perfil && criada._perfil.nicho === "imobiliaria", `${nome}@${largura}: o ramo não chegou na empresa`);
  await pagina.screenshot({ path: resolve(saida, `${nome}-3-fim-${largura}.png`) });
  feitos.push(`${nome}@${largura}`);
  await contexto.close();
}

try {
  const so = process.argv[2] || "";
  for (const largura of [390, 1440]) {
    if (!so || so === "pagina") {
      await verPagina({ largura, ligada: false, parado: true });
      await verPagina({ largura, ligada: false, parado: false });
      await verPagina({ largura, ligada: true, parado: true });
    }
    if (!so || so === "compra") {
      await comprar({ largura, ligada: false });
      await comprar({ largura, ligada: true });
    }
  }
} finally {
  await browser.close();
}
console.log(`${feitos.length} passagens: ${feitos.join(", ")}\nCapturas em ${saida}`);
if (erros.length) {
  console.log(`\n${erros.length} problema(s):\n${erros.join("\n")}`);
  process.exit(1);
}
console.log("Sem transbordo, sem erro de console e com o caminho de compra inteiro.");
