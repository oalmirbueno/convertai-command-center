import { describe, expect, it } from "vitest";
import { projetoDosTakes } from "../../supabase/functions/_shared/projeto-de-edicao";
import { opsParaInserir } from "@/lib/editor/biblioteca";
import { itemDoResultado, ondeEntra, prontasParaEntrar, type TrocaNaTela } from "@/lib/editor/cenario";
import { aplicarOperacao, aplicarOperacoes, fimDoClipe, trilhaPrincipal } from "@/lib/editor/operacoes";

// 02/10: a troca de cenário pronta (2,133 s, fora da grade de 25 fps) não entrava na linha do tempo:
// o empurrão arredondava para o quadro mais perto e sobrava 1 quadro sobreposto ("Ali já tem outro clipe").

const AGORA = "2026-10-02T12:00:00.000Z";

function projetoCortado() {
  let p = projetoDosTakes({ titulo: "Reel", fps: 25, takes: [{ id: "a", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: "cli/video/brutos/a.mp4", cena_ref: null, melhor: true, duracao_s: 12, largura: 1080, altura: 1920 }], agora: AGORA });
  const v = trilhaPrincipal(p)!;
  // Corta em 2,12 s: dois clipes colados, como no projeto real.
  p = aplicarOperacao(p, { op: "dividir", clipe: v.clipes[0].id, em_s: 2.12 });
  return p;
}

const troca = {
  id: "08f33822-a19c-4e9d-a387-1b8b36e8189d",
  estado: "pronto",
  versao_id: "versao-1",
  inserido_em: null,
  resultado: { id: "arq-1", nome: "Cenário novo", tipo: "gerado", storage_bucket: "mesa", storage_path: "cli/video/cenarios/x/final.mp4", duracao_s: 2.133, largura: 1080, altura: 1920 },
} as unknown as TrocaNaTela;

describe("inserir clipe com duração fora da grade de quadros", () => {
  it("entra logo depois do clipe de origem e empurra o resto sem sobrepor", () => {
    const p = projetoCortado();
    const [primeiro, segundo] = trilhaPrincipal(p)!.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s);
    const item = itemDoResultado({ ...troca, clipe_ref: primeiro.id })!;
    const ops = opsParaInserir(p, item, ondeEntra(p, { clipe_ref: primeiro.id }), 0, { tipo: "cena", ref: "cenario:08f33822" });
    const depois = aplicarOperacoes(p, ops);
    const clipes = trilhaPrincipal(depois)!.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s);
    expect(clipes).toHaveLength(3);
    const novo = clipes[1];
    expect(novo.inicio_s).toBeCloseTo(2.12, 5);
    // O seguinte começa num quadro inteiro, no fim do novo ou depois (nunca antes).
    const seguinte = clipes.find((c) => c.id === segundo.id)!;
    expect(seguinte.inicio_s).toBeGreaterThanOrEqual(fimDoClipe(novo) - 1e-6);
    expect(Math.abs(seguinte.inicio_s * 25 - Math.round(seguinte.inicio_s * 25))).toBeLessThan(1e-6);
    // E não abre buraco de um quadro inteiro.
    expect(seguinte.inicio_s - fimDoClipe(novo)).toBeLessThan(1 / 25);
  });

  it("a troca só sai da lista de pendentes quando o servidor marca inserido_em", () => {
    expect(prontasParaEntrar([troca], "versao-1")).toHaveLength(1);
    expect(prontasParaEntrar([{ ...troca, inserido_em: AGORA }], "versao-1")).toHaveLength(0);
  });
});
