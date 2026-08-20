import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApprovedMediaAssets } from "@/lib/editorialMedia";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const picker = ler("src/components/editorial/ApprovedMediaPicker.tsx");
const dialogo = ler("src/components/editorial/EditorialScheduleDialog.tsx");

/**
 * O seletor SEMPRE soube recarregar — tem a prop onRetry desde que nasceu.
 * Quem o usava nunca passou por onde, então o botão simplesmente não existia
 * na tela: arte recém-subida por outra aba (ou pelo card ao lado) não
 * aparecia até fechar e reabrir o diálogo inteiro.
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

describe("a lista pode ser recarregada sem fechar o diálogo", () => {
  it("o seletor mostra o botão quando sabe recarregar", () => {
    expect(picker).toContain("onRetry && (");
    expect(picker).toContain("Atualizar a lista de conteúdos");
  });

  it("o diálogo finalmente passa onRetry", () => {
    const uso = dialogo.slice(dialogo.lastIndexOf("<ApprovedMediaPicker"));
    expect(uso).toContain("onRetry={");
    expect(uso).toContain("refetchOptions()");
    expect(uso).toContain("schedulingPosts.refetch()");
  });

  it("recarregar também renova os prontos do calendário", () => {
    // Só refetchOptions deixaria a seção de um clique desatualizada.
    const uso = dialogo.slice(dialogo.lastIndexOf("<ApprovedMediaPicker"));
    expect(uso.indexOf("refetchOptions()")).toBeLessThan(uso.indexOf("schedulingPosts.refetch()"));
  });

  it("o botão gira enquanto busca, em vez de parecer morto", () => {
    expect(picker).toContain('loading && "animate-spin"');
    expect(dialogo).toContain("loading={optionsLoading}");
  });
});

describe("a lista traz o que foi subido, aprovado ou não", () => {
  it("rascunho recém-subido entra na seleção", () => {
    // Medido na base do Verzelo: 20 rascunhos disponíveis, e a espera é do
    // agendamento — não da seleção.
    const assets = buildApprovedMediaAssets([arquivo("recem-subida")] as never);
    expect(assets).toHaveLength(1);
  });

  it("arquivo ainda subindo fica de fora", () => {
    // status "uploading": entrar na lista ofereceria uma arte incompleta.
    const assets = buildApprovedMediaAssets([
      arquivo("subindo", { status: "uploading" }),
    ] as never);
    expect(assets).toHaveLength(0);
  });

  it("arquivo arquivado fica de fora", () => {
    const assets = buildApprovedMediaAssets([
      arquivo("velha", { archived_at: "2026-01-01" }),
    ] as never);
    expect(assets).toHaveLength(0);
  });

  it("documento não vira arte de post", () => {
    const assets = buildApprovedMediaAssets([
      arquivo("contrato", { mime_type: "application/pdf", file_name: "contrato.pdf" }),
    ] as never);
    expect(assets).toHaveLength(0);
  });
});
