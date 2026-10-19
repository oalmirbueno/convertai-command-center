import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vercelFalsa } from "./vercel-falsa";
import { apelidoDaPrevia, compararComPublicado, conferirVersaoPedida, INSTRUCAO_DA_PREVIA_NA_NUVEM, lerPublicado, linhasDaComparacao, nomeNaVercel, paginasDoMapa, paginasDosArquivos, previaDoCommit, previasNaNuvem } from "../../supabase/functions/mesa-site/modulos/publicacao-nuvem";
import { criarApiDaVercel, ErroDaVercel } from "../../supabase/functions/mesa-site/modulos/publicacao-vercel";
import { arquivosDoDist, previaNaVercel, producaoNaVercel } from "../../workers/motor-codigo/lib/vercel";
import { type ContextoDaPublicacao, rotasDaPublicacao, SEM_CHAVE_NO_SERVIDOR } from "../../supabase/functions/mesa-site/publicacao";
import { mapaPadrao } from "../../supabase/functions/_shared/site-biblioteca";
import type { TrabalhoDoMotor } from "../../supabase/functions/_shared/motor-codigo";

/**
 * Vercel da agência (20/10/2026): prévia na nuvem por versão, publicar só a
 * versão salva com a comparação do que entra, muda e sai do ar, tirar do ar e
 * domínio próprio com o DNS pendente e verificado. Tudo com a API da Vercel
 * falsa: nenhuma chamada de verdade, e o token nunca aparece em resposta,
 * erro, evento ou log.
 */

const TOKEN = "vcp_tokenfalsodaagencia_0123456789abcdef";
const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const esperar = async () => undefined;

const raiz = mkdtempSync(join(tmpdir(), "vercel-agencia-"));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

function distDeDuasPaginas(nome: string, extra: Record<string, string> = {}) {
  const pasta = join(raiz, nome);
  const arquivos: Record<string, string> = { "index.html": "<h1>Início</h1>", "obrigado/index.html": "<h1>Obrigado</h1>", "assets/app-1.js": "console.log(1)", ...extra };
  for (const [c, v] of Object.entries(arquivos)) {
    mkdirSync(join(pasta, "dist", c, ".."), { recursive: true });
    writeFileSync(join(pasta, "dist", c), v);
  }
  return pasta;
}

// Todo log da execução (o token não pode aparecer em nenhum).
const logs: string[] = [];
beforeEach(() => {
  logs.length = 0;
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("regras puras da prévia na nuvem e da comparação", () => {
  it("nome do projeto, endereço fixo da prévia e páginas pelo mapa de arquivos ou pelo mapa do site", () => {
    expect(nomeNaVercel("Site do Café__33333333")).toBe("site-do-caf-33333333");
    const apelido = apelidoDaPrevia("site-do-cafe-33333333", "a1b2c3d4e5f6");
    expect(apelido).toBe("site-do-cafe-33333333-va1b2c3d4.vercel.app");
    expect(apelidoDaPrevia("x".repeat(120), "abcdef12").split(".")[0].length).toBeLessThanOrEqual(63);
    expect(paginasDosArquivos({ "obrigado/index.html": "1", "index.html": "2", "assets/a.js": "3", "captura/index.html": "4" })).toEqual(["/", "/captura/", "/obrigado/"]);
    expect(paginasDoMapa({ paginas: [{ slug: "" }, { slug: "obrigado" }] })).toEqual(["/", "/obrigado/"]);
    expect(paginasDoMapa(mapaPadrao("landing"))).toEqual(["/"]);
  });

  it("compara com o publicado: entra, muda, sai do ar e igual (por arquivo), e estima sem a prévia", () => {
    const publicado = lerPublicado({ deploy_url: "https://x.vercel.app", commit: "aaaa1111", arquivos: { "index.html": "h1", "sobre/index.html": "s1", "contato/index.html": "c1", "assets/a.js": "a1" }, no_ar: true })!;
    const c = compararComPublicado({ commit: "bbbb2222", paginas: ["/", "/contato/", "/obrigado/"], arquivos: { "index.html": "h2", "contato/index.html": "c1", "obrigado/index.html": "o1", "assets/b.js": "b1" } }, publicado);
    expect(c).toMatchObject({ primeira: false, entra: ["/obrigado/"], muda: ["/"], sai: ["/sobre/"], igual: ["/contato/"], estimada: false, arquivos: { novos: 2, trocados: 1, removidos: 2 } });
    expect(linhasDaComparacao(c)).toEqual(["Entra: /obrigado/.", "Muda: /.", "Sai do ar: /sobre/.", "Igual ao que está no ar: /contato/."]);
    const estimada = compararComPublicado({ commit: "bbbb2222", paginas: ["/"], arquivos: null }, publicado);
    expect(estimada).toMatchObject({ estimada: true, muda: ["/"], sai: ["/contato/", "/sobre/"] });
    expect(compararComPublicado({ commit: "c", paginas: ["/"] }, null)).toMatchObject({ primeira: true, entra: ["/"] });
    // Tirado do ar: a próxima publicação é como a primeira.
    expect(compararComPublicado({ commit: "c", paginas: ["/"] }, { ...publicado, no_ar: false }).primeira).toBe(true);
  });

  it("só a versão salva que a tela mostrou", () => {
    expect(conferirVersaoPedida(undefined, "abc1234def").ok).toBe(true);
    expect(conferirVersaoPedida("abc1234d", "abc1234def").ok).toBe(true);
    expect(conferirVersaoPedida("fff1234d", "abc1234def")).toMatchObject({ ok: false, codigo: "versao_mudou" });
    expect(conferirVersaoPedida("x; rm", "abc")).toMatchObject({ ok: false, codigo: "versao_invalida" });
  });
});

describe("worker: o dist na Vercel da agência", () => {
  it("prévia por versão: projeto sem login nas prévias, deploy SEM produção, endereço fixo por commit e mapa de arquivos", async () => {
    const v = vercelFalsa({ token: TOKEN });
    const api = criarApiDaVercel({ token: TOKEN, teamId: "team_agencia", fetch: v.fetch });
    const arquivos = arquivosDoDist(distDeDuasPaginas("previa"));
    expect(arquivos.map((a) => a.caminho)).toEqual(["assets/app-1.js", "index.html", "obrigado/index.html", "vercel.json"]);
    const p = await previaNaVercel(api, { projeto: "site-do-cafe-33333333", commit: "a1b2c3d4e5f6a7b8", ramo: "main", arquivos, esperar, agora: () => "2026-10-20T10:00:00Z" });
    expect(p).toMatchObject({ url: "https://site-do-cafe-33333333-va1b2c3d4.vercel.app", deploy_id: "dpl_1", projeto_vercel: "prj_1", commit: "a1b2c3d4e5f6a7b8", ramo: "main", paginas: ["/", "/obrigado/"], protecao: "desligada", aviso: null });
    expect(Object.keys(p.arquivos)).toEqual(["assets/app-1.js", "index.html", "obrigado/index.html"]);
    const deploy = JSON.parse(v.de("POST", "/v13/deployments")[0].corpo);
    expect(deploy.target).toBeUndefined();
    expect(deploy.files).toHaveLength(4);
    expect(JSON.parse(v.de("PATCH", "/v9/projects/prj_1")[0].corpo)).toEqual({ ssoProtection: null, passwordProtection: null });
    expect(v.de("POST", "/v2/files")).toHaveLength(4);
    expect(v.chamadas.every((c) => c.url.indexOf("teamId=team_agencia") > 0 && c.url.indexOf(TOKEN) < 0)).toBe(true);
  });

  it("produção: target production e o domínio do cliente (com www) no mesmo projeto, mesmo já ligado antes (409)", async () => {
    const v = vercelFalsa({ token: TOKEN });
    v.estado.projetoCriado = true;
    v.estado.dominios.add("cafe.com.br");
    const api = criarApiDaVercel({ token: TOKEN, fetch: v.fetch });
    const r = await producaoNaVercel(api, { projeto: "site-do-cafe-33333333", commit: "bbbb2222cccc", arquivos: arquivosDoDist(distDeDuasPaginas("producao")), dominio: "cafe.com.br", esperar });
    expect(JSON.parse(v.de("POST", "/v13/deployments")[0].corpo).target).toBe("production");
    expect(r).toMatchObject({ projeto_vercel: "prj_1", deploy_id: "dpl_1", estado: "READY", dominio: "cafe.com.br", verificado: false, paginas: ["/", "/obrigado/"] });
    expect(v.de("POST", "/v10/projects/prj_1/domains").map((c) => JSON.parse(c.corpo))).toEqual([{ name: "cafe.com.br" }, { name: "www.cafe.com.br", redirect: "cafe.com.br" }]);
    expect(v.de("GET", "/v9/projects/prj_1/domains/cafe.com.br")).toHaveLength(1);
  });

  it("chave errada: o erro diz o status da Vercel e nunca o token", async () => {
    const v = vercelFalsa({ token: "outro-token-que-a-vercel-espera-0000" });
    const api = criarApiDaVercel({ token: TOKEN, fetch: v.fetch });
    const e = await previaNaVercel(api, { projeto: "x", commit: "abc12345", ramo: "main", arquivos: [], esperar }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroDaVercel);
    expect(String(e.message) + JSON.stringify(e)).not.toContain(TOKEN);
  });
});

// ------------------------------------------------------------------ servidor (rotas da função mesa-site)

class ErroDeTeste extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

const trabalho = (id: string, tipo: string, extra: Partial<TrabalhoDoMotor> = {}): TrabalhoDoMotor =>
  ({ id, client_id: CLIENTE, marca_id: null, mesa: "site", projeto: "site-do-cafe-33333333", referencia_id: SITE, tipo, estado: "feito", modelo: null, instrucao: "", teto_usd: 0, estimativa_usd: 0, custo_usd: 0, preview_url: null, commit: null, commit_anterior: null, zip_path: null, resultado: {}, erro: null, criado_em: `2026-10-20T0${id.length}:00:00Z`, terminado_em: null, ...extra }) as TrabalhoDoMotor;

const salvar = (id: string, commit: string, previa?: Record<string, unknown>) =>
  trabalho(id, "salvar", { commit, resultado: { ramo: "main", build: { ok: true }, versao: { commit, de: null, origem: "edicao", modelos: [], trabalhos: [], em: "2026-10-20T09:00:00Z" }, ...(previa ? { previa_nuvem: previa } : {}) } });

function montarServidor(o: { token?: string; motor?: boolean | null; publicacao?: Record<string, unknown>; trabalhos?: TrabalhoDoMotor[]; vercel?: ReturnType<typeof vercelFalsa> } = {}) {
  const site: Record<string, any> = { id: SITE, client_id: CLIENTE, marca_id: null, nome: "Site do café", projeto: "site-do-cafe-33333333", tipo: "landing", mapa: { paginas: [{ id: "inicio", slug: "", titulo: "Início", secoes: [] }, { id: "obrigado", slug: "obrigado", titulo: "Obrigado", secoes: [] }], globais: [] }, direcao: {}, publicacao: o.publicacao || { dominio: "cafe.com.br" } };
  const pedidos: Array<{ pedido: Record<string, unknown>; pacote: Record<string, unknown> }> = [];
  const auditoria: Array<Record<string, unknown>> = [];
  const v = o.vercel || vercelFalsa({ token: TOKEN, dominio: "cafe.com.br" });
  const ctx: ContextoDaPublicacao = {
    servico: () => ({}) as never,
    lerSite: async () => site as never,
    atualizarSite: async (_id, campos) => Object.assign(site, campos) as never,
    erro: (status, codigo, mensagem, extra) => new ErroDeTeste(status, codigo, mensagem, extra),
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    token: async () => (o.token === undefined ? TOKEN : o.token),
    teamId: () => null,
    fetch: v.fetch,
    trabalhos: async () => o.trabalhos || [],
    executor: async () => (o.motor === null ? null : { visto_em: "2026-10-20T10:00:00Z", capacidades: { vercel: o.motor !== false } }),
    temBuild: async () => true,
    ultimoZip: async () => null,
    criarTrabalho: async (_ch, _s, pedido, pacote) => (pedidos.push({ pedido, pacote }), trabalho(`t${pedidos.length}`, pedido.tipo, { estado: "na_fila", instrucao: pedido.instrucao })),
    pacoteDoSite: async () => ({ pacote: { cliente: "Café" }, arquivos: [] }),
    auditar: async (_ch, ferramenta, input) => void auditoria.push({ ferramenta, ...input }),
  };
  const rotas = rotasDaPublicacao(ctx);
  const respostas: string[] = [];
  const chamar = async (acao: string, corpo: Record<string, unknown> = {}) => {
    try {
      const r = await rotas[acao]({ userId: "u-1" }, { site_id: SITE, ...corpo });
      const texto = await r.text();
      respostas.push(texto);
      return JSON.parse(texto);
    } catch (e) {
      respostas.push(`${(e as Error).message} ${JSON.stringify(e)}`);
      throw e;
    }
  };
  return { site, pedidos, auditoria, v, chamar, respostas };
}

const PREVIA_B = { url: "https://site-do-cafe-33333333-vbbbb2222.vercel.app", deploy_id: "dpl_9", projeto_vercel: "prj_1", commit: "bbbb2222cccc", ramo: "main", paginas: ["/", "/obrigado/"], arquivos: { "index.html": "h2", "obrigado/index.html": "o1" }, em: "2026-10-20T09:01:00Z" };
const NO_AR_A = { dominio: "cafe.com.br", projeto_vercel: "prj_1", deploy_url: "https://site-do-cafe-33333333-h1-agencia.vercel.app", deploy_id: "dpl_1", commit: "aaaa1111bbbb", paginas: ["/", "/sobre/"], arquivos: { "index.html": "h1", "sobre/index.html": "s1" }, publicado_em: "2026-10-19T12:00:00Z", no_ar: true };

describe("servidor: estado, prévia pedida e publicar só a versão salva", () => {
  it("o estado mostra a versão salva que sobe (com a prévia dela), o que está no ar e o que entra, muda e sai", async () => {
    const s = montarServidor({ publicacao: NO_AR_A, trabalhos: [salvar("s2", "bbbb2222cccc", PREVIA_B), salvar("s1", "aaaa1111bbbb")] });
    const e = await s.chamar("publicacao_estado");
    expect(e).toMatchObject({ vercel_ligada: true, vercel_no_servidor: true, vercel_no_motor: true, faltas: [], versao: { commit: "bbbb2222cccc", previa_url: PREVIA_B.url }, publicado: { commit: "aaaa1111bbbb", no_ar: true } });
    expect(e.comparacao).toMatchObject({ entra: ["/obrigado/"], muda: ["/"], sai: ["/sobre/"], estimada: false });
    expect(e.previas.map((p: { url: string }) => p.url)).toEqual([PREVIA_B.url]);
    expect(previaDoCommit([salvar("s2", "bbbb2222cccc", PREVIA_B)], "bbbb2222")!.url).toBe(PREVIA_B.url);
  });

  it("sem a chave no servidor, mas com ela no motor: publicar liga; domínio e tirar do ar dizem o nome do segredo", async () => {
    const s = montarServidor({ token: "", publicacao: NO_AR_A, trabalhos: [salvar("s1", "aaaa1111bbbb")] });
    const e = await s.chamar("publicacao_estado");
    expect(e).toMatchObject({ vercel_ligada: true, vercel_no_servidor: false, faltas: [] });
    await expect(s.chamar("dominio_ligar")).rejects.toMatchObject({ status: 409, codigo: "vercel_sem_chave_no_servidor", message: SEM_CHAVE_NO_SERVIDOR });
    await expect(s.chamar("publicacao_tirar_do_ar", { confirmar: true })).rejects.toMatchObject({ codigo: "vercel_sem_chave_no_servidor" });
    // Sem a chave no motor, o deploy não teria onde rodar: falta dita na tela.
    const sem = montarServidor({ token: "", motor: false, trabalhos: [salvar("s1", "aaaa1111bbbb")] });
    expect((await sem.chamar("publicacao_estado")).faltas[0]).toMatch(/VERCEL_TOKEN/);
  });

  it("prévia na nuvem pedida: trabalho revisar sem custo, com a marca no pacote; repetido devolve o que está na fila", async () => {
    const s = montarServidor({ trabalhos: [salvar("s1", "aaaa1111bbbb")] });
    const r = await s.chamar("previa_nuvem_pedir");
    expect(s.pedidos).toEqual([{ pedido: { tipo: "revisar", instrucao: INSTRUCAO_DA_PREVIA_NA_NUVEM }, pacote: { previa_nuvem: true } }]);
    expect(r.trabalho.tipo).toBe("revisar");
    const fila = montarServidor({ trabalhos: [trabalho("r1", "revisar", { estado: "na_fila", instrucao: INSTRUCAO_DA_PREVIA_NA_NUVEM })] });
    expect((await fila.chamar("previa_nuvem_pedir")).ja_na_fila).toBe(true);
    expect(fila.pedidos).toEqual([]);
  });

  it("publicar leva só a versão salva mostrada; outra salva no meio, rascunho aberto ou geração em andamento recusam", async () => {
    const s = montarServidor({ publicacao: NO_AR_A, trabalhos: [salvar("s2", "bbbb2222cccc", PREVIA_B)] });
    await expect(s.chamar("publicar", { confirmar: true, versao: "aaaa1111bbbb" })).rejects.toMatchObject({ status: 409, codigo: "versao_mudou" });
    await expect(s.chamar("publicar", { versao: "bbbb2222cccc" })).rejects.toMatchObject({ codigo: "confirmar_publicacao" });
    const r = await s.chamar("publicar", { confirmar: true, versao: "bbbb2222cccc" });
    expect(r.trabalho.tipo).toBe("publicar");
    expect(s.pedidos[0].pacote).toMatchObject({ cliente: "Café", dominio: "cafe.com.br", versao: "bbbb2222cccc" });
    expect(s.auditoria[0]).toMatchObject({ ferramenta: "site_publicar", versao: "bbbb2222cccc" });
    // Sem versão pedida (o cartão do diretor): vai a versão salva de agora.
    const d = montarServidor({ trabalhos: [salvar("s2", "bbbb2222cccc")] });
    await d.chamar("publicar", { confirmar: true });
    expect(d.pedidos[0].pacote.versao).toBe("bbbb2222cccc");
    // Rascunho aberto: o que sobe é a versão salva.
    const rasc = montarServidor({ trabalhos: [trabalho("a1", "ajustar", { commit: "cccc", resultado: { ramo: "rascunho", rascunho: { aberto: true, base: "bbbb2222cccc" } } }), salvar("s2", "bbbb2222cccc")] });
    await expect(rasc.chamar("publicar", { confirmar: true, versao: "bbbb2222cccc" })).rejects.toMatchObject({ codigo: "rascunho_aberto" });
    // Gerando agora: gerar e publicar nunca no mesmo turno.
    const gerando = montarServidor({ trabalhos: [trabalho("c1", "construir", { estado: "executando" }), salvar("s2", "bbbb2222cccc")] });
    await expect(gerando.chamar("publicar", { confirmar: true })).rejects.toMatchObject({ codigo: "geracao_em_andamento" });
    expect(rasc.pedidos.concat(gerando.pedidos)).toEqual([]);
  });

  it("tirar do ar remove os endereços do deploy de produção (domínio e .vercel.app) e marca fora do ar", async () => {
    const v = vercelFalsa({ token: TOKEN, dominio: "cafe.com.br" });
    v.estado.apelidos.set("dpl_1", [{ uid: "al_a", alias: "site-do-cafe-33333333.vercel.app" }, { uid: "al_b", alias: "cafe.com.br" }]);
    const s = montarServidor({ publicacao: { ...NO_AR_A }, trabalhos: [salvar("s1", "aaaa1111bbbb")], vercel: v });
    await expect(s.chamar("publicacao_tirar_do_ar")).rejects.toMatchObject({ codigo: "confirmar_tirar_do_ar" });
    const r = await s.chamar("publicacao_tirar_do_ar", { confirmar: true });
    expect(r.removidos).toEqual(["site-do-cafe-33333333.vercel.app", "cafe.com.br"]);
    expect(v.de("DELETE", "/v2/aliases/").map((c) => c.caminho)).toEqual(["/v2/aliases/al_a", "/v2/aliases/al_b"]);
    expect(s.site.publicacao).toMatchObject({ no_ar: false, tirados: ["site-do-cafe-33333333.vercel.app", "cafe.com.br"] });
    expect(s.auditoria[0]).toMatchObject({ ferramenta: "site_tirar_do_ar", deploy_id: "dpl_1" });
    const e = await s.chamar("publicacao_estado");
    expect(e.publicado).toMatchObject({ no_ar: false });
    expect(e.deploy_url).toBeNull();
    expect(e.comparacao.primeira).toBe(true);
    await expect(s.chamar("publicacao_tirar_do_ar", { confirmar: true })).rejects.toMatchObject({ codigo: "nada_no_ar" });
  });

  it("domínio próprio: liga no projeto, mostra o DNS pendente (A, CNAME e TXT) e depois verificado", async () => {
    const s = montarServidor({ publicacao: { dominio: "cafe.com.br", registrador: "registro_br" }, trabalhos: [salvar("s1", "aaaa1111bbbb")] });
    const pendente = await s.chamar("dominio_ligar");
    expect(pendente.verificado).toBe(false);
    expect(pendente.estado).toBe("aguardando_dns");
    expect(pendente.cartao.registros).toEqual([
      { tipo: "A", nome: "@", valor: "76.76.21.21", apoio: undefined },
      { tipo: "CNAME", nome: "www", valor: "abc123.vercel-dns-017.com", apoio: undefined },
      { tipo: "TXT", nome: "_vercel", valor: "vc-domain-verify=cafe.com.br,abc123", apoio: "verificação da Vercel" },
    ].map((r) => JSON.parse(JSON.stringify(r))));
    expect(s.site.publicacao).toMatchObject({ projeto_vercel: "prj_1", dominio_ligado: "cafe.com.br" });
    expect(s.v.de("PATCH", "/v9/projects/prj_1")).toHaveLength(1);
    // Ainda sem o TXT: verificar não quebra (a Vercel responde 400) e segue pendente.
    expect((await s.chamar("dominio_verificar")).estado).toBe("aguardando_dns");
    // O cliente criou os registros.
    s.v.estado.txtCriado = true;
    s.v.estado.dnsCerto = true;
    const ok = await s.chamar("dominio_verificar");
    expect(ok).toMatchObject({ verificado: true, estado: "verificado" });
    expect(typeof s.site.publicacao.verificado_em).toBe("string");
    expect(s.v.de("POST", "/v10/projects/prj_1/domains")).toHaveLength(2);
  });

  it("nenhuma resposta, erro ou log leva o token", async () => {
    const s = montarServidor({ publicacao: NO_AR_A, trabalhos: [salvar("s2", "bbbb2222cccc", PREVIA_B)] });
    await s.chamar("publicacao_estado");
    await s.chamar("dominio_ligar");
    await s.chamar("dominio_verificar");
    await s.chamar("publicar", { confirmar: true, versao: "bbbb2222cccc" });
    await s.chamar("publicacao_tirar_do_ar", { confirmar: true });
    await s.chamar("publicar", { confirmar: true, versao: "ffff0000" }).catch(() => undefined);
    // A Vercel recusando a chave: a mensagem vai para a tela sem o token.
    const recusa = montarServidor({ vercel: vercelFalsa({ token: "outra-chave-qualquer-000000000" }) });
    await recusa.chamar("dominio_ligar").catch(() => undefined);
    const tudo = s.respostas.concat(recusa.respostas, logs, JSON.stringify(s.site), JSON.stringify(s.pedidos), JSON.stringify(s.auditoria));
    expect(tudo.join("\n")).not.toContain(TOKEN);
    expect(recusa.respostas[0]).toMatch(/403/);
    expect(previasNaNuvem([salvar("s2", "bbbb2222cccc", PREVIA_B)])[0].url).toBe(PREVIA_B.url);
  });
});
