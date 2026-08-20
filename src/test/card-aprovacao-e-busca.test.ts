import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApprovedMediaAssets, filterApprovedMediaAssets } from "@/lib/editorialMedia";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const zona = ler("src/components/editorial/EditorialArtDropZone.tsx");
const dialogo = ler("src/components/editorial/EditorialScheduleDialog.tsx");

/**
 * Medido na base do Verzelo: 38 imagens ativas — 8 aprovadas, 9 em aprovação
 * e 21 rascunho. A lista de seleção sempre trouxe as 38 (a espera é do
 * agendamento, não da seleção), mas o título dizia "Conteúdo aprovado" e o
 * card prometia uma busca cujo CAMPO sumia quando havia peça escolhida.
 */

const arquivo = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  file_name: `${id}.png`,
  mime_type: "image/png",
  parent_file_id: null,
  archived_at: null,
  status: "ready",
  visibility: "internal",
  agency_approval_status: "not_requested",
  approval_status: "none",
  ...extra,
});

describe("a lista traz aprovado e não aprovado", () => {
  it("rascunho e em aprovação entram junto do aprovado", () => {
    const assets = buildApprovedMediaAssets([
      arquivo("rascunho"),
      arquivo("revisao", { visibility: "approval", agency_approval_status: "approved" }),
      arquivo("aprovado", { visibility: "client_shared", agency_approval_status: "approved", locked_at: "2026-08-01" }),
    ] as never);
    expect(assets.map((a) => a.id).sort()).toEqual(["aprovado", "rascunho", "revisao"]);
  });

  it("a tela deixou de prometer só aprovado", () => {
    // Quem procurava uma arte em revisão concluía que ela não estava lá.
    expect(dialogo).toContain("Aprovados e em produção");
    expect(dialogo).not.toContain("Escolha um conteúdo já aprovado");
  });
});

describe("a busca cumpre o que o texto promete", () => {
  const assets = buildApprovedMediaAssets([
    arquivo("poda-curitiba"),
    arquivo("checklist-primavera"),
  ] as never);

  it("acha por parte do nome", () => {
    expect(filterApprovedMediaAssets(assets, "poda").map((a) => a.id)).toEqual(["poda-curitiba"]);
  });

  it("ignora acento e caixa", () => {
    expect(filterApprovedMediaAssets(assets, "CHECKLIST")).toHaveLength(1);
  });

  it("busca vazia devolve tudo", () => {
    expect(filterApprovedMediaAssets(assets, "  ")).toHaveLength(2);
  });

  it("o caminho para buscar de novo está nomeado", () => {
    // "Trocar conteúdo" não dizia que ali existe busca.
    expect(dialogo).toContain("Buscar outro");
  });
});

describe("subir arte pelo card já pede revisão", () => {
  it("o destino é escolhido antes do envio", () => {
    expect(zona).toContain("Deixar como rascunho");
    expect(zona).toContain("Enviar para revisão");
  });

  it("usa o mesmo RPC de revisão do Arquivos", () => {
    // Caminho paralelo criaria dois jeitos de pedir a mesma coisa.
    expect(zona).toContain("requestFileAgencyReview");
  });

  it("revisão que falha não é escondida", () => {
    // O material já existe em Arquivos; dizer que foi para revisão sem ter
    // ido seria pior que o erro.
    expect(zona).toMatch(/revisão não foi pedida/);
  });

  it("o aviso final diz onde a arte foi parar", () => {
    expect(zona).toContain("já entrou na fila de revisão");
    expect(zona).toContain("Está em Arquivos como rascunho");
  });
});
