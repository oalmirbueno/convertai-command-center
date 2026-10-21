import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ATALHOS_DE_PROJETO_COMPLETO,
  ENTRADAS_EXTRAS_V4,
  GATILHOS,
  GATILHOS_DA_ORIGEM,
  OPCOES_DA_V4,
  TIPOS_DA_V4,
  TIPOS_DE_NO as TIPOS_DA_TELA,
  aplicarOperacoes as aplicarNaTela,
  canvasVazio,
  criarNo,
  definirGatilho,
  ehProjetoCompleto,
  ligar,
  normalizarCanvas as normalizarNaTela,
  normalizarOperacao,
  podeLigar,
  type CanvasDoLab,
  type TipoDeNo,
} from "@/lib/laboratorio/nos";
import { ICONES_DOS_NOS } from "@/components/laboratorio/icones";
import SeletorDeGatilho from "@/components/laboratorio/SeletorDeGatilho";
import {
  dadosDoTipo,
  ENTRADAS_EXTRAS_V4 as EXTRAS_DA_FUNCAO,
  errosDoCanvas,
  GATILHOS as GATILHOS_DA_FUNCAO,
  GATILHOS_DA_ORIGEM as ORIGENS_DA_FUNCAO,
  NOS_DA_V4,
  NOS_ESTATICOS,
  normalizarCanvas,
  OBJETIVOS_DA_PAGINA,
  OPCOES_V4,
  TIPOS_DA_PAGINA_DO_FUNIL,
  TIPOS_DE_NO,
} from "../../supabase/functions/laboratorio/modulos/regras";
import { CATEGORIA_DOS_OFICIAIS, CATEGORIAS_DOS_TEMPLATES, TEMPLATES_OFICIAIS_V4 } from "../../supabase/functions/laboratorio/modulos/templates";

/**
 * Laboratório v4 (ESPEC-LABORATORIO-v4.md): os 22 nós novos iguais na tela e na função, o gatilho na
 * ligação do funil e os 25 templates da migration 20261020060000_laboratorio_v4.sql (todas as ligações
 * passam no podeLigar da tela e no errosDoCanvas da função, com categoria).
 */
const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const SQL = ler("supabase/migrations/20261020060000_laboratorio_v4.sql");

type LinhaDaSemente = { id: string; nome: string; descricao: string; icone: string; canvas: unknown; categoria: string };

/** As linhas do INSERT da semente, lidas do próprio arquivo da migration. */
function sementeDaMigration(): LinhaDaSemente[] {
  const q = "'((?:[^']|'')*)'";
  const re = new RegExp(`^\\s*\\('([0-9a-f-]{36})'::uuid, ${q}, ${q}, ${q}, ${q}::jsonb, true, ${q}\\),?$`);
  const des = (s: string) => s.replace(/''/g, "'");
  return SQL.split("\n")
    .map((l) => re.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ id: m[1], nome: des(m[2]), descricao: des(m[3]), icone: des(m[4]), canvas: JSON.parse(des(m[5])), categoria: des(m[6]) }));
}

describe("v4: nós novos iguais na tela e na função", () => {
  it("os 22 tipos novos estão nos dois lados, na mesma ordem, com ícone, grupo e cor", () => {
    expect(TIPOS_DA_V4).toEqual([...TIPOS_DE_NO].slice(25));
    expect(TIPOS_DA_V4).toHaveLength(22);
    for (const t of TIPOS_DA_V4) {
      const def = TIPOS_DA_TELA[t];
      expect(def.tipo).toBe(t);
      expect(def.grupo, t).toBeTruthy();
      expect(def.cor, t).toMatch(/^#[0-9a-f]{6}$/);
      expect(ICONES_DOS_NOS[t], t).toBeTruthy();
      // Roda na tela = executável na função; estático na função = não roda na tela.
      expect(def.roda, t).toBe(NOS_DA_V4.indexOf(t) >= 0);
      if ((NOS_ESTATICOS as readonly string[]).indexOf(t) >= 0) expect(def.roda).toBe(false);
    }
  });

  it("as entradas extras dos tipos antigos são as mesmas nos dois lados", () => {
    expect(Object.keys(ENTRADAS_EXTRAS_V4).sort()).toEqual(Object.keys(EXTRAS_DA_FUNCAO).sort());
    for (const t of Object.keys(ENTRADAS_EXTRAS_V4) as TipoDeNo[]) expect([...(ENTRADAS_EXTRAS_V4[t] || [])].sort(), t).toEqual([...(EXTRAS_DA_FUNCAO[t] || [])].sort());
  });

  it("toda opção de escolha dos nós novos é aceita pela função (e as listas batem)", () => {
    const valores = (k: keyof typeof OPCOES_DA_V4) => OPCOES_DA_V4[k].map((o) => o.valor);
    for (const k of Object.keys(OPCOES_V4)) {
      if (k === "via") continue;
      if (k === "crm_origem") {
        const campo = TIPOS_DA_TELA.crm.campos.find((c) => c.chave === "crm_origem")!;
        expect(campo.opcoes?.map((o) => o.valor), k).toEqual([...OPCOES_V4[k]]);
        continue;
      }
      expect(valores(k as keyof typeof OPCOES_DA_V4), k).toEqual([...OPCOES_V4[k]]);
    }
    expect([...valores("via_whatsapp"), ...valores("via_recuperacao")].sort()).toEqual([...OPCOES_V4.via].sort());
    expect(valores("tipo_pagina")).toEqual([...TIPOS_DA_PAGINA_DO_FUNIL]);
    expect(valores("objetivo_pagina")).toEqual([...OBJETIVOS_DA_PAGINA]);
    for (const t of TIPOS_DA_V4) {
      for (const campo of TIPOS_DA_TELA[t].campos) {
        if (campo.tipo !== "escolha") continue;
        for (const o of campo.opcoes || []) expect(dadosDoTipo(t, { [campo.chave]: o.valor }).ignorados, `${t}.${campo.chave}=${o.valor}`).toEqual([]);
      }
    }
  });

  it("os gatilhos e de onde cada um sai são os mesmos nos dois lados", () => {
    expect(GATILHOS.map((g) => g.valor)).toEqual([...GATILHOS_DA_FUNCAO]);
    expect(Object.keys(GATILHOS_DA_ORIGEM).sort()).toEqual(Object.keys(ORIGENS_DA_FUNCAO).sort());
    for (const t of Object.keys(GATILHOS_DA_ORIGEM) as TipoDeNo[]) expect(GATILHOS_DA_ORIGEM[t], t).toEqual([...(ORIGENS_DA_FUNCAO[t] || [])]);
  });

  it("os atalhos novos (webinar, quiz, lançamento, checkout com upsell) pedem o projeto completo", () => {
    for (const a of ["webinar", "quiz", "lancamento", "checkout_upsell"]) {
      expect(ATALHOS_DE_PROJETO_COMPLETO).toContain(a);
      expect(ehProjetoCompleto("", a, 10)).toBe(true);
    }
    expect(ehProjetoCompleto("quero um webinar para vender minha mentoria", null, 0)).toBe(true);
  });
});

describe("v4: gatilho na ligação do funil", () => {
  const base = (): CanvasDoLab => {
    let c = canvasVazio();
    c = criarNo(c, "pagina", undefined, { tipo_pagina: "vendas" }, "p").canvas;
    c = criarNo(c, "checkout", undefined, undefined, "k").canvas;
    c = criarNo(c, "recuperacao", undefined, undefined, "r").canvas;
    return c;
  };

  it("ligar com gatilho guarda só o que a origem tem; definirGatilho troca e tira", () => {
    let c = ligar(base(), "p", "k", "clicou_botao");
    expect(c.ligacoes[0].gatilho).toBe("clicou_botao");
    c = ligar(c, "k", "r", "enviou_formulario");
    expect(c.ligacoes[1].gatilho).toBeUndefined();
    c = definirGatilho(c, c.ligacoes[1].id, "carrinho_abandonado");
    expect(c.ligacoes[1].gatilho).toBe("carrinho_abandonado");
    c = definirGatilho(c, c.ligacoes[1].id, "upsell_aceito");
    expect(c.ligacoes[1].gatilho).toBeUndefined();
    // A função aceita o mesmo canvas (gatilho incluído).
    expect(errosDoCanvas(normalizarCanvas(definirGatilho(c, c.ligacoes[1].id, "pix_gerado")))).toEqual([]);
  });

  it("o gatilho atravessa a leitura do banco e as operações do agente", () => {
    const lido = normalizarNaTela({ nos: base().nos, ligacoes: [{ id: "l1", de: "p", para: "k", gatilho: "clicou_botao" }, { id: "l2", de: "k", para: "r", gatilho: "faixa_alta" }] });
    expect(lido.ligacoes.map((l) => l.gatilho || null)).toEqual(["clicou_botao", null]);
    const op = normalizarOperacao({ indice: 0, op: "ligar", aceita: true, recibo: "Liguei", operacao: { op: "ligar", de: "k", para: "r", gatilho: "carrinho_abandonado" } });
    expect(op && op.gatilho).toBe("carrinho_abandonado");
    const r = aplicarNaTela(base(), [op!]);
    expect(r.canvas.ligacoes[0].gatilho).toBe("carrinho_abandonado");
  });

  it("o seletor no inspetor mostra só os gatilhos da origem e devolve a escolha", () => {
    const mudou = vi.fn();
    render(<SeletorDeGatilho id="g1" ligacao={{ id: "l1", de: "k", para: "r" }} tipoDaOrigem="checkout" onMudar={mudou} />);
    const select = screen.getByLabelText("Quando") as HTMLSelectElement;
    const opcoes = Array.prototype.map.call(select.options, (o: HTMLOptionElement) => o.value);
    expect(opcoes).toEqual(["", "visitou", "clicou_botao", "compra_aprovada", "compra_recusada", "carrinho_abandonado", "pix_gerado"]);
    fireEvent.change(select, { target: { value: "pix_gerado" } });
    expect(mudou).toHaveBeenCalledWith("pix_gerado");
    fireEvent.change(select, { target: { value: "" } });
    expect(mudou).toHaveBeenLastCalledWith(null);
  });

  it("origem sem gatilho (copy, oferta) não mostra o seletor", () => {
    const { container } = render(<SeletorDeGatilho id="g2" ligacao={{ id: "l2", de: "c", para: "p" }} tipoDaOrigem="copy" onMudar={() => undefined} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("v4: migration 20261020060000_laboratorio_v4.sql", () => {
  const semente = sementeDaMigration();

  it("acrescenta a categoria, põe categoria nos 13 oficiais de antes e amplia o CHECK com todos os tipos", () => {
    expect(SQL).toContain("ALTER TABLE public.lab_templates ADD COLUMN IF NOT EXISTS categoria text;");
    const atualizados = (SQL.match(/'[0-9a-f-]{36}'::uuid/g) || []).length - semente.length;
    expect(atualizados).toBe(13);
    for (const [id, cat] of Object.entries(CATEGORIA_DOS_OFICIAIS)) {
      const linha = SQL.split("\n").find((l) => l.indexOf(`'${id}'::uuid`) >= 0 && l.indexOf("UPDATE") === 0) || "";
      expect(linha, id).toContain(`SET categoria = '${cat}'`);
    }
    const tipos = /ADD CONSTRAINT lab_execucoes_tipo_check CHECK \(tipo IN \(([^)]*)\)\)/.exec(SQL)![1].split(",").map((t) => t.trim().replace(/'/g, ""));
    expect(tipos).toEqual([...TIPOS_DE_NO]);
    expect(SQL).toContain("ON CONFLICT (id) DO UPDATE");
    expect(SQL).toContain("categoria = EXCLUDED.categoria");
    expect(SQL).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
    expect(SQL).not.toMatch(/\$/);
  });

  it("semeia os 25 templates do módulo, iguais, com categoria da galeria", () => {
    expect(semente).toHaveLength(25);
    expect(semente.map((t) => t.id)).toEqual(TEMPLATES_OFICIAIS_V4.map((t) => t.id));
    semente.forEach((t, i) => {
      const doModulo = TEMPLATES_OFICIAIS_V4[i];
      expect(t.nome).toBe(doModulo.nome);
      expect(t.categoria).toBe(doModulo.categoria);
      expect(CATEGORIAS_DOS_TEMPLATES as readonly string[]).toContain(t.categoria);
      expect(t.canvas).toEqual(JSON.parse(JSON.stringify(doModulo.canvas)));
    });
  });

  it("toda ligação de todo template passa no podeLigar da tela, na ordem, e no errosDoCanvas da função", () => {
    for (const t of semente) {
      const lido = normalizarNaTela(t.canvas);
      const bruto = t.canvas as { nos: unknown[]; ligacoes: Array<{ de: string; para: string; gatilho?: string }> };
      expect(lido.nos, t.nome).toHaveLength(bruto.nos.length);
      // Nenhuma ligação cai na leitura (nem o gatilho).
      expect(lido.ligacoes.map((l) => [l.de, l.para, l.gatilho || null]), t.nome).toEqual(bruto.ligacoes.map((l) => [l.de, l.para, l.gatilho || null]));
      let c: CanvasDoLab = { ...lido, ligacoes: [] };
      for (const l of lido.ligacoes) {
        const v = podeLigar(c, l.de, l.para);
        expect(v.ok, `${t.nome}: ${l.de} → ${l.para} (${v.motivo})`).toBe(true);
        c = ligar(c, l.de, l.para, l.gatilho);
        expect(c.ligacoes[c.ligacoes.length - 1].gatilho || null, `${t.nome}: gatilho ${l.de} → ${l.para}`).toBe(l.gatilho || null);
      }
      expect(errosDoCanvas(normalizarCanvas(t.canvas)), t.nome).toEqual([]);
    }
  });

  it("as posições ficam em colunas organizadas: o fio sempre anda para a direita, sem dois nós no mesmo lugar", () => {
    for (const t of semente) {
      const c = normalizarNaTela(t.canvas);
      const lugares = c.nos.map((n) => `${n.x},${n.y}`);
      expect(new Set(lugares).size, t.nome).toBe(lugares.length);
      for (const l of c.ligacoes) {
        const de = c.nos.find((n) => n.id === l.de)!;
        const para = c.nos.find((n) => n.id === l.para)!;
        expect(para.x, `${t.nome}: ${l.de} → ${l.para}`).toBeGreaterThan(de.x);
      }
    }
  });
});
