// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avancarSessao,
  catalogoDosEspecialistas,
  convocar,
  type DependenciasDoConselho,
  especialistasDaOrigem,
  ESPECIALISTAS,
  estimarSessao,
  type FalaDoConselho,
  mensagemDaEtapa,
  montarAta,
  type NovaFala,
  type NovaSessao,
  type PedidoDeFala,
  planoDasEtapas,
  sessaoDaLinha,
  type SessaoDoConselho,
  tamanhoDaFala,
  validarConvocacao,
} from "../../supabase/functions/_shared/conselho";
import { MODOS, pautaDaLinha, pautaDoPedido, PRESETS, PRESETS_DO_CONSELHO, rodadasDoModo, textoDaPauta } from "../../supabase/functions/conselho/modulos/conselho-presets";
import { gerarPdfDaAta, nomeDoPdfDaAta } from "../../supabase/functions/conselho/modulos/pdf-ata-do-conselho";
import { paginasDoPdf, textosDoPdf } from "../../supabase/functions/_shared/pdf-base";

/**
 * Frente BRF2: o conselho de agentes mais completo. Presets por tema, modo
 * rápido (1 rodada de propostas e a síntese, barato) contra o profundo, pauta
 * com anexos nos dados de cada fala, ata em PDF pelo pdf-base, e o botão nas
 * mesas novas (Proposta, Identidade, Site e Campanhas).
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const preco = (_m: string, t: { entrada: number; saida: number }) => (t.entrada * 1 + t.saida * 4) / 1e6;
const ELENCO = ["estrategista_marca", "copywriter", "cetico"];
const entrada = (extra: Record<string, unknown> = {}) => ({
  clientId: "c1",
  origem: "mesa-proposta",
  tema: "Proposta da Acerbi",
  pergunta: "Qual escopo e qual argumento a proposta deve ter?",
  especialistas: ELENCO,
  modeloPadrao: "openai:gpt-6-luna",
  rodadas: 4,
  teto_usd: 5,
  ...extra,
});

function montar() {
  const sessoes = new Map<string, SessaoDoConselho>();
  const falas: FalaDoConselho[] = [];
  const pedidos: PedidoDeFala[] = [];
  let n = 0;
  const deps: DependenciasDoConselho = {
    banco: {
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
    },
    falar: async (p) => {
      pedidos.push(p);
      if (p.etapa === "consolidacao") {
        return { custoUsd: 0.01, texto: "", json: { recomendacao: "Escopo em três fases, com a prova do caso anterior.", porque: "Maior nota.", em_aberto: [], proximos_passos: ["Montar a proposta"], acao: { tipo: "nenhuma", rotulo: "", texto: "" } } };
      }
      return { custoUsd: 0.01, texto: "", json: { titulo: `Ideia de ${p.especialista}`, ideia: `Proposta de ${p.especialista}`, porque: "porque", como_executar: ["passo"], riscos: ["risco"], perguntas_em_aberto: [] } };
    },
    jev: async () => ({ custoUsd: 0.0001, answers: { melhor: { choice: "copywriter", probabilities: { estrategista_marca: 0.2, copywriter: 0.7, cetico: 0.1 }, confidence: 0.7 } } }),
    precoDaFala: preco,
    agora: () => new Date("2026-09-30T13:05:00.000Z"),
  };
  return { deps, sessoes, falas, pedidos };
}

describe("presets e modos", () => {
  it("5 presets por tema, só com especialistas que existem e de 3 a 5 critérios", () => {
    expect(PRESETS).toEqual(["marca", "campanha", "proposta", "site", "crise"]);
    const ids = ESPECIALISTAS.map((e) => e.id);
    PRESETS.forEach((id) => {
      const p = PRESETS_DO_CONSELHO[id];
      p.especialistas.forEach((e) => expect(ids, `${id}: ${e}`).toContain(e));
      expect(p.criterios.length).toBeGreaterThanOrEqual(3);
      expect(p.criterios.length).toBeLessThanOrEqual(5);
      expect(JSON.stringify(p)).not.toMatch(/[—–]/);
      // Cabe na convocação de qualquer mesa (o jurídico, que só entra em contrato, não está em preset).
      expect(() => validarConvocacao({ ...entrada(), origem: "mesa-site", especialistas: p.especialistas, modo: p.modo, rodadas: p.rodadas, criterios: p.criterios })).not.toThrow();
    });
    // A gestão de crise é especialista nova e entra em qualquer mesa.
    expect(especialistasDaOrigem("mesa-publicidade").map((e) => e.id)).toContain("gestao_crise");
  });

  it("o catálogo manda os presets (filtrados pela origem) e os modos", () => {
    const cat = catalogoDosEspecialistas("mesa-proposta");
    expect(cat.presets.map((p) => p.id)).toEqual(PRESETS.slice());
    // Frente UXS (CNS-01): cada preset diz a mesa de origem; a Sala da mesma origem começa por ele.
    expect(cat.presets.find((p) => p.id === "proposta")!.origem).toBe("mesa-proposta");
    expect(cat.presets.find((p) => p.id === "crise")!.origem).toBe("painel-crise");
    expect(cat.modos.map((m) => m.id)).toEqual(["rapido", "padrao", "profundo"]);
    expect(cat.modos.find((m) => m.id === "rapido")!.rodadas).toBe(2);
  });

  it("rápido fixa 2 rodadas (propostas e síntese) e custa menos; profundo fixa 4 e custa mais", () => {
    expect(validarConvocacao({ ...entrada(), modo: "rapido", rodadas: 4 }).rodadas).toBe(2);
    expect(validarConvocacao({ ...entrada(), modo: "profundo", rodadas: 2 }).rodadas).toBe(4);
    expect(validarConvocacao({ ...entrada(), rodadas: 3 }).modo).toBe("padrao");
    expect(rodadasDoModo("padrao", 3)).toBe(3);
    const membros = validarConvocacao(entrada()).membros;
    const rapido = estimarSessao(membros, planoDasEtapas(2), preco, membros[0].modelo_id, 1, "rapido").total_usd;
    const padrao = estimarSessao(membros, planoDasEtapas(4), preco, membros[0].modelo_id, 1, "padrao").total_usd;
    const profundo = estimarSessao(membros, planoDasEtapas(4), preco, membros[0].modelo_id, 1, "profundo").total_usd;
    expect(rapido).toBeLessThan(padrao / 2);
    expect(profundo).toBeGreaterThan(padrao);
    expect(tamanhoDaFala("propostas", 3, "rapido").saida).toBeLessThanOrEqual(MODOS.rapido.maxSaida);
  });

  it("modo rápido roda do começo ao fim em 2 rodadas, com o pedido curto", async () => {
    const m = montar();
    const { sessao } = await convocar(m.deps, { ...entrada(), modo: "rapido", teto_usd: 2 });
    expect(sessao.modo).toBe("rapido");
    expect(sessao.rodadas).toBe(2);
    for (let i = 0; i < 10; i++) {
      const r = await avancarSessao(m.deps, { ...m.sessoes.get(sessao.id)! }, null);
      if (!r.continuar) break;
    }
    const fim = m.sessoes.get(sessao.id)!;
    expect(fim.status).toBe("concluida");
    expect(m.pedidos.filter((p) => p.etapa === "propostas")).toHaveLength(3);
    expect(m.pedidos.some((p) => p.etapa === "critica")).toBe(false);
    expect(m.pedidos[0].mensagem).toContain("MODO RÁPIDO");
    expect(fim.resultado!.recomendacao).toContain("três fases");
  });
});

describe("pauta com anexos", () => {
  it("o pedido limita itens e anexos; a pauta entra nos dados de cada fala e na ata", async () => {
    const pedido = pautaDoPedido({ itens: ["Preço", " ", "Prazo — de entrega", ...Array.from({ length: 12 }, (_, i) => `item ${i}`)], anexos: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "x", { file_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }] });
    expect(pedido.itens).toHaveLength(8);
    expect(pedido.itens[1]).toBe("Prazo , de entrega");
    expect(pedido.anexos).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
    const pauta = pautaDaLinha({ itens: ["Preço", "Prazo"], anexos: [{ file_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nome: "briefing.pdf", trecho: "O cliente quer vender mais no Natal." }] });
    expect(textoDaPauta(pauta)).toContain("1. Preço");
    expect(textoDaPauta({ itens: [], anexos: [] })).toBe("");
    const m = montar();
    const { sessao } = await convocar(m.deps, { ...entrada(), pauta });
    const msg = mensagemDaEtapa(sessao, "copywriter", "propostas", [], 1);
    expect(msg).toContain("PAUTA");
    expect(msg).toContain("O cliente quer vender mais no Natal.");
    const ata = montarAta(sessao, [], { cliente: "Acerbi" });
    expect(ata).toContain("- Pauta: Preço; Prazo");
    expect(ata).toContain("- Modo: Padrão");
    // Linha antiga (sem as colunas novas) lê como padrão e sem pauta.
    const antiga = sessaoDaLinha({ id: "s", client_id: "c", tema: "t", pergunta: "p", especialistas: [], rodadas: 4 });
    expect(antiga.modo).toBe("padrao");
    expect(antiga.pauta).toEqual({ itens: [], anexos: [] });
  });
});

describe("ata em PDF", () => {
  it("sai pelo pdf-base com a pergunta, a recomendação, as divergências e quem disse o quê", async () => {
    const m = montar();
    const { sessao } = await convocar(m.deps, { ...entrada(), modo: "rapido", teto_usd: 2 });
    for (let i = 0; i < 10; i++) {
      const r = await avancarSessao(m.deps, { ...m.sessoes.get(sessao.id)! }, null);
      if (!r.continuar) break;
    }
    const fim = m.sessoes.get(sessao.id)!;
    const bytes = gerarPdfDaAta(fim, m.falas, { cliente: "Acerbi Pernil", modelos: { "openai:gpt-6-luna": "GPT-6 Luna" } });
    const tudo = textosDoPdf(bytes).join(" ");
    for (const t of ["Proposta da Acerbi", "Qual escopo e qual argumento a proposta deve ter?", "GPT-6 Luna", "Escopo em três fases", "DIVERGÊNCIAS", "Quem disse o quê", "Proposta de copywriter", "Ainda não decidida."]) expect(tudo, t).toContain(t);
    expect(tudo).not.toMatch(/[—–]/);
    expect(paginasDoPdf(bytes)).toBeGreaterThanOrEqual(3);
    expect(nomeDoPdfDaAta({ criado_em: "2026-09-30T13:00:00Z", tema: "Proposta da Açaí & Cia" })).toBe("ata-conselho-2026-09-30-proposta-da-acai-cia.pdf");
  });
});

describe("ligações do conselho", () => {
  it("a função tem elencos, ata_pdf e o modo no pedido; a migração só amplia com RLS", () => {
    const fn = ler("supabase/functions/conselho/index.ts");
    expect(fn).toContain("ata_pdf: (ch, corpo) => ataEmPdf(ctxDe(ch), corpo)");
    expect(fn).toContain("salvar_elenco");
    expect(fn).toContain("modo: modoDe(corpo.modo)");
    expect(fn).toContain("MODOS[p.sessao.modo || \"padrao\"].maxSaida");
    const extras = ler("supabase/functions/conselho/extras.ts");
    // Anexo da pauta só do próprio cliente, fora de quarentena e sem ser sensível.
    expect(extras).toContain("f.client_id === clientId && f.status !== \"quarantined\"");
    expect(extras).toContain('folder: "operacionais"');
    const sql = ler("supabase/migrations/20260930196200_conselho_evolucao.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM/i);
  });

  it("o botão do conselho está nas mesas novas, com a origem de cada uma", () => {
    for (const [arq, origem] of [["MesaProposta", "mesa-proposta"], ["MesaIdentidade", "mesa-identidade"], ["MesaSite", "mesa-site"], ["MesaPublicidade", "mesa-publicidade"]]) {
      const f = ler(`src/pages/${arq}.tsx`);
      expect(f, arq).toContain("<BotaoDoConselho");
      expect(f, arq).toContain(`origem="${origem}"`);
      expect(f, arq).toContain("onUsar={(t) => setRascunhoDoAgente(t)}");
    }
  });
});
