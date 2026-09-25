import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FONTES,
  fontesDoMotor,
  MOTORES,
  motoresDaFonte,
  origemDoBloco,
  SEM_BASE_DE_PROPOSITO,
  SKILLS_MARKETINGSKILLS,
  skillsDoMotor,
} from "../../supabase/functions/_shared/motores";
import * as REPOS from "../../supabase/functions/_shared/conhecimento-repositorios";
import { CHECKLIST_CRIATIVO_POR_OBJETIVO } from "../../supabase/functions/_shared/conhecimento-especialistas-ads";

/**
 * Frente W (25/09/2026): o índice único dos motores (_shared/motores.ts) é uma
 * promessa. Este teste cobra que cada agente recebe de verdade o conhecimento
 * que o índice diz (queixa real do dono: "o agente não usa as técnicas").
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const OBJETIVOS: unknown[] = [undefined, ...Object.keys(CHECKLIST_CRIATIVO_POR_OBJETIVO), { id: "vendas" }, "qualquer"];

describe("cada motor recebe o que o índice promete", () => {
  it("os blocos prometidos entram inteiros, com qualquer objetivo, e dentro do teto", () => {
    for (const m of MOTORES) {
      for (const objetivo of OBJETIVOS) {
        const k = m.montar(objetivo);
        for (const b of m.promete) expect(k.ids, `${m.id} / ${String(objetivo)} / ${b}`).toContain(b);
        expect(k.tamanho, m.id).toBeLessThanOrEqual(k.teto);
        expect(k.texto.length, m.id).toBeGreaterThan(0);
      }
    }
  });

  it("o texto de cada bloco novo chega igual ao prompt (nada cortado no meio)", () => {
    const porId: Record<string, string> = {
      matriz_de_ganchos: REPOS.MATRIZ_DE_GANCHOS,
      portfolio_de_estaticos: REPOS.PORTFOLIO_DE_ESTATICOS,
      fontes_do_criativo: REPOS.FONTES_DO_CRIATIVO,
      meta_na_pratica: REPOS.META_NA_PRATICA,
      psicologia_do_comprador: REPOS.PSICOLOGIA_DO_COMPRADOR,
      revisao_em_sete_passadas: REPOS.REVISAO_EM_SETE_PASSADAS,
      briefing_antes_de_criar: REPOS.BRIEFING_ANTES_DE_CRIAR,
      contexto_de_marketing: REPOS.CONTEXTO_DE_MARKETING,
      pesquisa_de_cliente: REPOS.PESQUISA_DE_CLIENTE,
      lancamento_e_isca: REPOS.LANCAMENTO_E_ISCA,
      estrategia_de_conteudo: REPOS.ESTRATEGIA_DE_CONTEUDO,
      foto_de_produto_com_verdade: REPOS.FOTO_DE_PRODUTO_COM_VERDADE,
      imagem_e_titulo: REPOS.IMAGEM_E_TITULO,
    };
    for (const [id, texto] of Object.entries(porId)) {
      const donos = MOTORES.filter((m) => m.promete.includes(id));
      expect(donos.length, `${id} tem motor`).toBeGreaterThan(0);
      for (const m of donos) expect(m.montar().texto, `${m.id} / ${id}`).toContain(texto);
    }
  });

  it("todo bloco que algum motor monta tem origem registrada", () => {
    for (const m of MOTORES) {
      for (const objetivo of OBJETIVOS) {
        for (const id of m.montar(objetivo).ids) expect(origemDoBloco(id), `${m.id}: ${id}`).not.toBeNull();
      }
    }
  });

  it("a função da mesa chama a montagem e põe o texto no sistema (trechos no código)", () => {
    for (const m of MOTORES) {
      const fonte = ler(m.ligacao.arquivo);
      for (const t of m.ligacao.trechos) expect(fonte, `${m.id}: ${t}`).toContain(t);
    }
  });

  it("ids de motor únicos e cada motor diz sua base principal", () => {
    const ids = MOTORES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MOTORES) expect(m.bases.length, m.id).toBeGreaterThan(0);
  });
});

describe("skills e repositórios chegam a algum prompt", () => {
  it("toda skill do marketingskills está mapeada e a integrada tem bloco prometido por um motor", () => {
    expect(Object.keys(SKILLS_MARKETINGSKILLS).length).toBe(50);
    for (const [skill, s] of Object.entries(SKILLS_MARKETINGSKILLS)) {
      expect(s.nota.length, skill).toBeGreaterThan(0);
      if (s.estado !== "integrado") {
        expect(s.blocos, skill).toEqual([]);
        continue;
      }
      expect(s.blocos.length, skill).toBeGreaterThan(0);
      for (const b of s.blocos) {
        expect(origemDoBloco(b)?.skills, `${skill} -> ${b}`).toContain(skill);
        expect(MOTORES.some((m) => m.promete.includes(b)), `${skill} -> ${b} chega a um motor`).toBe(true);
      }
    }
  });

  it("repositório integrado ou parcial alcança pelo menos um motor; os que não se aplicam não alcançam", () => {
    for (const f of Object.values(FONTES)) {
      const alcance = motoresDaFonte(f.id);
      if (f.estado === "integrado" || f.estado === "parcial") {
        // A biblioteca de prompts da Mesa Foto (YouMind) chega pelo dado escolhido pela equipe, não por bloco.
        if (f.id === "nano_banana_pro_youmind") continue;
        expect(alcance.length, f.id).toBeGreaterThan(0);
      } else {
        expect(alcance, f.id).toEqual([]);
      }
      expect(f.licenca.length, f.id).toBeGreaterThan(0);
    }
  });

  it("as consultas do índice respondem por motor", () => {
    expect(skillsDoMotor("mesa_ads.copy")).toEqual(expect.arrayContaining(["ad-creative", "marketing-psychology", "copy-editing"]));
    expect(skillsDoMotor("estudio.legenda")).toContain("copy-editing");
    expect(skillsDoMotor("contexto")).toEqual(expect.arrayContaining(["product-marketing", "customer-research"]));
    expect(fontesDoMotor("mesa_foto.diretor")).toEqual(expect.arrayContaining(["foto_de_produto_jeremygdm", "gpt_image_2_evolink"]));
    expect(fontesDoMotor("mesa_ads.senior")).toEqual(expect.arrayContaining(["especialistas", "marketingskills"]));
    expect(motoresDaFonte("advertising_ops")).toEqual(expect.arrayContaining(["mesa_ads.oferta", "mesa_ads.copy"]));
  });
});

describe("limites e decisões que não podem voltar atrás", () => {
  it("o texto ao gerador de imagem do Estúdio continua sem base de marketing", () => {
    const direcao = ler("supabase/functions/_shared/direcao-arte.ts");
    for (const proibido of ["conhecimento-repositorios", "conhecimento-dos-agentes", "motores.ts"]) expect(direcao).not.toContain(proibido);
    expect(SEM_BASE_DE_PROPOSITO["estudio.gerador"]).toContain("promptDaLamina");
  });

  it("diretor e variações da Mesa Foto recebem só a técnica de foto, sem marketing", () => {
    const foto = ler("supabase/functions/mesa-foto/index.ts");
    const constante = (nome: string) => new RegExp(`const ${nome} = \`([\\s\\S]*?)\`;`).exec(foto)?.[1] ?? "";
    for (const s of ["SISTEMA_DIRETOR", "SISTEMA_VARIACOES"]) {
      const corpo = constante(s);
      expect(corpo, s).toContain("${REGRAS_DA_CASA}\n${TECNICA_DA_FOTO}\nResponda só com o JSON pedido.");
      expect(corpo, s).not.toContain("CONHECIMENTO_DA_FOTO");
    }
    const k = MOTORES.find((m) => m.id === "mesa_foto.diretor")!.montar();
    expect(k.ids).toEqual(["foto_de_produto_com_verdade"]);
    expect(k.texto.startsWith("PRIORIDADE")).toBe(false);
  });

  it("os módulos novos não têm travessão nem número de resultado prometido", () => {
    for (const p of ["supabase/functions/_shared/conhecimento-repositorios.ts", "supabase/functions/_shared/motores.ts"]) {
      expect(ler(p), p).not.toMatch(/[—–]/);
    }
    for (const [nome, v] of Object.entries(REPOS)) {
      if (typeof v !== "string" || nome.startsWith("VERSAO")) continue;
      expect(v, nome).not.toMatch(/[—–]/);
      // Leitura de mercado sem promessa de ganho em porcentagem.
      expect(v, nome).not.toMatch(/\d+\s?%\s*(de|a mais|mais)\s*(convers|lucro|venda|ROAS)/i);
    }
  });
});
