/** Interface real, dados sintéticos só no navegador isolado. Nenhuma conexão de produção. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
export const carregarMateriais=async()=>({materiais:[window.__membrosTeste.material],progresso:[]});
export const gravarProgresso=async(...args)=>{window.__membrosTeste.progresso=args;};
export const abrirArquivo=async()=>{throw Error('Sem arquivo nesta fixture');};
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
      if (url.pathname === "/src/contexts/AuthContext.tsx")
        return route.fulfill({
          contentType: "application/javascript",
          body: auth,
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
    page.on("pageerror", (e) => erros.push(e.message));
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
      .getByRole("button", { name: "Visão do cliente", exact: true })
      .click();
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
