import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avancarSessao,
  convocar,
  decisaoDoDono,
  type DependenciasDoConselho,
  divergenciasDasNotas,
  entregaParaDocumento,
  ErroDoConselho,
  type FalaDoConselho,
  LIMITES,
  medirConsenso,
  montarAta,
  type NovaFala,
  type NovaSessao,
  type PedidoDeFala,
  planejarNovaRodada,
  planoDasEtapas,
  type SessaoDoConselho,
  validarConvocacao,
} from "../../supabase/functions/conselho/modulos/conselho";

/**
 * Conselho de agentes (frente CNS, 30/09): o núcleo roda inteiro com banco,
 * modelo e Jev falsos. Cobra as promessas do pedido do dono:
 * - rodada 1 independente (ninguém vê a proposta do outro);
 * - teto de custo (recusa antes e para no meio sem passar);
 * - consenso medido pelo Jev (e sem Jev, pelas notas, com aviso);
 * - divergências à vista;
 * - ata com quem disse o quê e a decisão do dono.
 */

const ELENCO = ["estrategista_marca", "copywriter", "especialista_nicho", "cetico"];

type Chamada = PedidoDeFala & { ordem: number };

function bancoFalso() {
  const sessoes = new Map<string, SessaoDoConselho>();
  const falas: FalaDoConselho[] = [];
  let n = 0;
  const banco: DependenciasDoConselho["banco"] = {
    criarSessao: async (linha: NovaSessao) => {
      const s: SessaoDoConselho = { ...linha, id: `s${++n}`, criado_em: "2026-09-30T13:00:00.000Z", concluido_em: null, resultado: null, decisao: null, ata: null, memoria_id: null, erro_codigo: null, erro_mensagem: null, aviso: null };
      sessoes.set(s.id, s);
      return { ...s };
    },
    lerFalas: async (id) => falas.filter((f) => f.sessao_id === id).map((f) => ({ ...f })),
    inserirFalas: async (linhas: NovaFala[]) =>
      linhas.map((l) => {
        const f: FalaDoConselho = { ...l, id: `f${++n}`, pedido: l.pedido || null, conteudo: null, texto: null, notas: null, custo_usd: 0, tentativas: 0, erro_codigo: null, erro_mensagem: null, criado_em: new Date(Date.UTC(2026, 8, 30, 13, 0, n)).toISOString() };
        falas.push(f);
        return { ...f };
      }),
    atualizarFala: async (id, campos) => {
      const f = falas.find((x) => x.id === id);
      if (f) Object.assign(f, campos);
    },
    atualizarSessao: async (id, campos) => {
      const s = sessoes.get(id);
      if (!s) return false;
      Object.assign(s, campos);
      return true;
    },
  };
  return { banco, sessoes, falas };
}

/** Notas que cada crítico dá: o cético derruba a proposta do estrategista (divergência de propósito). */
function notaDe(critico: string, alvo: string): number {
  if (alvo === "estrategista_marca") return critico === "cetico" ? 2 : 9;
  if (alvo === "copywriter") return critico === "cetico" ? 8 : 6;
  return 5;
}
const PREFERIDA: Record<string, string> = { estrategista_marca: "copywriter", copywriter: "estrategista_marca", especialista_nicho: "estrategista_marca", cetico: "copywriter" };

function falarFalso(chamadas: Chamada[], opcoes: { custo?: (p: PedidoDeFala) => number } = {}) {
  let ordem = 0;
  return async (p: PedidoDeFala) => {
    chamadas.push({ ...p, ordem: ++ordem });
    const custoUsd = opcoes.custo ? opcoes.custo(p) : 0.01;
    if (p.etapa === "propostas" || p.etapa === "revisao") {
      return {
        custoUsd,
        texto: "",
        json: {
          titulo: `Ideia de ${p.especialista}`,
          ideia: `MARCA_${p.especialista} proposta ${p.etapa}`,
          porque: "porque sim",
          como_executar: ["passo 1"],
          riscos: ["risco 1"],
          perguntas_em_aberto: [],
          mudou: p.etapa === "revisao" ? "ajustei pela crítica" : undefined,
          mantenho_discordancia: p.etapa === "revisao" && p.especialista === "cetico" ? "a premissa do estrategista não tem prova" : "",
        },
      };
    }
    if (p.etapa === "critica") {
      // Os apelidos que a mensagem mostrou ([p1], [p2]...) viram as avaliações.
      const apelidos = (p.mensagem.match(/\[p\d\]/g) || []).map((a) => a.slice(1, -1));
      const ordemDoElenco = p.sessao.especialistas.map((m) => m.id);
      const idDoApelido = (a: string) => ordemDoElenco[Number(a.slice(1)) - 1];
      const pref = PREFERIDA[p.especialista];
      const aPref = apelidos.find((a) => idDoApelido(a) === pref) || "";
      return {
        custoUsd,
        texto: "",
        json: {
          avaliacoes: apelidos.map((a) => ({
            proposta: a,
            notas: p.sessao.criterios.map((c) => ({ criterio: c, nota: notaDe(p.especialista, idDoApelido(a)) })),
            forte: "forte",
            fraco: "fraco",
          })),
          preferida: aPref,
          comentario: `comentário de ${p.especialista}`,
        },
      };
    }
    return {
      custoUsd,
      texto: "",
      json: {
        recomendacao: "Seguir a ideia do estrategista com o texto do copywriter.",
        porque: "Maior nota do Jev e dois de três críticos preferiram.",
        em_aberto: ["Confirmar o preço com o cliente"],
        proximos_passos: ["Montar a peça"],
        acao: { tipo: "usar_na_mesa", rotulo: "Levar para o agente", texto: "Gerar o roteiro com a ideia vencedora" },
      },
    };
  };
}

const jevFalso = async () => ({
  custoUsd: 0.0001,
  answers: {
    melhor: { choice: "estrategista_marca", probabilities: { estrategista_marca: 0.7, copywriter: 0.2, especialista_nicho: 0.05, cetico: 0.05 }, confidence: 0.7 },
    nota_estrategista_marca: { score: 8 },
    nota_copywriter: { score: 6 },
    nota_especialista_nicho: { score: 4 },
    nota_cetico: { score: 3 },
  },
});

/** Preço pela tabela falsa: US$ 1 por milhão de tokens de entrada e US$ 4 por milhão de saída. */
const preco = (_m: string, t: { entrada: number; saida: number }) => (t.entrada * 1 + t.saida * 4) / 1e6;

function montar(opcoes: { jev?: DependenciasDoConselho["jev"]; custo?: (p: PedidoDeFala) => number } = {}) {
  const b = bancoFalso();
  const chamadas: Chamada[] = [];
  const deps: DependenciasDoConselho = {
    banco: b.banco,
    falar: falarFalso(chamadas, { custo: opcoes.custo }),
    jev: opcoes.jev || jevFalso,
    precoDaFala: preco,
    paraTudo: (e) => !!e && typeof e === "object" && (e as { codigo?: string }).codigo === "saldo_insuficiente",
    agora: () => new Date("2026-09-30T13:05:00.000Z"),
  };
  return { ...b, chamadas, deps };
}

const entrada = (extra: Partial<Parameters<typeof convocar>[1]> = {}) => ({
  clientId: "c1",
  origem: "mesa-roteiros",
  tema: "Série de vídeos de outubro",
  pergunta: "Qual série de vídeos curtos a marca deve gravar em outubro?",
  contextoCliente: "Clínica de estética em Curitiba.",
  especialistas: ELENCO,
  modeloPadrao: "openai:gpt-6-luna",
  rodadas: 4,
  teto_usd: 5,
  ...extra,
});

async function rodarAteParar(m: ReturnType<typeof montar>, sessaoId: string, maxPassos = 40) {
  let passos = 0;
  for (;;) {
    const s = { ...m.sessoes.get(sessaoId)! };
    const r = await avancarSessao(m.deps, s, null);
    passos += 1;
    if (!r.continuar || passos >= maxPassos) break;
  }
  return { sessao: m.sessoes.get(sessaoId)!, passos };
}

describe("conselho: rodadas", () => {
  it("rodadas são fixas: 2, 3 ou 4, e cada extra acrescenta crítica, revisão e consolidação", () => {
    expect(planoDasEtapas(2)).toEqual(["propostas", "consolidacao"]);
    expect(planoDasEtapas(3)).toEqual(["propostas", "critica", "consolidacao"]);
    expect(planoDasEtapas(4)).toEqual(["propostas", "critica", "revisao", "consolidacao"]);
    expect(planoDasEtapas(4, 1).length).toBe(7);
    expect(planoDasEtapas(4, 9).length).toBe(4 + 3 * LIMITES.MAX_RODADAS_EXTRAS);
    expect(() => validarConvocacao({ ...entrada(), rodadas: 7 })).toThrow(ErroDoConselho);
  });

  it("rodada 1 é independente: ninguém vê a proposta nem a persona do outro, e todas nascem na fila juntas", async () => {
    const m = montar();
    const { sessao, falas } = await convocar(m.deps, entrada());
    expect(falas.map((f) => f.especialista)).toEqual(ELENCO);
    expect(falas.every((f) => f.status === "fila" && f.rodada === 1)).toBe(true);
    await rodarAteParar(m, sessao.id);
    const rodada1 = m.chamadas.filter((c) => c.etapa === "propostas");
    expect(rodada1.length).toBe(ELENCO.length);
    rodada1.forEach((c) => {
      const outros = ELENCO.filter((e) => e !== c.especialista);
      outros.forEach((o) => {
        expect(c.mensagem).not.toContain(`MARCA_${o}`);
        expect(c.mensagem).not.toContain(`Ideia de ${o}`);
      });
      // A mensagem da rodada 1 é a mesma para todos (só os dados e a pergunta).
      expect(c.mensagem).toBe(rodada1[0].mensagem);
      expect(c.sistema).toContain(c.esquema ? "JSON" : "");
    });
    // A persona de um não vaza no sistema do outro.
    const doCetico = rodada1.find((c) => c.especialista === "cetico")!;
    expect(doCetico.sistema).toContain("Cético");
    expect(doCetico.sistema).not.toContain("Copywriter do conselho");
    // Paralelo com teto: o primeiro passo fala no máximo FALAS_POR_PASSO de uma vez.
    expect(LIMITES.FALAS_POR_PASSO).toBeLessThan(ELENCO.length);
  });

  it("crítica cruzada vê as outras propostas anônimas; revisão vê as críticas; o moderador consolida", async () => {
    const m = montar();
    const { sessao } = await convocar(m.deps, entrada());
    const fim = await rodarAteParar(m, sessao.id);
    expect(fim.sessao.status).toBe("concluida");
    expect(fim.sessao.etapa).toBe("fim");
    const critica = m.chamadas.find((c) => c.etapa === "critica" && c.especialista === "copywriter")!;
    expect(critica.mensagem).toContain("MARCA_estrategista_marca");
    expect(critica.mensagem).not.toContain("[Estrategista de marca]");
    expect(critica.mensagem).toContain("SUA PROPOSTA (não avalie a sua)");
    const revisao = m.chamadas.find((c) => c.etapa === "revisao" && c.especialista === "estrategista_marca")!;
    expect(revisao.mensagem).toContain("CRÍTICAS QUE ELA RECEBEU");
    expect(revisao.mensagem).toContain("Cético");
    expect(m.chamadas.filter((c) => c.etapa === "consolidacao").length).toBe(1);
    // Nenhuma fala repetida: 4 propostas + 4 críticas + 4 revisões + 1 moderador.
    expect(m.chamadas.length).toBe(13);
  });
});

describe("conselho: teto de custo", () => {
  it("recusa convocar com teto abaixo do custo estimado", async () => {
    const m = montar();
    await expect(convocar(m.deps, entrada({ teto_usd: 0.01 }))).rejects.toMatchObject({ codigo: "teto_abaixo_da_estimativa" });
    expect(m.sessoes.size).toBe(0);
  });

  it("para no teto no meio da sessão, sem começar fala que passaria dele", async () => {
    // Cada fala custa de verdade o triplo da estimativa: o teto chega antes do fim.
    const m = montar({ custo: (p) => 3 * preco("", p.etapa === "consolidacao" ? { entrada: 8300, saida: 3500 } : { entrada: 10_000, saida: 3500 }) });
    const { sessao, estimativa } = await convocar(m.deps, entrada({ teto_usd: Math.ceil(estimativa_de_teste() * 100) / 100 }));
    expect(estimativa.total_usd).toBeGreaterThan(0);
    const fim = await rodarAteParar(m, sessao.id);
    expect(fim.sessao.status).toBe("teto");
    expect(fim.sessao.aviso).toContain("teto");
    const puladas = m.falas.filter((f) => f.status === "pulada");
    expect(puladas.length).toBeGreaterThan(0);
    expect(puladas.every((f) => f.erro_codigo === "teto")).toBe(true);
    // Menos chamadas que a sessão inteira (13) e nenhuma consolidação paga depois do teto.
    expect(m.chamadas.length).toBeLessThan(13);
  });
});

/** A estimativa da sessão padrão (4 especialistas, 4 rodadas) pela tabela falsa. */
function estimativa_de_teste(): number {
  const n = ELENCO.length;
  const f = (e: number, s: number) => preco("", { entrada: e, saida: s });
  return n * f(7000, 3500) + n * f(7000 + 900 * n, 3000) + n * f(8500 + 700 * n, 3500) + f(3500 + 1200 * n, 3500) + 0.002;
}

describe("conselho: consenso pelo Jev e divergências", () => {
  it("o Jev escolhe a vencedora e mede o consenso junto com as preferências da crítica", async () => {
    const m = montar();
    const { sessao } = await convocar(m.deps, entrada());
    const fim = await rodarAteParar(m, sessao.id);
    const r = fim.sessao.resultado!;
    expect(r.fonte).toBe("jev");
    expect(r.vencedor).toBe("estrategista_marca");
    expect(r.ranking[0].especialista).toBe("estrategista_marca");
    expect(r.ranking[0].nota_jev).toBe(9);
    expect(r.ranking[1].especialista).toBe("copywriter");
    // Críticos fora a vencedora: copywriter e nicho preferiram a vencedora; o cético, não.
    expect(r.acordo).toBeCloseTo(2 / 3, 3);
    expect(r.consenso).toBeCloseTo(0.5 * 0.7 + 0.5 * (2 / 3), 2);
    expect(r.nivel).toBe("medio");
    expect(r.recomendacao).toContain("estrategista");
    expect(r.em_aberto).toEqual(["Confirmar o preço com o cliente"]);
    expect(r.acao.tipo).toBe("usar_na_mesa");
  });

  it("as divergências ficam à vista: nota distante, preferência diferente e o que cada um mantém", async () => {
    const m = montar();
    const { sessao } = await convocar(m.deps, entrada());
    const r = (await rodarAteParar(m, sessao.id)).sessao.resultado!;
    const tipos = r.divergencias.map((d) => d.tipo);
    expect(tipos).toContain("nota");
    expect(tipos).toContain("preferencia");
    expect(tipos).toContain("mantida");
    const nota = r.divergencias.find((d) => d.tipo === "nota" && d.proposta === "estrategista_marca")!;
    expect(nota.diferenca).toBe(7);
    expect(nota.texto).toContain("Cético deu 2");
    expect(r.divergencias.find((d) => d.tipo === "preferencia")!.texto).toContain("Cético prefere a proposta de Copywriter");
  });

  it("sem Jev, o consenso sai das notas da crítica e a tela recebe o aviso", async () => {
    const m = montar({ jev: async () => { throw new Error("jev fora do ar"); } });
    const { sessao } = await convocar(m.deps, entrada());
    const r = (await rodarAteParar(m, sessao.id)).sessao.resultado!;
    expect(r.fonte).toBe("notas");
    expect(r.aviso).toContain("Jev não respondeu");
    expect(r.ranking.every((l) => l.nota_jev === null)).toBe(true);
  });

  it("divergenciasDasNotas só marca diferença de 3 pontos ou mais no mesmo critério", () => {
    const d = divergenciasDasNotas([
      { autor: "copywriter", alvo: "cetico", criterio: "viável", nota: 7 },
      { autor: "especialista_nicho", alvo: "cetico", criterio: "viável", nota: 5 },
      { autor: "copywriter", alvo: "ux", criterio: "impacto", nota: 9 },
      { autor: "cetico", alvo: "ux", criterio: "impacto", nota: 4 },
    ]);
    expect(d.length).toBe(1);
    expect(d[0].proposta).toBe("ux");
  });

  it("Jev contra as notas vira divergência", () => {
    const sessao = { especialistas: [{ id: "a", nome: "A", modelo_id: "m" }, { id: "b", nome: "B", modelo_id: "m" }], criterios: ["x", "y", "z"] } as unknown as SessaoDoConselho;
    const fala = (id: string) => ({ id, especialista: id, conteudo: { titulo: id }, status: "feita" } as unknown as FalaDoConselho);
    const r = medirConsenso({
      sessao,
      finais: { a: fala("a"), b: fala("b") },
      notas: [{ autor: "a", alvo: "b", criterio: "x", nota: 9 }, { autor: "b", alvo: "a", criterio: "x", nota: 3 }],
      preferidas: { a: "b", b: "a" },
      jev: { answers: { melhor: { choice: "a", probabilities: { a: 0.6, b: 0.4 } } } },
    });
    expect(r.vencedor).toBe("a");
    expect(r.divergencias.some((d) => d.tipo === "jev_x_notas")).toBe(true);
  });
});

describe("conselho: decisão, ata e documento", () => {
  it("a ata traz quem disse o quê, notas, consenso, divergências e a decisão do dono, sem travessão", async () => {
    const m = montar();
    const { sessao } = await convocar(m.deps, entrada());
    const s = (await rodarAteParar(m, sessao.id)).sessao;
    const decisao = decisaoDoDono(s, m.falas, { escolha: "proposta", especialista: "copywriter", nota: "Gosto mais do texto", por: "u1", porNome: "Almir", em: "2026-09-30T14:00:00.000Z" });
    const ata = montarAta({ ...s, decisao }, m.falas, { cliente: "Clínica X", modelos: { "openai:gpt-6-luna": "GPT-6 Luna" } });
    expect(ata).toContain("# Ata do conselho: Série de vídeos de outubro");
    expect(ata).toContain("## Rodada 1: Propostas independentes");
    expect(ata).toContain("## Rodada 2: Crítica cruzada");
    expect(ata).toContain("### Cético");
    expect(ata).toContain("MARCA_copywriter");
    expect(ata).toContain("Proposta de Estrategista de marca");
    expect(ata).toContain("## Divergências");
    expect(ata).toContain("Consenso");
    expect(ata).toContain("GPT-6 Luna");
    expect(ata).toContain("Almir decidiu seguir a proposta de Copywriter");
    expect(ata).toContain("Gosto mais do texto");
    expect(ata).not.toMatch(/\u2014|\u2013/);
    const doc = entregaParaDocumento({ ...s, decisao });
    expect(doc.tipo).toBe("conselho");
    expect(doc.provas.map((p) => p.rotulo)).toEqual(expect.arrayContaining(["Sessão", "Consenso", "Divergências", "Decisão"]));
  });

  it("decidir exige resultado e proposta que existe; nova rodada só depois de concluir, no máximo 2", async () => {
    const m = montar();
    const { sessao } = await convocar(m.deps, entrada());
    expect(() => decisaoDoDono(m.sessoes.get(sessao.id)!, m.falas, { escolha: "recomendacao", por: null, porNome: null, em: "x" })).toThrow(/ainda não chegou/);
    expect(() => planejarNovaRodada(m.sessoes.get(sessao.id)!, m.falas, preco)).toThrow(/Nova rodada só depois/);
    const s = (await rodarAteParar(m, sessao.id)).sessao;
    expect(() => decisaoDoDono(s, m.falas, { escolha: "proposta", especialista: "ux", por: null, porNome: null, em: "x" })).toThrow(/não existe/);
    const plano = planejarNovaRodada(s, m.falas, preco);
    expect(plano.etapas.slice(-3)).toEqual(["critica", "revisao", "consolidacao"]);
    expect(plano.estimativa.por_rodada.map((r) => r.rodada)).toEqual([5, 6, 7]);
    expect(() => planejarNovaRodada({ ...s, rodadas_extras: 2 }, m.falas, preco)).toThrow(/rodadas extras/);
  });

  it("o jurídico só entra em sessão de contrato", () => {
    expect(() => validarConvocacao({ ...entrada(), especialistas: ["juridico", "cetico"] })).toThrow(/só entra/);
    expect(validarConvocacao({ ...entrada(), origem: "mesa-contrato", especialistas: ["juridico", "cetico"] }).membros.length).toBe(2);
  });
});

describe("conselho: ligações", () => {
  const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

  it("a função é registrada, a migração tem RLS por cliente e as mesas abrem o conselho", () => {
    expect(ler("supabase/config.toml")).toContain("[functions.conselho]\n    verify_jwt = true");
    const sql = ler("supabase/migrations/20260930050000_conselho_de_agentes.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).toContain("REVOKE ALL ON public.conselho_falas FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.conselho_pegar_passo(uuid, uuid, integer) TO service_role");
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*TO authenticated/);
    expect(ler("src/pages/MesaDoCliente.tsx")).toContain("<BotaoDoConselho");
    expect(ler("src/pages/MesaRoteiros.tsx")).toContain('origem="mesa-roteiros"');
    const fn = ler("supabase/functions/conselho/index.ts");
    expect(fn).toContain('kind: "decisao"');
    expect(fn).toContain("documento_de_entrega");
    expect(fn).toContain("respostaComFolego");
    // Papel "conselho" da frente BASE na carteira e na conversa gravada.
    expect(fn).toContain('const PAPEL = "conselho"');
    expect(fn).toContain("modeloDoPapel(PAPEL)");
    expect(fn).toContain("gravarTroca(db,");
  });
});
