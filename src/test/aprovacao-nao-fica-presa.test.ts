import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { esperandoVoce, precisaDecisao } from "@/lib/precisaDecisao";

/**
 * "O botão de aprovação fica preso lá depois de concluir."
 *
 * A regra — `approval_required` E não estar concluído — vivia repetida à
 * mão em nove lugares, em quatro arquivos. Três esqueceram a segunda
 * metade: o botão do cartão, o menu de contexto e o texto exportado.
 *
 * A contagem dizia zero e o cartão continuava pedindo decisão. Tela
 * discordando dela mesma é pior que tela errada: quem lê não sabe em qual
 * metade acreditar.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

describe("concluído encerra o assunto", () => {
  it("vínculo concluído NÃO pede decisão, mesmo com a flag ligada", () => {
    // A aprovação que ficou pendurada perdeu o objeto.
    expect(precisaDecisao({ approval_required: true, status: "done" })).toBe(false);
  });

  it("vínculo em andamento com a flag pede decisão", () => {
    expect(precisaDecisao({ approval_required: true, status: "in_progress" })).toBe(true);
    expect(precisaDecisao({ approval_required: true, status: "blocked" })).toBe(true);
  });

  it("sem a flag não pede decisão, em nenhum estado", () => {
    for (const s of ["queued", "in_progress", "review", "blocked", "done"]) {
      expect(precisaDecisao({ approval_required: false, status: s })).toBe(false);
    }
  });

  it("flag nula ou ausente não pede decisão", () => {
    expect(precisaDecisao({ approval_required: null, status: "review" })).toBe(false);
    expect(precisaDecisao({ status: "review" })).toBe(false);
  });
});

describe("esperando você", () => {
  it("concluído não espera nada, mesmo que tenha esperado no passado", () => {
    expect(esperandoVoce({ approval_required: true, status: "done" })).toBe(false);
  });

  it("os estados que aguardam gente contam", () => {
    for (const s of ["blocked", "awaiting_input", "review"]) {
      expect(esperandoVoce({ approval_required: false, status: s })).toBe(true);
    }
  });

  it("em andamento sem flag não espera você", () => {
    expect(esperandoVoce({ approval_required: false, status: "in_progress" })).toBe(false);
  });

  it("estado desconhecido não vira 'esperando' por acidente", () => {
    expect(esperandoVoce({ status: "estado_novo_qualquer" })).toBe(false);
    expect(esperandoVoce({})).toBe(false);
  });
});

describe("a regra mora em UM lugar", () => {
  const arquivos = [
    "src/pages/AdminExecucao.tsx",
    "src/components/execucao/ContextoDoAgente.tsx",
    "src/components/execucao/Escritorio.tsx",
    "src/components/execucao/PerfilDoAgente.tsx",
  ];

  it("nenhuma tela repete a condição à mão", () => {
    // Foi a repetição que deixou três cópias divergirem.
    for (const rel of arquivos) {
      const src = ler(rel);
      expect(src, rel).not.toContain('approval_required && v.status !== "done"');
      expect(src, rel).not.toContain('approval_required && t.status !== "done"');
    }
  });

  it("todas importam a mesma função", () => {
    for (const rel of arquivos) {
      expect(ler(rel), rel).toContain('from "@/lib/precisaDecisao"');
    }
  });

  it("a página não redefine a regra localmente", () => {
    const pagina = ler("src/pages/AdminExecucao.tsx");
    expect(pagina).not.toContain("const precisaDecisao = (");
  });
});
