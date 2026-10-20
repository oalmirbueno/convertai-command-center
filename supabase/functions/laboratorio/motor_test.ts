/**
 * Laboratório (20/10/2026): nós criativos no motor da casa (estudio-arte), saida.usou, salvar nos arquivos,
 * ajustar e variar, e a regra das cadeias que fecham no planejar. Sem rede (portas falsas).
 *
 *   deno test --allow-env supabase/functions/laboratorio/motor_test.ts
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Chamador, ErroHttp } from "./comum.ts";
import type { ProjetoDoLab } from "./executar.ts";
import { acompanharNoEstudio, ajustarNoEstudio, type PortaDoMotor, rodarNoEstudio, type SaidaDoMotor } from "./motor-da-casa.ts";
import { noAjustar, noVariar, type PortaDosAjustes, salvarNosArquivos } from "./ajustes.ts";
import { andamentoDoEstudio, formatoDoEstudio, materiaisDoMotor, nosSoltos, REGRA_DA_CADEIA, rotaDoMotor } from "./modulos/motor.ts";
import { SISTEMA_DO_PLANEJAR } from "./modulos/prompts.ts";
import { type Canvas, chamadasDoNo, type NoDoCanvas } from "./modulos/regras.ts";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const LIVRE = "99999999-9999-4999-8999-999999999999";
const ch: Chamador = { userId: "u1", token: "jwt", papeis: ["design"], doChamador: {} as never };
const no = (id: string, tipo: NoDoCanvas["tipo"], dados: Record<string, unknown> = {}): NoDoCanvas => ({ id, tipo, x: 0, y: 0, dados });
const canvas = (nos: NoDoCanvas[], ligs: Array<[string, string]>): Canvas => ({ nos, ligacoes: ligs.map(([de, para], i) => ({ id: `l${i}`, de, para })), viewport: { x: 0, y: 0, zoom: 1 } });

function projeto(c: Canvas, clientId: string | null = CLIENTE): ProjetoDoLab {
  return { id: "22222222-2222-4222-8222-222222222222", nome: "Black Friday", client_id: clientId, contexto: null, canvas: c, versao: 1, status: "ativo", template_de: null, created_by: null, created_at: "", updated_at: "" };
}

/** O fluxo de exemplo: Contexto + Marca + Mídia + Config → Copy → Resultado. */
function fluxo() {
  const c = canvas([
    no("ctx", "contexto", { texto: "Promoção de Black Friday da cafeteria" }),
    no("mar", "marca", { paleta: "#3b2416" }),
    no("mid", "midia", { imagens: [{ path: "global/laboratorio/p/entradas/cafe.jpg" }] }),
    no("cfg", "config", { proporcao: "9:16", quantidade: 2 }),
    no("cop", "copy", { formato: "anuncio" }),
    no("ref", "referencias", { links: "https://x.com" }),
    no("res", "imagem", { titulo: "Criativo", prompt: "Arte da promoção" }),
  ], [["ctx", "cop"], ["cop", "res"], ["mar", "res"], ["mid", "res"], ["cfg", "res"], ["ref", "res"], ["ctx", "res"]]);
  const saidas: Record<string, Record<string, unknown>> = {
    ctx: { texto: "Promoção de Black Friday da cafeteria" },
    mar: { texto: "Marca: Paleta: #3b2416" },
    mid: { imagens: [{ path: "global/laboratorio/p/entradas/cafe.jpg", bucket: "workspace" }] },
    cop: { texto: "Combo café + pão de queijo por R$ 19" },
    ref: { texto: "Fundo escuro, tipografia grande", imagens: [{ path: "global/laboratorio/p/entradas/print.png" }] },
  };
  const entradas = ["cop", "mar", "mid", "cfg", "ref", "ctx"].map((id) => ({ no: c.nos.find((n) => n.id === id)!, saida: saidas[id] || null }));
  return { c, entradas, res: c.nos.find((n) => n.id === "res")! };
}

type Reg = { nome: string; args: unknown[] };
function motorFalso(o: { livre?: string | null; trabalho?: Record<string, unknown>; fila?: Array<Record<string, unknown>>; versaoDepois?: number } = {}) {
  const chamadas: Reg[] = [];
  let versao = 1;
  const porta: PortaDoMotor = {
    async estudio(acao, corpo) {
      chamadas.push({ nome: acao, args: [corpo] });
      if (acao === "rapida_preparar") return { trabalho: { id: `t${chamadas.filter((c) => c.nome === "rapida_preparar").length}`, direcao: { cards: [{ ordem: 1 }] } } };
      if (acao === "ajustar_card") versao++;
      return { ok: true };
    },
    clienteDoLivre: async () => (o.livre === undefined ? LIVRE : o.livre),
    async copiarParaOEstudio(f, clientId) {
      chamadas.push({ nome: "copiar", args: [f.path, clientId] });
      return `${clientId}/estudio/fotos/lab-1.jpg`;
    },
    async lerTrabalho(id) {
      return { id, client_id: CLIENTE, status: "dirigido", direcao: { cards: [{ ordem: 1 }] }, cards: [{ ordem: 1, versao, storage_path: `${CLIENTE}/estudio/${id}-v${versao}.png` }], ...(o.trabalho || {}) } as never;
    },
    lerFila: async () => (o.fila || []) as never,
    async guardar(g) {
      chamadas.push({ nome: "guardar", args: [g.path] });
      return { path: `global/laboratorio/p/${g.execucaoId}-${g.indice}.png`, url: "https://u", bucket: "workspace" };
    },
  };
  return { porta, chamadas, nomes: () => chamadas.map((c) => c.nome) };
}

// ------------------------------------------------------------------ rota e complemento

Deno.test("motor: Resultado e Carrossel vão para a estudio-arte; Logo pela Mesa Identidade; o resto direto", () => {
  assertEquals(rotaDoMotor("imagem"), "estudio_arte");
  assertEquals(rotaDoMotor("carrossel"), "estudio_arte");
  assertEquals(rotaDoMotor("logo"), "identidade");
  assertEquals(rotaDoMotor("template_designer"), "direto");
  assertEquals(formatoDoEstudio("9:16"), "stories_9x16");
  assertEquals(formatoDoEstudio("4:5"), "feed_4x5");
});

Deno.test("complemento: copy vira texto exato, marca e mídia viram identidade e foto real, referência vira estilo; usou registra cada uma", () => {
  const { res, entradas } = fluxo();
  const m = materiaisDoMotor(res, entradas, { proporcao: "9:16", prompt_base: null });
  assertEquals(m.documentos[0], { nome: "Texto exato (Copy)", texto: "Combo café + pão de queijo por R$ 19" });
  assert(m.pedido.indexOf("Texto exato") >= 0 && m.pedido.indexOf("sem inventar") >= 0);
  assert(m.pedido.indexOf("produto real") >= 0);
  assert(m.pedido.indexOf("Estilo das referências: Fundo escuro") >= 0);
  assertEquals(m.fotos.map((f) => f.papel), ["foto", "referencia"]);
  assertEquals(m.formato, "stories_9x16");
  assertEquals(m.usou.map((u) => [u.tipo, u.no_id]), [["copy", "cop"], ["marca", "mar"], ["midia", "mid"], ["config", "cfg"], ["referencias", "ref"], ["contexto", "ctx"]]);
  assert(m.usou.every((u) => u.rotulo && u.como));
});

Deno.test("motor: rodar prepara a Arte rápida (origem laboratorio) e põe na fila; foto da Mídia vai para a pasta do cliente", async () => {
  const { c, res, entradas } = fluxo();
  const f = motorFalso();
  const r = await rodarNoEstudio(f.porta, { projeto: projeto(c), canvas: c, carteira: { clientId: CLIENTE, livre: false } }, res, entradas, "e1");
  assertEquals(r.status, "aguardando");
  assertEquals(f.nomes(), ["copiar", "copiar", "rapida_preparar", "enfileirar", "rapida_preparar", "enfileirar"]);
  const preparo = f.chamadas[2].args[0] as Record<string, unknown>;
  assertEquals(preparo.origem, "laboratorio");
  assertEquals(preparo.client_id, CLIENTE);
  assertEquals(preparo.peca, "unica");
  assertEquals((preparo.arquivos as Array<{ caminho: string; papel: string }>).map((a) => [a.caminho.indexOf(`${CLIENTE}/`), a.papel]), [[0, "foto"], [0, "referencia"]]);
  assertEquals((f.chamadas[3].args[0] as Record<string, unknown>).corrigir_sozinho, true);
  const s = r.saida as SaidaDoMotor;
  assertEquals(s.motor, "estudio_arte");
  assertEquals(s.estudio_trabalhos, ["t1", "t2"]);
  assertEquals(s.usou.length, 6);
});

Deno.test("motor: projeto sem cliente vai sem marca no cliente do Estúdio livre; sem ele, 409", async () => {
  const { c, res, entradas } = fluxo();
  const f = motorFalso();
  await rodarNoEstudio(f.porta, { projeto: projeto(c, null), canvas: c, carteira: { clientId: "x", livre: true } }, res, entradas, "e1");
  const preparo = f.chamadas.find((x) => x.nome === "rapida_preparar")!.args[0] as Record<string, unknown>;
  assertEquals(preparo.sem_marca, true);
  assertEquals(preparo.client_id, undefined);
  assertEquals(f.chamadas.find((x) => x.nome === "copiar")!.args[1], LIVRE);
  const sem = motorFalso({ livre: null });
  const e = await assertRejects(() => rodarNoEstudio(sem.porta, { projeto: projeto(c, null), canvas: c, carteira: { clientId: "x", livre: true } }, res, entradas, "e1"), ErroHttp);
  assertEquals((e as ErroHttp).codigo, "sem_cliente_do_estudio_livre");
});

Deno.test("acompanhar: na fila segue aguardando; pronto guarda na pasta do projeto; tudo com erro vira erro", async () => {
  const saida = { motor: "estudio_arte", estudio_trabalhos: ["t1"], etapa: "gerando", pecas: [], imagens: [], usou: [], render_progresso: 0 } as unknown as SaidaDoMotor;
  const rodando = motorFalso({ fila: [{ ordem: 1, status: "rodando" }], trabalho: { cards: [] } });
  assertEquals((await acompanharNoEstudio(rodando.porta, saida, "e1", "Criativo")).status, "aguardando");
  const pronto = motorFalso();
  const r = await acompanharNoEstudio(pronto.porta, saida, "e1", "Criativo");
  assertEquals(r.status, "pronto");
  assertEquals(r.saida.imagens!.length, 1);
  assertEquals(r.saida.pecas[0], { trabalho_id: "t1", ordem: 1, versao: 1, path: `${CLIENTE}/estudio/t1-v1.png` });
  assertEquals(pronto.nomes(), ["guardar"]);
  const falhou = motorFalso({ fila: [{ ordem: 1, status: "erro", erro_mensagem: "Sem saldo." }], trabalho: { cards: [] } });
  const e = await acompanharNoEstudio(falhou.porta, saida, "e1", "Criativo");
  assertEquals([e.status, e.erro], ["erro", "Sem saldo."]);
  assertEquals(andamentoDoEstudio({ direcao: { cards: [{ ordem: 1 }, { ordem: 2 }] }, cards: [{ ordem: 1, versao: 1, storage_path: "a" }, { ordem: 1, versao: 2, storage_path: "b" }] }, []).prontas, [{ ordem: 1, versao: 2, storage_path: "b" }]);
});

Deno.test("ajustar e variar no motor da casa: ajustar_card na lâmina escolhida, versão nova guardada", async () => {
  const saida = { motor: "estudio_arte", estudio_trabalhos: ["t1"], pecas: [{ trabalho_id: "t1", ordem: 1, versao: 1, path: "x" }], usou: [] } as unknown as SaidaDoMotor;
  const f = motorFalso();
  const a = await ajustarNoEstudio(f.porta, saida, { indice: 0, pedido: "logo maior", variacoes: 1, execucaoId: "e2", rotulo: "Criativo" });
  assertEquals((f.chamadas[0].args[0] as Record<string, unknown>).instrucao, "logo maior");
  assertEquals(a.pecas[0].versao, 2);
  const v = motorFalso();
  const r = await ajustarNoEstudio(v.porta, saida, { indice: 0, pedido: null, variacoes: 3, execucaoId: "e3", rotulo: "Criativo" });
  assertEquals(v.nomes().filter((n) => n === "ajustar_card").length, 3);
  assertEquals(r.imagens!.length, 3);
  await assertRejects(() => ajustarNoEstudio(motorFalso().porta, saida, { indice: 5, pedido: "x", variacoes: 1, execucaoId: "e", rotulo: "r" }), ErroHttp);
});

// ------------------------------------------------------------------ salvar, ajustar e variar (ações)

function ajustesFalsos(o: { clientId?: string | null; acesso?: boolean; semImagem?: boolean; falha?: boolean; segundoPlano?: boolean } = {}) {
  const chamadas: Reg[] = [];
  const reg = (nome: string, ...args: unknown[]) => chamadas.push({ nome, args });
  const p = projeto(canvas([no("res", "imagem")], []), o.clientId === undefined ? CLIENTE : o.clientId);
  const porta: PortaDosAjustes = {
    lerProjeto: async () => p,
    async garantirAcesso(_c, id) {
      reg("garantirAcesso", id);
      if (o.acesso === false) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Sem acesso.");
    },
    ultimaPronta: async () => (o.semImagem ? null : { id: "ex1", status: "pronto", saida: { motor: "estudio_arte", imagens: [{ path: "global/laboratorio/p/a-01.png" }, { path: "global/laboratorio/p/a-02.png" }] } }),
    nomeDoCliente: async () => "Café X",
    async copiarParaOCliente(c) {
      reg("copiar", c.imagens.map((i) => i.path));
      return c.imagens.map((i) => ({ nome: i.path.split("/").pop()!, path: `client/${c.clientId}/laboratorio/${i.path.split("/").pop()}`, pasta: "Laboratório / Black Friday" }));
    },
    preco: async () => 0.06,
    async cobrar(c) {
      reg("cobrar", c.total);
      return { devolverTudo: async (m: string) => void reg("devolverTudo", m) };
    },
    criarExecucao: async () => (reg("criarExecucao"), "ex2"),
    atualizarExecucao: async (_id, campos) => void reg("atualizar", campos.status),
    async ajustar(_c, _p, _n, _s, a) {
      reg("ajustar", a);
      if (o.falha) throw new Error("o motor caiu");
      return { saida: { imagens: [{ path: "nova.png", url: null }] }, custo: 0 };
    },
    segundoPlano: () => o.segundoPlano === true,
    execucao: async (id) => new Response(JSON.stringify({ execucao_id: id }), { status: 200 }),
  };
  return { porta, chamadas, nomes: () => chamadas.map((c) => c.nome) };
}

Deno.test("salvar_nos_arquivos: destino, projeto sem cliente, acesso e índices", async () => {
  const e1 = await assertRejects(() => salvarNosArquivos(ajustesFalsos().porta, ch, { projeto_id: "p", no_id: "res", destino: "drive" }), ErroHttp);
  assertEquals((e1 as ErroHttp).status, 400);
  const e2 = await assertRejects(() => salvarNosArquivos(ajustesFalsos({ clientId: null }).porta, ch, { projeto_id: "p", no_id: "res", destino: "cliente" }), ErroHttp);
  assertEquals((e2 as ErroHttp).codigo, "sem_cliente");
  const sem = ajustesFalsos({ acesso: false });
  const e3 = await assertRejects(() => salvarNosArquivos(sem.porta, ch, { projeto_id: "p", no_id: "res", destino: "cliente" }), ErroHttp);
  assertEquals((e3 as ErroHttp).status, 403);
  assertEquals(sem.nomes().indexOf("copiar"), -1);
  const f = ajustesFalsos();
  const r = await (await salvarNosArquivos(f.porta, ch, { projeto_id: "p", no_id: "res", destino: "cliente", indices: [1, 1, 9] })).json();
  assertEquals(f.chamadas.find((c) => c.nome === "copiar")!.args[0], ["global/laboratorio/p/a-02.png"]);
  assertEquals(r.salvos[0].pasta, "Laboratório / Black Friday");
  const lab = await (await salvarNosArquivos(ajustesFalsos().porta, ch, { projeto_id: "p", no_id: "res", destino: "laboratorio" })).json();
  assertEquals(lab.salvos.map((x: { pasta: string }) => x.pasta), ["Laboratório / Café X / Black Friday", "Laboratório / Café X / Black Friday"]);
  const vazio = await assertRejects(() => salvarNosArquivos(ajustesFalsos({ semImagem: true }).porta, ch, { projeto_id: "p", no_id: "res", destino: "laboratorio" }), ErroHttp);
  assertEquals((vazio as ErroHttp).codigo, "sem_imagem");
});

Deno.test("no_ajustar e no_variar: 409 com o custo antes; com confirmado reserva, roda e grava; falha devolve", async () => {
  const f = ajustesFalsos();
  const e = await assertRejects(() => noAjustar(f.porta, ch, { projeto_id: "p", no_id: "res", indice: 0, pedido: "logo maior" }), ErroHttp);
  assertEquals([(e as ErroHttp).status, (e as ErroHttp).extra.total_usd], [409, 0.06]);
  assertEquals(f.nomes().indexOf("cobrar"), -1);
  const semPedido = await assertRejects(() => noAjustar(f.porta, ch, { projeto_id: "p", no_id: "res", indice: 0, confirmado: true }), ErroHttp);
  assertEquals((semPedido as ErroHttp).codigo, "pedido_vazio");
  const ok = ajustesFalsos();
  await noAjustar(ok.porta, ch, { projeto_id: "p", no_id: "res", indice: 1, pedido: "x".repeat(900), confirmado: true });
  assertEquals(ok.nomes(), ["cobrar", "criarExecucao", "atualizar", "ajustar", "atualizar"]);
  assertEquals((ok.chamadas[3].args[0] as { pedido: string }).pedido.length, 500);
  assertEquals(ok.chamadas[4].args[0], "pronto");
  const ruim = ajustesFalsos({ falha: true });
  await noVariar(ruim.porta, ch, { projeto_id: "p", no_id: "res", indice: 0, quantidade: 9, confirmado: true });
  assertEquals((ruim.chamadas.find((c) => c.nome === "ajustar")!.args[0] as { quantidade: number }).quantidade, 4);
  assertEquals(ruim.nomes().slice(-2), ["atualizar", "devolverTudo"]);
  const fora = await assertRejects(() => noVariar(ajustesFalsos().porta, ch, { projeto_id: "p", no_id: "res", indice: 7, confirmado: true }), ErroHttp);
  assertEquals((fora as ErroHttp).codigo, "indice_invalido");
});

// ------------------------------------------------------------------ cadeia e custo

Deno.test("planejar: cadeias que fecham (nó solto e peça sem saída com Pôr no ar viram aviso); a regra vai no texto", () => {
  const fecha = canvas([no("c", "contexto"), no("m", "marca"), no("cp", "copy"), no("r", "imagem"), no("a", "anuncio"), no("n", "por_no_ar")], [["c", "cp"], ["m", "r"], ["cp", "r"], ["r", "a"], ["a", "n"]]);
  assertEquals(nosSoltos(fecha), []);
  const aberto = canvas([no("c", "contexto"), no("cp", "copy"), no("r", "imagem"), no("x", "pesquisa"), no("n", "por_no_ar")], [["c", "cp"], ["cp", "r"], ["c", "n"]]);
  assertEquals(nosSoltos(aberto).map((s) => s.no_id), ["r", "x"]);
  assert(SISTEMA_DO_PLANEJAR.indexOf(REGRA_DA_CADEIA) >= 0);
});

Deno.test("estimar: Resultado no motor da casa leva direção, imagens e conferência de cada arte", () => {
  const c = canvas([no("cfg", "config", { quantidade: 2 }), no("r", "imagem")], [["cfg", "r"]]);
  const chs = chamadasDoNo(c, c.nos[1]);
  assertEquals(chs.map((x) => x.tipo), ["texto", "imagem", "texto"]);
  assertEquals(chs[1].imagens, 2);
  const car = chamadasDoNo(canvas([no("k", "carrossel", { laminas: 6 })], []), no("k", "carrossel", { laminas: 6 }));
  assertEquals(car[1].imagens, 6);
});

// ------------------------------------------------------------------ imagem principal e marca escolhida

Deno.test("imagem principal: dados.principal vai à frente nos nós seguintes; sem ela, a escolha do Jev; fora da lista, nada muda", async () => {
  const { imagensComPrincipal, dadosDoTipo } = await import("./modulos/regras.ts");
  const imgs = ["a", "b", "c"];
  assertEquals(imagensComPrincipal(no("r", "imagem", { principal: 2 }), imgs), ["c", "a", "b"]);
  assertEquals(imagensComPrincipal(no("l", "logo", {}), imgs, { indice: 1 }), ["b", "a", "c"]);
  assertEquals(imagensComPrincipal(no("l", "logo", { principal: 0 }), imgs, { indice: 1 }), ["a", "b", "c"]);
  assertEquals(imagensComPrincipal(no("r", "imagem", { principal: 9 }), imgs), imgs);
  assertEquals(imagensComPrincipal(no("m", "midia", { principal: 2 }), imgs), imgs);
  assertEquals(dadosDoTipo("ugc", { principal: 3 }).dados, { principal: 3 });
  assertEquals(dadosDoTipo("ugc", { principal: 40 }).ignorados, ["principal"]);
  assertEquals(dadosDoTipo("ugc", { principal: "2" }).ignorados, ["principal"]);
  assertEquals(dadosDoTipo("copy", { principal: 1 }).ignorados, ["principal"]);
  // No motor da casa: a imagem principal da Mídia ligada (ou do Resultado) vai primeiro; a logo, sozinha a principal.
  const c = canvas([no("r1", "imagem", { principal: 1 }), no("lg", "logo", { principal: 2 }), no("r2", "imagem")], [["r1", "r2"], ["lg", "r2"]]);
  const m = materiaisDoMotor(c.nos[2], [
    { no: c.nos[0], saida: { imagens: [{ path: "a.png" }, { path: "b.png" }] } },
    { no: c.nos[1], saida: { imagens: [{ path: "l1.png" }, { path: "l2.png" }, { path: "l3.png" }] } },
  ], { proporcao: "4:5" });
  assertEquals(m.fotos.map((f) => f.path), ["b.png", "a.png", "l3.png"]);
});

Deno.test("marca escolhida: marca_id só uuid; vai no preparo e na fila do Estúdio; duas marcas sem escolha dão a frase do Laboratório", async () => {
  const { dadosDoTipo } = await import("./modulos/regras.ts");
  const { marcaIdDoCanvas } = await import("./modulos/motor.ts");
  const MARCA = "44444444-4444-4444-8444-444444444444";
  assertEquals(dadosDoTipo("marca", { marca_id: MARCA.toUpperCase() }).dados, { marca_id: MARCA });
  assertEquals(dadosDoTipo("marca", { marca_id: "cme" }).ignorados, ["marca_id"]);
  const { c, res, entradas } = fluxo();
  c.nos.find((n) => n.id === "mar")!.dados.marca_id = MARCA;
  assertEquals(marcaIdDoCanvas(c, "res"), MARCA);
  const f = motorFalso();
  await rodarNoEstudio(f.porta, { projeto: projeto(c), canvas: c, carteira: { clientId: CLIENTE, livre: false } }, res, entradas, "e1");
  assertEquals((f.chamadas.find((x) => x.nome === "rapida_preparar")!.args[0] as Record<string, unknown>).marca_id, MARCA);
  assertEquals((f.chamadas.find((x) => x.nome === "enfileirar")!.args[0] as Record<string, unknown>).marca_id, MARCA);
  // Sem cliente no projeto, nenhuma marca do cliente entra.
  const livre = motorFalso();
  await rodarNoEstudio(livre.porta, { projeto: projeto(c, null), canvas: c, carteira: { clientId: "x", livre: true } }, res, entradas, "e1");
  assertEquals((livre.chamadas.find((x) => x.nome === "rapida_preparar")!.args[0] as Record<string, unknown>).marca_id, undefined);
  const duas = motorFalso();
  duas.porta.estudio = async () => {
    throw new ErroHttp(400, "escolha_a_marca", "Escolha a marca no topo da Mesa.");
  };
  const e = await assertRejects(() => rodarNoEstudio(duas.porta, { projeto: projeto(fluxo().c), canvas: fluxo().c, carteira: { clientId: CLIENTE, livre: false } }, res, entradas, "e1"), ErroHttp);
  assertEquals((e as ErroHttp).codigo, "escolha_a_marca");
  assert((e as ErroHttp).message.indexOf("nó Marca") >= 0);
});
