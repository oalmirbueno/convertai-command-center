/** Interface real, dados sintéticos só no navegador isolado. Nenhuma conexão de produção. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pdfMembrosTeste } from "./pdf-membros-teste.mjs";
const origin = "http://127.0.0.1:4178";
const output = resolve("outputs/membros-visual");
await mkdir(output, { recursive: true });
const produtos = Array.from({ length: 6 }, (_, i) => ({
  id: `produto-teste-${i}`,
  titulo: [
    "Guia de marca · teste",
    "Kit de planejamento · teste",
    "Aulas de conteúdo · teste",
    "Templates de criação · teste",
    "Guia gratuito · teste",
    "Material adicional · teste",
  ][i],
  descricao:
    "Conteúdo sintético apenas para validar a interface local. Nenhum produto ou acesso foi cadastrado em produção.",
  categoria: i % 2 ? "Kits" : "Guias",
  formato: i === 2 ? "Aulas" : "Guia e arquivos",
  capa_url: i === 0 ? "https://example.invalid/capa" : null,
  estado: "publicado",
  gratuito: i === 4,
  destaque: i === 0,
  checkout_url: i === 5 ? "https://example.invalid/checkout" : null,
  condicoes: "Condições sintéticas de teste",
  ordem: i,
  origens:
    i === 4 ? ["gratuito"] : i < 3 ? ["compra"] : i === 3 ? ["plano"] : [],
  progresso: i === 0 ? 35 : 0,
  comunidade_ativa: i === 0,
  ultimo_material: i === 0 ? "material-teste" : null,
}));
const material = {
  id: "material-teste",
  produto_id: produtos[0].id,
  titulo: "Guia de leitura · teste",
  tipo: "texto",
  texto:
    "## Comece pelo contexto\n\nEste é um material sintético de teste para validar leitura, teclado, conclusão e navegação.\n\n- Objetivo claro\n- Materiais organizados\n- Próximo passo definido",
  arquivo: null,
  permite_download: false,
  ordem: 0,
};
const api = `export const carregarCatalogo=async(_previa,teste)=>({...window.__membrosTeste.catalogo,produtos:window.__membrosTeste.catalogo.produtos.map(p=>({...p,origens:teste?.bloqueado?[]:p.origens})),pessoa:{id:'pessoa-teste',nome:'Pessoa de teste'},jornada:{materiais:6,concluidos:2,produtos_concluidos:1,em_andamento:1}});
export const carregarMateriais=async()=>({materiais:window.__membrosTeste.materiais||[window.__membrosTeste.material],modulos:[],progresso:[]});
export const gravarProgresso=async(...args)=>{window.__membrosTeste.progresso=args;};
export const abrirArquivo=async()=>({url:location.origin+'/teste-guia.pdf',expira_em:'2026-10-20'});
export const mensagemDoErro=()=> 'Falha controlada no ambiente de teste';
export const carregarAdmin=async()=>structuredClone(window.__membrosTeste.admin);
export const salvarLinha=async(tabela,dados)=>{window.__membrosTeste.gravacao={tabela,dados};if(tabela==='membros_checklist'){window.__membrosTeste.admin.checklist=[{...dados,atualizado_em:new Date().toISOString(),atualizado_por:'pessoa-teste'}];}};
export const reprocessarEvento=async()=>{};
export const reiniciarTeste=async()=>{window.__membrosTeste.reiniciou=true;};
export const enviarMaterial=async()=>'';`;
const auth = `export function AuthProvider({children}){return children;}
export function useAuth(){return {user:{id:'pessoa-teste',email_confirmed_at:'2026-10-01'},profile:{id:'pessoa-teste',role:window.__membrosTeste.papel,full_name:'Pessoa de teste'},loading:false,profileError:false,logout:async()=>{},retryProfile:async()=>{}};}`;
const erros = [];
const resultados = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const largura of [360, 390, 768, 1280, 1440]) {
    const context = await browser.newContext({
      viewport: { width: largura, height: 900 },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript(
      ({ produtos, material }) => {
        window.__membrosTeste = {
          papel: localStorage.getItem("membros:papel-teste") || "member",
          catalogo: { produtos, pendentes: [] },
          material,
          admin: {
            produtos,
            materiais: [material],
            modulos: [],
            funil: [],
            acessos: [],
            beneficios: [],
            vinculos: [],
            checklist: [],
            historico: [],
            processamentos: [],
            planos: [],
            integracoes: [],
            pessoas: [
              {
                id: "pessoa-teste",
                full_name: "Pessoa de teste",
                email: "pessoa@example.invalid",
              },
            ],
          },
        };
      },
      { produtos, material },
    );
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin)
        if (url.pathname === "/capa")
          return route.fulfill({
            status: 200,
            contentType: "image/webp",
            path: resolve("public/membros/capas/boas-vindas-v2.webp"),
          });
        else
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "[]",
          });
      if (url.pathname === "/teste-guia.pdf")
        return route.fulfill({
          contentType: "application/pdf",
          body: pdfMembrosTeste(),
        });
      if (url.pathname === "/src/contexts/AuthContext.tsx")
        return route.fulfill({
          contentType: "application/javascript",
          body: auth,
        });
      if (url.pathname === "/src/lib/membros/aprendizado.ts")
        return route.fulfill({
          contentType: "application/javascript",
          body: `export const carregarLista=async()=>[];export const favoritar=async()=>{};export const carregarFunil=async()=>[];export const carregarComunidade=async()=>[];export const salvarConversa=async()=>{};export const carregarPessoas=async()=>({pessoas:[],total:0,resumo:{pessoas:0,compradores:0,liberados:0,encerrados:0,pendentes:0}});export const carregarPessoa=async()=>({});export const liberarPessoas=async()=>{};export const revogarManual=async()=>{};export const salvarNome=async()=>{};export const ordenar=async()=>{};`,
        });
      if (url.pathname === "/src/lib/membros/canais.ts")
        return route.fulfill({
          contentType: "application/javascript",
          body: `export const carregarCanais=async()=>[{id:'grupo-teste',nome:'WhatsApp · grupo de teste',url:'https://example.invalid/grupo',ativo:true,tipo:'whatsapp'}];export const salvarCanal=async()=>{};`,
        });
      if (url.pathname === "/src/lib/membros/capas.ts")
        return route.fulfill({
          contentType: "application/javascript",
          body: `export const enviarCapa=async()=>location.origin+'/membros/capas/boas-vindas-v2.webp';`,
        });
      if (url.pathname === "/src/lib/membros/editorial.ts")
        return route.fulfill({
          contentType: "application/javascript",
          body: `export const lerVersoes=async()=>[];export const versionarConteudo=async()=>'';export const arquivoDaVersao=async()=>location.origin+'/teste-guia.pdf';`,
        });
      if (url.pathname === "/src/lib/membros/ferramentas.ts")
        return route.fulfill({
          contentType: "application/javascript",
          body: `
        const crm={contatos:[{id:'contato-teste',nome:'Contato sintético',empresa:'Empresa de teste',email:'',telefone:'',notas:'',arquivado:false,versao:1}],negocios:[{id:'negocio-teste',titulo:'Proposta de teste',contato_id:'contato-teste',estagio:'proposta',valor:125,proxima_acao:'Conferir escopo do orçamento',proxima_data:'2026-10-21',notas:'',arquivado:false,versao:1}]};
        crm.negocios.push(...Array.from({length:16},(_,i)=>({...crm.negocios[0],id:'volume-teste-'+i,titulo:'Oportunidade sintética '+(i+1)})));
        export const listarFerramentas=async()=>[{produto_id:'produto-teste-0',titulo:'CRM de teste',motor:'crm',fim:'2027-10-20T12:00:00Z'}];
        export const obterProvaCompartilhada=async()=> 'prova-sintetica';export const abrirSessaoFerramenta=async()=>({conflito:false,licenca_fim:'2027-10-20T12:00:00Z'});
        export const operarCrm=async()=>structuredClone(crm);export const carregarAdminFerramentas=async()=>({...crm,ferramentas:[],licencas:[],exclusoes:[]});
        export const prepararUpgradeMensal=async()=>{};export const configurarFerramenta=async()=>{};export const licenciarTeste=async()=>'';export const revogarLicenca=async()=>{};export const atenderExclusaoCrm=async()=>({});export const pedirExclusaoCrm=async()=>{};export const proximaResposta=async()=>({});`,
        });
      if (url.pathname === "/src/lib/membros/api.ts")
        return route.fulfill({
          contentType: "application/javascript",
          body: api,
        });
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    page.on("pageerror", (e) => {
      erros.push(e.message);
      console.error("Erro de interface local:", e.message);
    });
    await page.goto(`${origin}/membros`, {
      waitUntil: "domcontentloaded",
      timeout: 180000,
    });
    await page
      .getByRole("button", { name: "Continuar na biblioteca" })
      .waitFor();
    await page.evaluate(() => {
      const b = document.createElement("p");
      b.textContent = "AMBIENTE LOCAL · DADOS SINTÉTICOS DE TESTE";
      b.style.cssText =
        "padding:8px 16px;font-size:12px;text-align:center;background:#202020;color:white";
      document.body.prepend(b);
    });
    const checar = async (etapa) => {
      const tamanho = await page.evaluate(() => ({
        largura: innerWidth,
        conteudo: document.documentElement.scrollWidth,
      }));
      if (tamanho.conteudo > tamanho.largura + 1)
        throw Error(
          `Transbordamento ${largura}px ${etapa}: ${JSON.stringify(tamanho)}`,
        );
      resultados.push({ largura, etapa, sem_transbordamento: true });
      console.log(JSON.stringify({ largura, etapa }));
    };
    const tituloAlinhado = async (nome) => {
      const titulo = page
        .locator(".membros-titulo")
        .getByRole("heading", { name: nome, exact: true });
      await titulo.waitFor();
      const medidas = await titulo.evaluate((h) => {
        const bloco = h.closest(".membros-titulo") || h.parentElement;
        const ajuda = bloco.querySelector("[data-ajuda-recolhida]");
        const t = h.getBoundingClientRect(),
          a = ajuda?.getBoundingClientRect();
        const principal = h.closest(".membros-conteudo");
        return {
          ajuda: !!a,
          diferenca: a
            ? Math.abs(t.top + t.height / 2 - a.top - a.height / 2)
            : Infinity,
          deslocamento: principal
            ? principal.getBoundingClientRect().top -
              principal.parentElement.getBoundingClientRect().top
            : 0,
        };
      });
      if (
        !medidas.ajuda ||
        medidas.diferenca > 4 ||
        (largura >= 768 && medidas.deslocamento > 2)
      )
        throw Error(
          `Título desalinhado: ${nome}, ${largura}px, ${JSON.stringify(medidas)}`,
        );
    };
    await checar("biblioteca");
    await page.screenshot({
      path: resolve(output, `biblioteca-${largura}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Continuar na biblioteca" }).click();
    await page.getByRole("button", { name: "Marcar como concluído" }).waitFor();
    await checar("leitor");
    if ([390, 1440].includes(largura))
      await page.screenshot({
        path: resolve(output, `leitor-${largura}.png`),
        fullPage: false,
      });
    await page.getByRole("button", { name: "Marcar como concluído" }).click();
    await page.getByRole("button", { name: /Concluído · desfazer/ }).waitFor();
    const gravou = await page.evaluate(
      () => window.__membrosTeste.progresso?.[3],
    );
    if (gravou !== true) throw Error("Conclusão não enviada pela interface");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "Minha lista", exact: true })
      .click();
    await page.getByRole("button", { name: "Explorar biblioteca" }).waitFor();
    await tituloAlinhado("Minha lista");
    await checar("minha-lista-alinhada");
    if ([390, 1440].includes(largura))
      await page.screenshot({
        path: resolve(output, `minha-lista-${largura}.png`),
      });
    await page.getByRole("button", { name: "Comunidade", exact: true }).click();
    await page
      .getByRole("link", { name: "WhatsApp · grupo de teste" })
      .waitFor();
    const comunidadeLargura = await page
      .locator(".membros-comunidade")
      .evaluate((el) => ({
        largura: el.getBoundingClientRect().width,
        pai: el.parentElement.getBoundingClientRect().width,
      }));
    if (comunidadeLargura.largura < comunidadeLargura.pai - 4)
      throw Error("Comunidade não ocupa a largura disponível");
    await checar("comunidade");
    await tituloAlinhado("Comunidade");
    await page.screenshot({
      path: resolve(output, `comunidade-${largura}.png`),
    });
    await page
      .getByRole("button", { name: "Ferramentas", exact: true })
      .click();
    await tituloAlinhado("Ferramentas");
    await page
      .getByRole("button", { name: "Abrir ferramenta", exact: true })
      .click();
    await page.getByRole("button", { name: /Proposta de teste/ }).waitFor();
    await checar("crm");
    if (largura >= 768) {
      const coluna = page
        .locator(".membros-crm-coluna")
        .filter({
          has: page.getByRole("heading", { name: "Proposta", exact: true }),
        })
        .locator(".membros-crm-coluna-rolagem");
      const antes = await page.evaluate(() => window.scrollY);
      const scroll = await coluna.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        return {
          top: el.scrollTop,
          altura: el.clientHeight,
          conteudo: el.scrollHeight,
        };
      });
      if (scroll.top <= 0 || scroll.conteudo <= scroll.altura)
        throw Error("A coluna do CRM não tem rolagem própria");
      if ((await page.evaluate(() => window.scrollY)) !== antes)
        throw Error("Rolar a coluna moveu a página");
      await coluna.evaluate((el) => {
        el.scrollTop = 0;
      });
      await checar("crm-rolagem-propria");
    }
    await page.screenshot({ path: resolve(output, `crm-${largura}.png`) });
    await page.getByRole("button", { name: "Início", exact: true }).click();
    if ([390, 1440].includes(largura)) {
      await page.evaluate(() => {
        window.__membrosTeste.materiais = [
          {
            ...window.__membrosTeste.material,
            id: "pdf-teste",
            titulo: "PDF local para leitura",
            tipo: "arquivo",
            texto: "Guia complementar",
            arquivo: "privado/guia.pdf",
            permite_download: true,
          },
        ];
      });
      await page
        .getByRole("button", { name: "Continuar na biblioteca" })
        .click();
      const canvas = page.locator(".membros-pdf canvas");
      await canvas.waitFor();
      await page.waitForFunction(
        () => {
          const c = document.querySelector(".membros-pdf canvas");
          return c?.width > 200 && c?.height > 200;
        },
        {},
        { timeout: 120000 },
      );
      await page
        .getByText("Ler o texto desta página", { exact: true })
        .waitFor();
      if (await page.locator(".membros-pdf iframe").count())
        throw Error("PDF depende de iframe");
      await page
        .getByRole("button", { name: "Ampliar PDF", exact: true })
        .click();
      await page.getByRole("button", { name: "Ajustar PDF à largura" }).click();
      await page
        .getByRole("button", { name: "Próxima página", exact: true })
        .click();
      if (
        (await page
          .getByRole("spinbutton", { name: "Número da página" })
          .inputValue()) !== "2"
      )
        throw Error("PDF não avançou para página 2");
      await page
        .getByRole("button", { name: "Página anterior", exact: true })
        .click();
      if (
        (await page
          .getByRole("spinbutton", { name: "Número da página" })
          .inputValue()) !== "1"
      )
        throw Error("PDF não voltou para página 1");
      await checar("pdf-navegacao");
      await page
        .getByRole("button", { name: "Abrir PDF em tela cheia" })
        .click();
      await page
        .getByRole("button", { name: "Sair da tela cheia do PDF" })
        .waitFor();
      await page.waitForFunction(() => {
        const c = document.querySelector(".membros-pdf-tela-cheia canvas");
        if (
          !(c instanceof HTMLCanvasElement) ||
          (c.width === 300 && c.height === 150)
        )
          return false;
        return c.getContext("2d").getImageData(0, 0, 1, 1).data[3] === 255;
      });
      // Observe the final geometry after the dialog's opening animation.
      await page.waitForFunction((largura) => {
        const r = document
          .querySelector(".membros-pdf-tela-cheia")
          ?.getBoundingClientRect();
        return r && r.width >= largura - 2 && r.height >= 898;
      }, largura);
      await checar("pdf-tela-cheia");
      const pdfTela = await page
        .locator(".membros-pdf-tela-cheia")
        .evaluate((el) => ({
          w: el.getBoundingClientRect().width,
          h: el.getBoundingClientRect().height,
        }));
      if (pdfTela.w < largura - 2 || pdfTela.h < 898)
        throw Error("PDF não ocupa a tela inteira");
      await page.screenshot({
        path: resolve(output, `pdf-tela-cheia-${largura}.png`),
      });
      await page
        .getByRole("button", { name: "Sair da tela cheia do PDF" })
        .click();
      await page.getByRole("button", { name: "Entrar no modo foco" }).click();
      const foco = await page.getByRole("dialog").evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      }));
      if (foco.width < largura - 2 || foco.height < 898)
        throw Error("Modo foco não ocupa a tela: " + JSON.stringify(foco));
      await checar("pdf-e-foco");
      await page.screenshot({
        path: resolve(output, `pdf-foco-${largura}.png`),
      });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Entrar no modo foco" }).waitFor();
      await page.getByRole("button", { name: "Abrir Pomodoro" }).last().click();
      await page.getByRole("button", { name: "Começar", exact: true }).click();
      await page.getByRole("timer").waitFor();
      await checar("pomodoro");
      await page
        .getByRole("button", { name: "Minimizar", exact: true })
        .click();
      await page
        .getByRole("complementary", { name: "Pomodoro compacto" })
        .waitFor();
      await checar("pomodoro-compacto");
      await page.screenshot({
        path: resolve(output, `pomodoro-compacto-${largura}.png`),
      });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.evaluate(() => {
        delete window.__membrosTeste.materiais;
      });
    }
    await page.getByPlaceholder("Buscar na biblioteca").fill("sem resultado");
    await page
      .getByRole("heading", { name: "Nenhum produto encontrado" })
      .waitFor();
    await page.getByRole("button", { name: "Limpar busca" }).click();
    if (largura === 390) {
      await page.goto(`${origin}/projetos`, { waitUntil: "networkidle" });
      await page
        .getByRole("button", { name: "Continuar na biblioteca" })
        .waitFor();
      if (!page.url().includes("/membros"))
        throw Error("Membro entrou no operacional pela URL");
      await page.goto(`${origin}/membros/administrar`, {
        waitUntil: "networkidle",
      });
      await page
        .getByRole("button", { name: "Continuar na biblioteca" })
        .waitFor();
      if (page.url().includes("/administrar"))
        throw Error("Membro abriu administração pela URL");
    }
    await page.evaluate(() => {
      localStorage.setItem("membros:papel-teste", "admin");
    });
    await page.goto(`${origin}/membros/administrar`, {
      waitUntil: "networkidle",
    });
    await checar("administrador");
    if ([390, 1440].includes(largura))
      await page.screenshot({
        path: resolve(output, `administrador-${largura}.png`),
        fullPage: false,
      });
    await page
      .getByRole("button", { name: "Esteira de produtos", exact: true })
      .click();
    await tituloAlinhado("Esteira de produtos");
    const funil = await page
      .locator(".membros-editor-funil")
      .evaluate((el) => ({
        vazio: !el.querySelector("nav"),
        recuo:
          el.querySelector("form").getBoundingClientRect().left -
          el.getBoundingClientRect().left,
      }));
    if (!funil.vazio || funil.recuo > 2)
      throw Error(`Coluna vazia na esteira: ${JSON.stringify(funil)}`);
    const origem = page.getByLabel("Quem tem acesso a", { exact: true });
    const destino = page.getByLabel("Conhecerá este próximo produto", {
      exact: true,
    });
    await origem.selectOption(produtos[0].id);
    await destino.selectOption(produtos[1].id);
    if (
      !(await page
        .getByRole("button", { name: "Salvar etapa da esteira" })
        .isEnabled())
    )
      throw Error("Etapa válida não pode ser salva");
    await origem.selectOption(produtos[1].id);
    if (await destino.inputValue())
      throw Error(
        "Destino não foi limpo após escolher o mesmo produto de origem",
      );
    await page.getByRole("button", { name: "Nova etapa", exact: true }).click();
    if ((await origem.inputValue()) || (await destino.inputValue()))
      throw Error("Nova etapa não limpa o formulário");
    await checar("esteira-sem-coluna-vazia");
    if ([390, 1440].includes(largura))
      await page.screenshot({
        path: resolve(output, `esteira-${largura}.png`),
      });
    await page.getByRole("button", { name: /Pessoas e acessos/ }).click();
    await tituloAlinhado("Pessoas, compras e acessos");
    await checar("pessoas-alinhadas");
    await page.getByRole("button", { name: "Pagamentos", exact: true }).click();
    await tituloAlinhado("Pagamentos");
    await page
      .getByRole("status")
      .filter({ hasText: "Liberação automática por Kiwify e Asaas desligada." })
      .waitFor();
    await checar("pagamentos-alinhados");
    await page
      .getByRole("button", { name: "Visão do cliente", exact: true })
      .click();
    await tituloAlinhado("Experimente a biblioteca inteira");
    await tituloAlinhado("Ver como cliente");
    await page.getByLabel("Cliente ou membro").selectOption("pessoa-teste");
    await page.getByRole("link", { name: "Abrir visão do cliente" }).click();
    await page.getByText("Visão de Pessoa de teste", { exact: true }).waitFor();
    await checar("visao-cliente");
    await page.getByRole("button", { name: "Continuar na biblioteca" }).click();
    if (
      await page
        .getByRole("button", { name: "Marcar como concluído" })
        .isEnabled()
    )
      throw Error("Prévia permite mudar progresso");
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Sair da visão do cliente" }).click();
    await page
      .getByRole("link", { name: "Testar como cliente", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Simular bloqueio" }).click();
    await page.getByRole("button", { name: "Conhecer produto" }).waitFor();
    await checar("teste-bloqueado");
    if (
      await page.getByRole("link", { name: "Administrar biblioteca" }).count()
    )
      throw Error("Admin aparece no teste");
    await page
      .getByRole("button", { name: "Voltar ao acesso liberado" })
      .click();
    await page.getByText("Reiniciar teste", { exact: true }).click();
    await page
      .getByRole("button", { name: "Reiniciar progresso do teste" })
      .click();
    await page.getByText("Progresso do teste reiniciado.").waitFor();
    await page.getByRole("link", { name: "Sair do teste" }).click();
    await page.getByRole("button", { name: "Preparar lançamento" }).click();
    if (largura < 768)
      await page
        .getByRole("button", { name: "Guia do item", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Salvar verificação manual" })
      .waitFor();
    await checar("checklist");
    if ([390, 1440].includes(largura))
      await page.screenshot({
        path: resolve(output, `checklist-${largura}.png`),
        fullPage: false,
      });
    await page
      .getByRole("combobox", { name: "Estado" })
      .selectOption("em_andamento");
    await page
      .getByRole("textbox", { name: "Observação" })
      .fill("Evidência de teste local");
    await page
      .getByRole("button", { name: "Salvar verificação manual" })
      .click();
    await page.getByText(/Atualizado por Pessoa de teste/).waitFor();
    const salvou = await page.evaluate(
      () => window.__membrosTeste.gravacao?.dados.estado,
    );
    if (salvou !== "em_andamento") throw Error("Checklist não enviou gravação");
    await context.close();
  }
  if (erros.length) throw Error(`Erros da página: ${erros.join("; ")}`);
  await writeFile(
    resolve(output, "resultado.json"),
    JSON.stringify(
      {
        ambiente:
          "local isolado; APIs da interface substituídas apenas no teste; RLS validado separadamente em PostgreSQL",
        resultados,
        erros,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      larguras: 5,
      estados: resultados.length,
      capturas: output,
    }),
  );
} finally {
  await browser.close();
}
