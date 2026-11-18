/**
 * Venda do E-mail profissional (/email) e o pedido (/email/pedir) num navegador
 * isolado, com servidor simulado. Nenhuma conexão de produção: todo pedido ao
 * servidor é respondido aqui ou cortado, e nada cria cobrança.
 *
 *   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4181 --strictPort   (em outro terminal)
 *   node scripts/testar-email-venda.mjs
 *
 * Capturas em outputs/email-venda (390 e 1440 px, página inteira). Sai com erro
 * se a página transbordar para o lado, se o console acusar erro ou se o pedido
 * não chegar ao servidor simulado com o domínio e as caixas certos.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origem = process.env.EMAIL_ORIGEM || "http://127.0.0.1:4181";
const saida = resolve(process.env.EMAIL_SAIDA || "outputs/email-venda");
await mkdir(saida, { recursive: true });

const EU = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTA = "11111111-1111-4111-8111-111111111111";
const precos = { pagamentos_ativos: false, teste_dias: 7, tolerancia_dias: 5, email_migracao: 597, email_mensal: 39.9, email_caixas_no_mensal: 5, email_caixa_extra: 14.9 };
const estadoComConta = (parte = {}) => ({
  conta: { id: CONTA, nome: "Imobiliária Exemplo", estado: "teste", plano_id: "starter", usuarios_contratados: 2, crm_ativo: true, email_ativo: false, email_caixas_contratadas: 0, teste_ate: null, atrasada_desde: null, acesso_ate: null, visibilidade: "todos", aparencia: {}, perfil: {}, documento: null, email_cobranca: "financeiro@imobiliariaexemplo.com.br", telefone: null, ...(parte.conta || {}) },
  eu: { membro_id: "m1", papel: "admin", nome: "Priscila Souza", email: "priscila@imobiliariaexemplo.com.br", ...(parte.eu || {}) },
  plano: { id: "starter", nome: "Starter", preco_usuario: 49.9, limites: {}, email_caixas_incluidas: 0 },
  liberada: true, crm: true, email: false, dono_da_casa: false, pagamentos_ativos: false, tolerancia_dias: 5, teste_dias: 7, equipe: [], maquina_no_mes: 0, assinatura: null, convite: null,
});
const semConta = { conta: null, eu: null, plano: null, convite: null, dono_da_casa: false, pagamentos_ativos: false, teste_dias: 7 };

const auth = (logado) => `export function AuthProvider({children}){return children;}
export function useAuth(){return {user:${logado ? `{id:'${EU}',email:'priscila@imobiliariaexemplo.com.br',email_confirmed_at:'2026-10-01',user_metadata:{}}` : "null"},profile:${logado ? `{id:'${EU}',role:'member',full_name:'Priscila Souza'}` : "null"},loading:false,profileError:false,logout:async()=>{},retryProfile:async()=>{},loginWithCredentials:async()=>{},signup:async(...a)=>{window.__cadastro=a;}};}`;

const erros = [];
const feitos = [];
const browser = await chromium.launch({ headless: true });

/** Abre uma página com o servidor simulado. Devolve a página e o que o servidor recebeu. */
async function abrir({ nome, caminho, largura, logado = false, estado = semConta, comPrecos = true, movimento = false }) {
  const contexto = await browser.newContext({ viewport: { width: largura, height: largura < 500 ? 844 : 900 }, reducedMotion: movimento ? "no-preference" : "reduce", serviceWorkers: "block", colorScheme: "dark" });
  const pagina = await contexto.newPage();
  const recebido = { rpc: [], funcoes: [], outros: [] };
  let contaCriada = false;
  pagina.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR/.test(m.text())) erros.push(`${nome}@${largura}: ${m.text().slice(0, 240)}`);
  });
  pagina.on("pageerror", (e) => erros.push(`${nome}@${largura}: ${String(e.message).slice(0, 240)}`));
  await pagina.route("**/src/contexts/AuthContext.tsx*", (r) => r.fulfill({ contentType: "text/javascript", body: auth(logado) }));
  await pagina.route(/supabase\.co\/|\/rest\/v1\/|\/functions\/v1\/|\/auth\/v1\/|\/realtime\/v1\//, async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const json = (corpo, status = 200) => rota.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(corpo) });
    if (pedido.method() === "OPTIONS") return rota.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    let corpo = null;
    try {
      corpo = pedido.postDataJSON();
    } catch {
      corpo = null;
    }
    const rpc = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(url.pathname);
    if (rpc) {
      recebido.rpc.push({ nome: rpc[1], corpo });
      if (rpc[1] === "produto_precos") return comPrecos ? json(precos) : json({ message: "permission denied for function produto_precos", code: "42501" }, 401);
      if (rpc[1] === "produto_estado") return json(contaCriada ? estadoComConta({ conta: { nome: "Clínica Vida" } }) : estado);
      if (rpc[1] === "produto_criar_conta") {
        contaCriada = true;
        return json(CONTA);
      }
      return json(null);
    }
    if (/\/functions\/v1\/produto$/.test(url.pathname)) {
      recebido.funcoes.push(corpo);
      // Só a ação do pedido tem resposta. Qualquer outra (assinar, cobrar) é erro do teste.
      if (corpo && corpo.acao === "pedir_email") return json({ ok: true });
      erros.push(`${nome}@${largura}: a página chamou a ação ${corpo && corpo.acao}, que não é do pedido`);
      return json({ error: "acao_nao_esperada", mensagem: "Ação não esperada." }, 400);
    }
    if (/\/rest\/v1\//.test(url.pathname)) return json([]);
    recebido.outros.push(url.pathname);
    return rota.abort();
  });
  await pagina.goto(`${origem}${caminho}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  return { pagina, contexto, recebido };
}

async function fechar({ pagina, contexto }, nome, largura, { inteira = true } = {}) {
  // Rola a página inteira para a entrada por rolagem acontecer antes da captura.
  const altura = await pagina.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < altura; y += 500) {
    await pagina.evaluate((v) => window.scrollTo(0, v), y);
    await pagina.waitForTimeout(120);
  }
  await pagina.evaluate(() => window.scrollTo(0, 0));
  await pagina.waitForTimeout(900);
  const medida = await pagina.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth }));
  if (medida.doc > medida.janela + 1) erros.push(`${nome}@${largura}: a página transborda para o lado (${medida.doc} > ${medida.janela})`);
  await pagina.screenshot({ path: resolve(saida, `${nome}-${largura}.png`), fullPage: inteira });
  feitos.push(`${nome}@${largura}`);
  await contexto.close();
}

const conferir = (ok, frase) => {
  if (!ok) erros.push(frase);
};

try {
  for (const largura of [390, 1440]) {
    // 1. A página de venda, para o visitante, com os preços do banco.
    let a = await abrir({ nome: "01-venda", caminho: "/email", largura });
    await a.pagina.waitForSelector("[data-mensal-do-email]", { timeout: 60000 }).catch(() => erros.push(`01-venda@${largura}: o preço não apareceu`));
    conferir((await a.pagina.textContent("[data-mensal-do-email]").catch(() => "") || "").indexOf("39,90") >= 0, `01-venda@${largura}: a mensalidade não é a do banco`);
    // A calculadora: 8 caixas = 39,90 + 3 x 14,90 = 84,60, e o botão leva as 8 caixas.
    for (let i = 0; i < 3; i++) await a.pagina.click("[data-mais-caixa]");
    conferir((await a.pagina.textContent("[data-mensal-do-email]") || "").indexOf("84,60") >= 0, `01-venda@${largura}: 8 caixas não deram 84,60`);
    const destino = await a.pagina.getAttribute(".el-total [data-pedir-email-profissional]", "href");
    conferir(destino === "/email/pedir?caixas=8", `01-venda@${largura}: o botão leva a ${destino}`);
    await fechar(a, "01-venda", largura);

    // 1b. Com movimento ligado: o herói no primeiro quadro útil e a página rolada.
    a = await abrir({ nome: "01b-venda-com-movimento", caminho: "/email", largura, movimento: true });
    await a.pagina.waitForSelector("[data-mensal-do-email]", { timeout: 60000 }).catch(() => {});
    await a.pagina.waitForTimeout(4200);
    await a.pagina.screenshot({ path: resolve(saida, `01c-heroi-${largura}.png`) });
    await fechar(a, "01b-venda-com-movimento", largura);

    // 2. Sem o grant (banco ainda sem a migration): a página abre sem inventar valor.
    a = await abrir({ nome: "02-venda-sem-precos", caminho: "/email", largura, comPrecos: false });
    await a.pagina.waitForSelector("[data-precos-indisponiveis]", { timeout: 60000 }).catch(() => erros.push(`02-venda-sem-precos@${largura}: faltou o aviso de valores`));
    conferir(!/R\$\s*\d/.test(await a.pagina.textContent("body")), `02-venda-sem-precos@${largura}: apareceu valor sem o banco responder`);
    await fechar(a, "02-venda-sem-precos", largura);

    // 3. Visitante: pedido, depois o acesso. O cadastro volta para /email/pedir.
    a = await abrir({ nome: "03-pedido-visitante", caminho: "/email/pedir?caixas=8", largura });
    await a.pagina.waitForSelector('[data-passo-do-pedido="pedido"]', { timeout: 60000 });
    conferir((await a.pagina.textContent("[data-caixas-do-pedido]")) === "8", `03@${largura}: as caixas da página de venda não chegaram ao pedido`);
    await a.pagina.fill('[data-campo="dominio"]', "fulano@gmail.com");
    await a.pagina.click("[data-continuar-pedido]");
    conferir(!!(await a.pagina.$("[data-erro-do-pedido]")), `03@${largura}: e-mail pessoal passou como domínio`);
    await a.pagina.fill('[data-campo="dominio"]', "https://www.ClinicaVida.com.br/");
    await a.pagina.fill('[data-campo="observacao"]', "Hoje está no provedor do site.");
    await a.pagina.screenshot({ path: resolve(saida, `03a-pedido-${largura}.png`), fullPage: true });
    await a.pagina.click("[data-continuar-pedido]");
    await a.pagina.waitForSelector('[data-passo-do-pedido="acesso"]');
    await a.pagina.fill('[data-campo="nome"]', "Helena Prado");
    await a.pagina.fill('[data-campo="empresa"]', "Clínica Vida");
    await a.pagina.fill('[data-campo="email"]', "helena@exemplo.com.br");
    await a.pagina.fill('[data-campo="senha"]', "SenhaDeTeste123");
    await a.pagina.check('[data-campo="aceito"]');
    await a.pagina.screenshot({ path: resolve(saida, `03b-acesso-${largura}.png`), fullPage: true });
    await a.pagina.click("[data-criar-acesso]");
    await a.pagina.waitForSelector("[data-confirmar-email]");
    const cadastro = await a.pagina.evaluate(() => window.__cadastro);
    conferir(Array.isArray(cadastro) && cadastro[0] === "helena@exemplo.com.br" && cadastro[3] === "Clínica Vida" && String(cadastro[5]).endsWith("/email/pedir"), `03@${largura}: o cadastro não levou e-mail, empresa e a volta para /email/pedir`);
    conferir(a.recebido.funcoes.length === 0, `03@${largura}: o pedido saiu antes de existir acesso`);
    await fechar(a, "03c-confirmar", largura);

    // 4. Logado e sem empresa (voltou do e-mail de confirmação): cria a empresa e pede.
    a = await abrir({ nome: "04-pedido-sem-empresa", caminho: "/email/pedir", largura, logado: true });
    await a.pagina.evaluate(() => localStorage.setItem("aceleriq:email:pedido", JSON.stringify({ dominio: "clinicavida.com.br", semDominio: false, caixas: 8, observacao: "Hoje está no provedor do site.", empresa: "Clínica Vida" })));
    await a.pagina.reload({ waitUntil: "domcontentloaded" });
    await a.pagina.waitForSelector('[data-passo-do-pedido="pedido"]', { timeout: 60000 });
    await a.pagina.click("[data-continuar-pedido]");
    await a.pagina.waitForSelector('[data-passo-do-pedido="enviar"]');
    await a.pagina.screenshot({ path: resolve(saida, `04a-enviar-${largura}.png`), fullPage: true });
    await a.pagina.click("[data-enviar-pedido]");
    await a.pagina.waitForSelector("[data-pedido-enviado]", { timeout: 15000 }).catch(() => erros.push(`04@${largura}: o pedido não chegou ao fim`));
    const criou = a.recebido.rpc.filter((x) => x.nome === "produto_criar_conta")[0];
    conferir(!!criou && criou.corpo._nome === "Clínica Vida" && criou.corpo._plano === "starter", `04@${largura}: a empresa não foi criada com o nome informado`);
    const pediu = a.recebido.funcoes[0];
    conferir(!!pediu && pediu.acao === "pedir_email" && pediu.dominio === "clinicavida.com.br" && pediu.caixas === 8 && /provedor do site/.test(pediu.observacao), `04@${largura}: o pedido não levou domínio, caixas e observação: ${JSON.stringify(pediu)}`);
    conferir(a.recebido.funcoes.length === 1, `04@${largura}: saíram ${a.recebido.funcoes.length} chamadas à função do produto (esperada 1)`);
    conferir((await a.pagina.evaluate(() => localStorage.getItem("aceleriq:email:pedido"))) === null, `04@${largura}: o rascunho ficou no aparelho depois do envio`);
    await fechar(a, "04b-enviado", largura);

    // 5. Quem já tem empresa e administra: entra e cai no pedido, sem criar empresa de novo.
    a = await abrir({ nome: "05-pedido-com-empresa", caminho: "/email/pedir?caixas=3", largura, logado: true, estado: estadoComConta() });
    await a.pagina.waitForSelector('[data-passo-do-pedido="pedido"]', { timeout: 60000 });
    await a.pagina.check('[data-campo="sem-dominio"]');
    await a.pagina.click("[data-continuar-pedido]");
    await a.pagina.waitForSelector("[data-resumo-do-pedido]");
    await a.pagina.click("[data-enviar-pedido]");
    await a.pagina.waitForSelector("[data-pedido-enviado]", { timeout: 15000 }).catch(() => erros.push(`05@${largura}: o pedido não chegou ao fim`));
    conferir(a.recebido.rpc.every((x) => x.nome !== "produto_criar_conta"), `05@${largura}: tentou criar empresa para quem já tem`);
    const p5 = a.recebido.funcoes[0];
    conferir(!!p5 && p5.dominio === "" && p5.caixas === 3 && /Ainda não tem domínio/.test(p5.observacao), `05@${largura}: pedido sem domínio saiu errado: ${JSON.stringify(p5)}`);
    await fechar(a, "05-enviado-com-empresa", largura);

    // 6. Usuário comum da empresa não pede; quem já tem o e-mail vai para o painel.
    a = await abrir({ nome: "06-usuario-comum", caminho: "/email/pedir", largura, logado: true, estado: estadoComConta({ eu: { papel: "usuario" } }) });
    await a.pagina.waitForSelector('[data-passo-do-pedido="pedido"]', { timeout: 60000 });
    await a.pagina.fill('[data-campo="dominio"]', "imobiliariaexemplo.com.br");
    await a.pagina.click("[data-continuar-pedido]");
    await a.pagina.waitForSelector("[data-pedido-so-do-admin]").catch(() => erros.push(`06@${largura}: usuário comum chegou ao envio`));
    await fechar(a, "06-usuario-comum", largura);
    a = await abrir({ nome: "07-ja-contratado", caminho: "/email/pedir", largura, logado: true, estado: estadoComConta({ conta: { email_ativo: true } }) });
    await a.pagina.waitForSelector('[data-passo-do-pedido="pedido"]', { timeout: 60000 });
    await a.pagina.fill('[data-campo="dominio"]', "imobiliariaexemplo.com.br");
    await a.pagina.click("[data-continuar-pedido]");
    await a.pagina.waitForSelector("[data-email-ja-contratado]").catch(() => erros.push(`07@${largura}: quem já tem e-mail chegou ao envio`));
    conferir(a.recebido.funcoes.length === 0, `07@${largura}: saiu pedido para quem já tem o e-mail`);
    await fechar(a, "07-ja-contratado", largura);
  }
} finally {
  await browser.close();
}
console.log(`${feitos.length} capturas em ${saida}`);
if (erros.length) {
  console.log(`\n${erros.length} problema(s):\n${erros.join("\n")}`);
  process.exit(1);
}
console.log("Sem transbordo, sem erro de console e com o pedido chegando ao servidor simulado.");
