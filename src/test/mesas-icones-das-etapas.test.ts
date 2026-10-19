import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ICONES_DAS_ETAPAS } from "@/components/mesa-foto/IconesDasEtapas";
import { ETAPAS_DA_MESA_VIDEOS } from "@/components/mesa-videos/Comuns";
import { ETAPAS_DA_MESA_EDICAO } from "@/components/mesa-edicao/Comuns";
import { ETAPAS_DA_PUBLICIDADE } from "@/components/mesa-publicidade/Comuns";
import { ETAPAS_DA_PROPOSTA } from "@/components/mesa-proposta/caminhoDaProposta";
import { ETAPAS_DE_APOIO, PASSOS_PRINCIPAIS } from "@/components/mesa-foto/Comuns";
import { ETAPAS_DO_SITE } from "../../supabase/functions/_shared/site-metodo";
import { ETAPAS_DA_IDENTIDADE } from "../../supabase/functions/mesa-identidade/modulos/identidade-etapas";

/**
 * 16/10/2026 (dono: "em tudo que tem texto e ícone, deixa só o ícone" e
 * "nunca o mesmo ícone para ações diferentes"): as etapas de todas as mesas
 * avulsas viraram ícone (Etapas soIcone) com um mapa só
 * (src/components/mesa-foto/IconesDasEtapas.tsx). Aqui: toda etapa tem ícone
 * e nenhuma mesa repete ícone entre etapas.
 */

const ler = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8").replace(/\r\n/g, "\n");

const ETAPAS_POR_MESA: Record<string, string[]> = {
  ads: ["oferta", "referencias", "plano", "estudio", "conta", "auditoria", "resultados"],
  videos: ETAPAS_DA_MESA_VIDEOS.map((e) => e.valor),
  edicao: ETAPAS_DA_MESA_EDICAO.map((e) => e.valor),
  publicidade: ETAPAS_DA_PUBLICIDADE.map((e) => e.valor),
  roteiros: ["agenda", "roteiro", "revisao", "pdf", "modelos"],
  identidade: ETAPAS_DA_IDENTIDADE.map((e) => e.valor),
  site: ETAPAS_DO_SITE.map((e) => e.valor),
  proposta: ETAPAS_DA_PROPOSTA.map((e) => e.valor),
  foto: PASSOS_PRINCIPAIS.map((p) => p.etapa as string).concat(ETAPAS_DE_APOIO.map((e) => e.etapa as string)),
};

describe("ícones das etapas das mesas", () => {
  it("toda etapa de toda mesa tem ícone, e nenhuma mesa repete ícone", () => {
    for (const mesa of Object.keys(ETAPAS_POR_MESA)) {
      const mapa = (ICONES_DAS_ETAPAS as Record<string, Record<string, unknown>>)[mesa];
      expect(mapa, mesa).toBeTruthy();
      const faltando = ETAPAS_POR_MESA[mesa].filter((v) => !mapa[v]);
      expect(faltando, mesa).toEqual([]);
      const icones = ETAPAS_POR_MESA[mesa].map((v) => mapa[v]);
      expect(new Set(icones).size, mesa).toBe(icones.length);
    }
  });

  // 19/10/2026: Mesa Motion retirada a pedido do dono; o mapa não tem mais as etapas dela.
  it("a Mesa Motion saiu do mapa de ícones", () => {
    expect((ICONES_DAS_ETAPAS as Record<string, unknown>).motion).toBeUndefined();
  });

  it("as listas do teste batem com as das páginas (Ads e Roteiros moram na página)", () => {
    const ads = ler("src/pages/MesaAds.tsx");
    for (const v of ETAPAS_POR_MESA.ads) expect(ads).toContain(`{ valor: "${v}"`);
    const roteiros = ler("src/pages/MesaRoteiros.tsx");
    for (const v of ETAPAS_POR_MESA.roteiros) expect(roteiros).toContain(`{ valor: "${v}"`);
  });

  it("todas as mesas avulsas usam as etapas só em ícone (nenhuma com numerar)", () => {
    const fontes = [
      "src/pages/MesaAds.tsx",
      "src/pages/MesaIdentidade.tsx",
      "src/pages/MesaPublicidade.tsx",
      "src/pages/MesaRoteiros.tsx",
      "src/pages/MesaSite.tsx",
      "src/components/mesa-videos/MesaDeVideo.tsx",
      "src/components/mesa-videos/NavegacaoVideo.tsx",
      "src/components/mesa-proposta/NaCascaDaProposta.tsx",
    ];
    for (const f of fontes) {
      const t = ler(f);
      expect(t, f).toContain("soIcone");
      expect(t, f).toContain("etapasEmIcone(");
      expect(t, f).not.toMatch(/<Etapas[^>]*\bnumerar\b/);
    }
  });
});
