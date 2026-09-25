import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn(), rpc: vi.fn() } }));

import {
  agendaDaMarca,
  corpoComMarca,
  definirMarcaAtual,
  filtrarPorMarca,
  itemDaMarca,
  limparMarcaAtual,
  marcaAtual,
  marcaEscolhida,
  marcaParaGravarAgora,
  normalizarMarca,
  ordenarMarcas,
  projetosDaListaNaMarca,
  projetosDaMarca,
  referenciaDaMarca,
  type MarcaDoCliente,
} from "@/lib/mesa/marcas";
import {
  blocoDaMarca,
  colunasComMarca,
  contextoComMarca,
  escolherMarca,
  esquecerMarcas,
  filtrarReferenciasDaMarca,
  fontesDaMarca,
  kitComMarca,
  marcaIdDoAlvo,
  marcaParaGravar,
  marcasDoCliente,
  projetosDaMarca as projetosDaMarcaNoServidor,
  resolverMarca,
  type MarcaDoCliente as MarcaNoServidor,
} from "../../supabase/functions/_shared/marca";

/**
 * Marcas por projeto dentro do mesmo cliente (frente G, fase 2; pedido do dono
 * em 25/09 para a Acerbi com a CME). Regras puras da tela e do servidor e o
 * contrato das funções (marca_id em cada ponto de leitura de kit, logo,
 * referências e contexto).
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const CLIENTE = "39ebda82-637c-498b-a23a-b622f645e852";
const OUTRO = "11111111-1111-1111-1111-111111111111";
const P_ACERBI = "1a55e3e5-0000-4000-8000-000000000001";
const P_SITE = "c08240de-0000-4000-8000-000000000002";
const P_CME = "a220d8f6-0000-4000-8000-000000000003";
const ID_ACERBI = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_CME = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const marca = (extra: Partial<MarcaDoCliente>): MarcaDoCliente => ({
  id: ID_ACERBI,
  client_id: CLIENTE,
  project_id: P_ACERBI,
  nome: "Acerbi",
  principal: true,
  ordem: 0,
  paleta: [],
  logo_path: null,
  logo_alt_path: null,
  logo_file_id: null,
  logo_alt_file_id: null,
  estilo: null,
  regras: null,
  tom: null,
  contexto_extra: null,
  ...extra,
});
const ACERBI = marca({});
const CME = marca({ id: ID_CME, project_id: P_CME, nome: "CME", principal: false, ordem: 1 });
const MARCAS = [ACERBI, CME];

const noServidor = (m: MarcaDoCliente, extra: Partial<MarcaNoServidor> = {}): MarcaNoServidor => ({
  ...m,
  contexto: {},
  ...extra,
});

// ------------------------------------------------------------------ tela

describe("marca aberta na tela", () => {
  it("só existe escolha com 2 ou mais marcas; sem pedido, a principal", () => {
    expect(marcaEscolhida([], null)).toBeNull();
    expect(marcaEscolhida([ACERBI], ACERBI.id)).toBeNull();
    expect(marcaEscolhida(MARCAS, null)).toBe(ACERBI);
    expect(marcaEscolhida(MARCAS, ID_CME)).toBe(CME);
    // id de outro cliente ou lixo no endereço: a principal
    expect(marcaEscolhida(MARCAS, OUTRO)).toBe(ACERBI);
  });

  it("normaliza a linha do banco e põe a principal primeiro", () => {
    expect(normalizarMarca({ id: "x" })).toBeNull();
    const n = normalizarMarca({ id: ID_CME, client_id: CLIENTE, nome: "CME", paleta: "lixo", ordem: "9" });
    expect(n && n.paleta).toEqual([]);
    expect(n && n.ordem).toBe(0);
    expect(n && n.principal).toBe(false);
    expect(ordenarMarcas([CME, ACERBI]).map((m) => m.nome)).toEqual(["Acerbi", "CME"]);
  });

  it("projetos da marca: a CME só com o dela; a principal com todos os outros", () => {
    expect(projetosDaMarca(null, MARCAS)).toBeNull();
    expect(projetosDaMarca(CME, MARCAS)).toEqual({ so: [P_CME] });
    expect(projetosDaMarca(ACERBI, MARCAS)).toEqual({ menos: [P_CME] });
    const f = projetosDaMarca(ACERBI, MARCAS);
    expect(itemDaMarca(P_SITE, f)).toBe(true);
    expect(itemDaMarca(P_CME, f)).toBe(false);
    expect(itemDaMarca(P_CME, projetosDaMarca(CME, MARCAS))).toBe(true);
    expect(itemDaMarca(P_ACERBI, projetosDaMarca(CME, MARCAS))).toBe(false);
    // marca sem projeto não vê nada (nunca mistura)
    expect(itemDaMarca(P_ACERBI, projetosDaMarca({ ...CME, project_id: null }, MARCAS))).toBe(false);
  });

  it("filtra itens e a lista de projetos pela marca; sem marca devolve o mesmo array", () => {
    const itens = [
      { id: "t1", project_id: P_ACERBI },
      { id: "t2", project_id: P_CME },
      { id: "t3", project_id: P_SITE },
    ];
    expect(filtrarPorMarca(itens, null)).toBe(itens);
    expect(filtrarPorMarca(itens, projetosDaMarca(CME, MARCAS)).map((i) => i.id)).toEqual(["t2"]);
    expect(filtrarPorMarca(itens, projetosDaMarca(ACERBI, MARCAS)).map((i) => i.id)).toEqual(["t1", "t3"]);
    const projetos = [{ id: P_ACERBI }, { id: P_CME }];
    expect(projetosDaListaNaMarca(projetos, projetosDaMarca(CME, MARCAS))).toEqual([{ id: P_CME }]);
    expect(projetosDaListaNaMarca(projetos, null)).toBe(projetos);
  });

  it("agenda do mês: post segue o item; post sem item só na principal", () => {
    const agenda = {
      itens: [
        { id: "t1", project_id: P_ACERBI },
        { id: "t2", project_id: P_CME },
      ],
      posts: [{ task_id: "t1" }, { task_id: "t2" }, { task_id: null }, { task_id: "fora-do-mes" }],
      roteiros: {},
    };
    expect(agendaDaMarca(agenda, null)).toBe(agenda);
    const cme = agendaDaMarca(agenda, projetosDaMarca(CME, MARCAS));
    expect(cme.itens.map((i) => i.id)).toEqual(["t2"]);
    expect(cme.posts.map((p) => p.task_id)).toEqual(["t2"]);
    const acerbi = agendaDaMarca(agenda, projetosDaMarca(ACERBI, MARCAS));
    expect(acerbi.itens.map((i) => i.id)).toEqual(["t1"]);
    expect(acerbi.posts.map((p) => p.task_id)).toEqual(["t1", null, "fora-do-mes"]);
    expect(acerbi.roteiros).toBe(agenda.roteiros);
  });

  it("referência da marca: principal vê as do cliente e as dela; CME só as dela", () => {
    expect(referenciaDaMarca(null, null)).toBe(true);
    expect(referenciaDaMarca(null, ACERBI)).toBe(true);
    expect(referenciaDaMarca(ID_CME, ACERBI)).toBe(false);
    expect(referenciaDaMarca(null, CME)).toBe(false);
    expect(referenciaDaMarca(ID_CME, CME)).toBe(true);
  });
});

describe("marca_id nas chamadas às funções (chamarFuncao)", () => {
  const dono = {};
  beforeEach(() => limparMarcaAtual(dono));

  it("sem marca escolhida, o corpo sai igual (mesmo objeto)", () => {
    const corpo = { acao: "preparar", task_id: "t" };
    expect(corpoComMarca("estudio-arte", corpo)).toBe(corpo);
  });

  it("com marca, só as quatro funções recebem marca_id, sem trocar o que a tela mandou", () => {
    definirMarcaAtual(CLIENTE, CME, dono);
    expect(marcaAtual()).toEqual({ clientId: CLIENTE, marcaId: ID_CME });
    for (const f of ["estudio-arte", "agente-calendario", "mesa-ads", "mesa-foto"]) {
      expect(corpoComMarca(f, { acao: "x", client_id: CLIENTE }).marca_id).toBe(ID_CME);
    }
    expect(corpoComMarca("agente-contexto", { acao: "x" }).marca_id).toBeUndefined();
    expect(corpoComMarca("ia-gateway", { acao: "x" }).marca_id).toBeUndefined();
    expect(corpoComMarca("mesa-ads", { acao: "x", marca_id: "outra" }).marca_id).toBe("outra");
    // nunca manda a marca de um cliente para outro
    expect(corpoComMarca("mesa-ads", { acao: "x", client_id: OUTRO }).marca_id).toBeUndefined();
  });

  it("a mesa nova monta antes da antiga desmontar: a antiga não apaga a marca da nova", () => {
    const antiga = {};
    const nova = {};
    definirMarcaAtual(CLIENTE, ACERBI, antiga);
    definirMarcaAtual(CLIENTE, CME, nova);
    limparMarcaAtual(antiga);
    expect(marcaAtual()).toEqual({ clientId: CLIENTE, marcaId: ID_CME });
    // cliente sem marca na mesma casca: limpa
    definirMarcaAtual(OUTRO, null, nova);
    expect(marcaAtual()).toBeNull();
    limparMarcaAtual(nova);
  });

  it("linha nova só leva marca_id da marca que não é a principal", () => {
    definirMarcaAtual(CLIENTE, ACERBI, dono);
    expect(marcaParaGravarAgora(CLIENTE)).toEqual({});
    definirMarcaAtual(CLIENTE, CME, dono);
    expect(marcaParaGravarAgora(CLIENTE)).toEqual({ marca_id: ID_CME });
    expect(marcaParaGravarAgora(OUTRO)).toEqual({});
  });
});

// ------------------------------------------------------------------ servidor (_shared/marca.ts)

describe("regras do servidor", () => {
  it("projeto manda; depois o marca_id; sem pista, a principal; lista vazia, null", () => {
    expect(escolherMarca([], { project_id: P_CME })).toBeNull();
    expect(escolherMarca(MARCAS, { project_id: P_CME, marca_id: ID_ACERBI })).toBe(CME);
    expect(escolherMarca(MARCAS, { project_id: P_SITE })).toBe(ACERBI);
    expect(escolherMarca(MARCAS, { marca_id: ID_CME })).toBe(CME);
    expect(escolherMarca(MARCAS, { marca_id: OUTRO })).toBe(ACERBI);
    expect(escolherMarca(MARCAS, {})).toBe(ACERBI);
    expect(marcaIdDoAlvo({ direcao: { marca_id: ID_CME } })).toBe(ID_CME);
    expect(marcaIdDoAlvo({ marca_id: "lixo" })).toBeNull();
    expect(projetosDaMarcaNoServidor(CME, MARCAS, [P_ACERBI, P_SITE, P_CME])).toEqual([P_CME]);
    expect(projetosDaMarcaNoServidor(ACERBI, MARCAS, [P_ACERBI, P_SITE, P_CME])).toEqual([P_ACERBI, P_SITE]);
    expect(projetosDaMarcaNoServidor(null, MARCAS, [P_ACERBI])).toEqual([P_ACERBI]);
  });

  it("kit: sem marca o mesmo objeto; CME nunca herda logo nem paleta do cliente", () => {
    const kit = {
      paleta: [{ hex: "#003366" }],
      logo_path: `${CLIENTE}/logo-acerbi.png`,
      logo_file_id: "f1",
      logo_alt_path: null,
      logo_alt_file_id: null,
      estilo: "institucional",
      regras: "sem travessão",
    };
    expect(kitComMarca(kit, null)).toBe(kit);
    const cmeVazia = kitComMarca(kit, noServidor(CME));
    expect(cmeVazia.logo_path).toBeNull();
    expect(cmeVazia.logo_file_id).toBeNull();
    expect(cmeVazia.paleta).toEqual([]);
    expect(cmeVazia.estilo).toBe("institucional");
    expect(cmeVazia.regras).toBe("sem travessão");
    const cme = kitComMarca(kit, noServidor(CME, { paleta: [{ hex: "#E91E63" }], logo_path: `${CLIENTE}/marcas/${ID_CME}/logo.png`, estilo: "rosa" }));
    expect(cme.paleta).toEqual([{ hex: "#E91E63" }]);
    expect(cme.logo_path).toBe(`${CLIENTE}/marcas/${ID_CME}/logo.png`);
    expect(cme.estilo).toBe("rosa");
    // principal sem nada preenchido: o kit do cliente
    const acerbi = kitComMarca(kit, noServidor(ACERBI));
    expect(acerbi.logo_path).toBe(kit.logo_path);
    expect(acerbi.paleta).toEqual(kit.paleta);
  });

  it("contexto: tom e contexto da marca por cima; a descrição da logo do cliente não vale para a CME", () => {
    const base = { negocio: "Associação comercial", tom_de_voz: "formal", logo: { descricao: "brasão azul" } };
    expect(contextoComMarca(base, null)).toBe(base);
    const c = contextoComMarca(base, noServidor(CME, { tom: "acolhedor", contexto: { publico: "empreendedoras" }, contexto_extra: "Núcleo feminino" }));
    expect(c.tom_de_voz).toBe("acolhedor");
    expect(c.publico).toBe("empreendedoras");
    expect(c.negocio).toBe("Associação comercial");
    expect(c.logo).toBeUndefined();
    expect(c.marca).toEqual({ nome: "CME", principal: false, contexto_extra: "Núcleo feminino" });
  });

  it("fontes: CME com as dela ou, sem nenhuma, as do cliente; principal sem as da CME", () => {
    const fontes = [
      { id: "1", marca_id: null },
      { id: "2", marca_id: ID_CME },
    ];
    expect(fontesDaMarca(fontes, null)).toBe(fontes);
    expect(fontesDaMarca(fontes, CME).map((f) => f.id)).toEqual(["2"]);
    expect(fontesDaMarca([{ id: "1", marca_id: null }], CME).map((f) => f.id)).toEqual(["1"]);
    expect(fontesDaMarca(fontes, ACERBI).map((f) => f.id)).toEqual(["1"]);
    expect(colunasComMarca("id, nome", null)).toBe("id, nome");
    expect(colunasComMarca("id, nome", CME)).toBe("id, nome, marca_id");
  });

  it("filtro de referências no PostgREST e marca para gravar", () => {
    const chamadas: string[] = [];
    const q: any = {
      eq: (c: string, v: unknown) => (chamadas.push(`eq ${c} ${v}`), q),
      or: (f: string) => (chamadas.push(`or ${f}`), q),
    };
    expect(filtrarReferenciasDaMarca(q, null)).toBe(q);
    expect(chamadas).toEqual([]);
    filtrarReferenciasDaMarca(q, ACERBI);
    filtrarReferenciasDaMarca(q, CME);
    expect(chamadas).toEqual([`or marca_id.is.null,marca_id.eq.${ID_ACERBI}`, `eq marca_id ${ID_CME}`]);
    expect(marcaParaGravar(null)).toEqual({});
    expect(marcaParaGravar(ACERBI)).toEqual({});
    expect(marcaParaGravar(CME)).toEqual({ marca_id: ID_CME });
  });

  it("bloco do prompt: vazio sem marca; com marca, não mistura com a outra", () => {
    expect(blocoDaMarca(null)).toBe("");
    const b = blocoDaMarca(noServidor(CME, { contexto_extra: "Empreendedorismo feminino" }), MARCAS);
    expect(b).toContain("MARCA DESTE TRABALHO: CME");
    expect(b).toContain("Não misture com a outra marca do cliente: Acerbi.");
    expect(b).toContain("Empreendedorismo feminino");
    expect(b.indexOf("—")).toBe(-1);
  });

  it("cliente sem marca (ou banco sem a tabela): null, sem ler a tarefa", async () => {
    esquecerMarcas();
    const tabelas: string[] = [];
    const db: any = {
      from: (t: string) => {
        tabelas.push(t);
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.order = async () => ({ data: null, error: { code: "42P01", message: "relation cliente_marcas does not exist" } });
        return c;
      },
    };
    expect(await resolverMarca(db, CLIENTE, { task_id: "22222222-2222-4222-8222-222222222222" })).toBeNull();
    expect(tabelas).toEqual(["cliente_marcas"]);
    // lista guardada: a segunda chamada não vai ao banco
    expect(await marcasDoCliente(db, CLIENTE)).toEqual([]);
    expect(tabelas).toEqual(["cliente_marcas"]);
    esquecerMarcas();
  });

  it("com marcas, a tarefa da CME resolve a CME com o kit relido", async () => {
    esquecerMarcas();
    const db: any = {
      from: (t: string) => {
        const c: any = {};
        let porId = "";
        c.select = () => c;
        c.eq = (col: string, v: string) => {
          if (col === "id") porId = v;
          return c;
        };
        c.order = async () => ({ data: [ACERBI, CME], error: null });
        c.maybeSingle = async () => {
          if (t === "tasks") return { data: { project_id: P_CME }, error: null };
          if (t === "cliente_marcas") return { data: porId === ID_CME ? { ...CME, contexto: {}, logo_path: `${CLIENTE}/marcas/${ID_CME}/logo.png` } : null, error: null };
          return { data: null, error: null };
        };
        return c;
      },
    };
    const m = await resolverMarca(db, CLIENTE, { task_id: "22222222-2222-4222-8222-222222222222", marca_id: ID_ACERBI });
    expect(m && m.id).toBe(ID_CME);
    expect(m && m.logo_path).toContain("/marcas/");
    esquecerMarcas();
  });
});

// ------------------------------------------------------------------ contrato

describe("contrato: marca_id em cada ponto de leitura", () => {
  const estudio = ler("supabase/functions/estudio-arte/index.ts");
  const calendario = ler("supabase/functions/agente-calendario/index.ts");
  const ads = ler("supabase/functions/mesa-ads/index.ts");
  const foto = ler("supabase/functions/mesa-foto/index.ts");
  const canvas = ler("supabase/functions/mesa-foto/canvas.ts");
  const modelos = ler("supabase/functions/mesa-foto/modelos.ts");

  it("estudio-arte: kit, fontes, marca da direção, referências e legenda pela marca do trabalho", () => {
    expect(estudio).toContain('from "../_shared/marca.ts"');
    expect(estudio).toContain("async function lerKit(clientId: string, alvo?: AlvoDaMarca): Promise<Kit>");
    expect(estudio).toContain("return kitComMarca((data as Kit) ?? null, marca);");
    expect(estudio).toContain("async function lerFontes(clientId: string, alvo?: AlvoDaMarca): Promise<Fonte[]>");
    expect(estudio).toContain("const alvoDaMarca: AlvoDaMarca = { task_id: item.tarefa.id, marca_id: corpo.marca_id };");
    // nenhum lerKit ou lerFontes do trabalho sem o alvo
    expect(estudio.match(/lerKit\(t\.client_id\)/g)).toBeNull();
    expect(estudio.match(/lerFontes\(t\.client_id\)/g)).toBeNull();
    expect(estudio.match(/lerKit\(t\.client_id, t\)/g)!.length).toBeGreaterThanOrEqual(5);
    expect(estudio).toContain("const marcaDoTrabalho = await marcaDe(t.client_id, t);");
    expect(estudio.match(/filtrarReferenciasDaMarca\(/g)!.length).toBeGreaterThanOrEqual(4);
    expect(estudio).toContain("contextoComMarca(contexto, marcaDaLegenda)");
    expect(estudio).toContain("...marcaParaGravar(await marcaDe(clientId, { marca_id: corpo.marca_id }))");
  });

  it("agente-calendario: contexto, projeto do mês, gravar e direção pela marca", () => {
    expect(calendario).toContain("marcaDoPedido: MarcaDoCliente | null | Promise<MarcaDoCliente | null> = null");
    expect(calendario).toContain("const projectIds = await projetosDoClienteNaMarca(servico, clientId, marca,");
    expect(calendario).toContain("kit_marca: kitComMarca(");
    expect(calendario).toContain("...(ctx.marca ? { marca_deste_conteudo: ctx.marca } : {}),");
    expect(calendario).toContain("if (!projectId && marcaDaProposta?.project_id) projectId = marcaDaProposta.project_id;");
    expect(calendario).toContain("marcaDoGravar?.project_id");
    expect(calendario).toContain("lerMarcaParaDirecaoDaMarca(servico, clientId, m)");
    // todo montarContexto e projetoSocialDoCliente levam a marca
    const semMarca = calendario.split("\n").filter((l) => /montarContexto\(servico, [^)]*\)[,;]/.test(l) && l.indexOf("marca") < 0 && l.indexOf("async function") < 0);
    expect(semMarca).toEqual([]);
    expect(calendario.match(/projetoSocialDoCliente\(servico, (clientId|c\.client_id)\)/g)).toBeNull();
  });

  it("mesa-ads: contexto, pacote, criativos com direcao.marca_id e referência levada ao Estúdio", () => {
    expect(ads).toContain("lerMarcaParaDirecaoDaMarca(servico, clientId, marcaEscolhida)");
    expect(ads.match(/montarContextoAds\(servico, (clientId|p\.client_id)\)/g)).toBeNull();
    expect(ads.match(/contextoDoPacote\(servico, clientId, plano\);/g)).toBeNull();
    expect(ads).toContain("(direcao as Record<string, unknown>).marca_id = marcaDosCriativos.id;");
    expect(ads).toContain("...marcaParaGravar(await marcaDoPedido(servico, clientId, corpo))");
  });

  it("mesa-foto: contexto do diretor, tomada e canvas pela marca", () => {
    expect(foto).toContain("async function contextoDoCliente(clientId: string, campanhaId?: unknown, marcaId?: unknown)");
    expect(foto.match(/contextoDoCliente\(clientId, corpo\.campanha_id\)/g)).toBeNull();
    expect(modelos).toContain("f.contextoDoCliente(clientId, corpo.campanha_id, corpo.marca_id)");
    expect(canvas.match(/f\.contextoDoCliente\([a-z.]+client_id, undefined, corpo\.marca_id\)/g)!.length).toBe(2);
    expect(canvas).toContain("lerMarcaParaDirecaoDaMarca(db(), canvas.client_id, m)");
  });

  it("tela: casca com seletor nas três mesas, marca no endereço e filtros do mês", () => {
    for (const p of ["src/pages/MesaDoCliente.tsx", "src/pages/MesaAds.tsx", "src/pages/MesaFoto.tsx"]) {
      const f = ler(p);
      expect(f).toContain('useMarcaNaCasca(clientId, params.get("marca"))');
      expect(f).toContain("<SeletorDeMarca");
      expect(f).toContain("marcaId={marca ? marca.id : null}");
      expect(f).toContain("marca: null");
    }
    expect(ler("src/lib/mesa/api.ts")).toContain("body: corpoComMarca(funcao, corpo)");
    expect(ler("src/components/mesa/useItensDoMes.ts")).toContain("select: filtro ? daMarca : paraMapas");
    expect(ler("src/components/mesa/useAgendaDoMes.ts")).toContain("...(filtro ? { select: daMarca } : {}),");
    expect(ler("src/components/mesa/AbaContexto.tsx")).toContain("outraMarca ? <ContextoKitDaMarca marca={outraMarca} /> : <ContextoMarca />");
  });
});

describe("SQL das marcas (docs/marcas, não aplicado)", () => {
  const sql = ler("docs/marcas/01_cliente_marcas.sql");
  const dados = ler("docs/marcas/02_dados_acerbi_cme.sql");

  it("tabela com projeto único, uma principal por cliente e vínculo composto nas referências e fontes", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.cliente_marcas");
    expect(sql).toContain("CONSTRAINT cliente_marcas_projeto_unico UNIQUE (project_id)");
    expect(sql).toContain("ON public.cliente_marcas (client_id) WHERE principal;");
    expect(sql).toContain("FOREIGN KEY (marca_id, client_id)");
    expect(sql.match(/ON DELETE SET NULL \(marca_id\)/g)!.length).toBe(2);
    expect(sql).toContain("MARCA_PROJETO_DE_OUTRO_CLIENTE");
  });

  it("RLS igual às tabelas da Mesa: 4 políticas de equipe com acesso ao cliente, nada para anon", () => {
    for (const p of ["equipe_le", "equipe_insere", "equipe_altera", "equipe_apaga"]) expect(sql).toContain(`CREATE POLICY cliente_marcas_${p}`);
    expect(sql.match(/public\.can_access_client\(client_id\)/g)!.length).toBe(5);
    expect(sql).toContain("REVOKE ALL ON TABLE public.cliente_marcas FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("dados da Acerbi idempotentes e presos ao cliente; nada de travessão", () => {
    expect(dados).toContain("39ebda82-637c-498b-a23a-b622f645e852");
    expect(dados.match(/ON CONFLICT DO NOTHING/g)!.length).toBe(2);
    expect(dados).toContain("IF _n <> 1 THEN");
    for (const t of [sql, dados, ler("supabase/functions/_shared/marca.ts"), ler("src/lib/mesa/marcas.ts"), ler("src/components/mesa/SeletorDeMarca.tsx"), ler("src/components/mesa/ContextoKitDaMarca.tsx")]) {
      expect(t.indexOf("—")).toBe(-1);
      expect(t.indexOf("–")).toBe(-1);
    }
  });

  it("Safari 11 e Chrome 64: nada de lookbehind, \\p{}, grupo nomeado, .at(), Object.hasOwn, aspect-ratio ou :has", () => {
    for (const f of ["src/lib/mesa/marcas.ts", "src/components/mesa/SeletorDeMarca.tsx", "src/components/mesa/ContextoKitDaMarca.tsx"]) {
      const t = ler(f);
      expect(t).not.toMatch(/\(\?<[=!]/);
      expect(t).not.toMatch(/\\p\{/);
      expect(t).not.toMatch(/\(\?<[a-zA-Z]/);
      expect(t).not.toMatch(/\.at\(/);
      expect(t).not.toContain("Object.hasOwn");
      expect(t).not.toContain("aspect-");
      expect(t).not.toContain(":has(");
      expect(t).not.toMatch(/\[(min|max|clamp)\(/);
    }
  });
});
