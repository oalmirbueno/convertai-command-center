import { describe, expect, it } from "vitest";
import { duracaoDoClipe } from "../../supabase/functions/_shared/projeto-de-edicao";
import { aplicarOperacao, emOrdem, fimDoClipe, trilhaPrincipal } from "@/lib/editor/operacoes";
import { Montador } from "@/lib/editor/skills/tipos";
import { corteLimpoEm, planoDoCorteLimpo } from "@/lib/editor/skills/corteLimpo";
import { proporSkill } from "@/lib/editor/skills";
import { silenciosDoClipe } from "@/lib/editor/transcricao";
import { AGORA_SINTETICO, falaSintetica, projetoTalkingHead } from "./fixtures/talkingHeadSintetico";

/**
 * Auditoria da Mesa Edição (02/10): o motor de edição com um talking head
 * sintético que reproduz o caso real (picote de micro cortes, clipe de 0,32 s,
 * quadro preto entre clipes fora da grade).
 */

const fps = 25;
const naGrade = (s: number) => Math.abs(s * fps - Math.round(s * fps)) < 1e-6;

describe("corte limpo (antes: picote de micro cortes)", () => {
  it("o corte antigo (pausa de 0,3 s, sem clipe mínimo) picotava; o novo corta menos, sem clipe curto", () => {
    const p = projetoTalkingHead();
    const c = trilhaPrincipal(p)!.clipes[0];
    const antigos = silenciosDoClipe(c, falaSintetica(), { limiar_s: 0.3, respiro_depois_s: 0.1, respiro_antes_s: 0.08 });
    const plano = planoDoCorteLimpo(new Montador(p));
    expect(antigos.length).toBeGreaterThan(plano.cortes.length);
    expect(plano.cortes.length).toBeGreaterThan(3);
    // Teto: no máximo 14 cortes por minuto.
    expect(plano.cortes.length).toBeLessThanOrEqual(Math.floor((14 * p.duracao_s) / 60));
    // Todo corte é na grade de quadros e tira pelo menos 0,15 s.
    plano.cortes.forEach((x) => {
      expect(naGrade(x.de_s) && naGrade(x.ate_s)).toBe(true);
      expect(x.ate_s - x.de_s).toBeGreaterThanOrEqual(0.15 - 1e-9);
    });
  });

  it("nunca corta dentro de palavra e deixa respiro em volta", () => {
    const p = projetoTalkingHead();
    const plano = planoDoCorteLimpo(new Montador(p));
    falaSintetica().forEach((w) => {
      plano.cortes.forEach((x) => {
        // Nenhuma palavra encosta num corte (com pelo menos 30 ms de respiro).
        const invade = x.de_s < w.f + 0.03 - 1e-6 && x.ate_s > w.i - 0.03 + 1e-6;
        expect(invade, `"${w.t}" (${w.i} a ${w.f}) cortada por ${x.de_s} a ${x.ate_s}`).toBe(false);
      });
    });
  });

  it("uma operação só, clipes de pelo menos 0,8 s, encostados em quadros inteiros (sem buraco)", () => {
    const m = new Montador(projetoTalkingHead());
    const r = corteLimpoEm(m);
    expect(m.operacoes).toHaveLength(1);
    expect(m.operacoes[0].op).toBe("recortar_varios");
    const clipes = emOrdem(trilhaPrincipal(m.projeto)!);
    expect(clipes.length).toBe(r.cortes.length + 1 - r.cortes.filter((x) => x.de_s <= 1e-6).length);
    clipes.forEach((c, k) => {
      expect(duracaoDoClipe(c), `clipe ${c.id}`).toBeGreaterThanOrEqual(0.8 - 1e-6);
      expect(naGrade(c.inicio_s) && naGrade(fimDoClipe(c))).toBe(true);
      if (k > 0) expect(c.inicio_s).toBe(fimDoClipe(clipes[k - 1]));
    });
    // Nenhuma palavra saiu.
    const ditas = clipes.reduce((n, c) => n + falaSintetica().filter((w) => (w.i + w.f) / 2 >= c.entrada_s && (w.i + w.f) / 2 < c.saida_s).length, 0);
    expect(ditas).toBe(falaSintetica().length);
  });

  it("a palavra isolada entre pausas longas (o clipe de 0,32 s) ganha respiro e fica com 0,8 s", () => {
    const m = new Montador(projetoTalkingHead());
    corteLimpoEm(m);
    const w = falaSintetica().find((x) => x.t === "aluguel")!;
    const c = trilhaPrincipal(m.projeto)!.clipes.find((x) => x.entrada_s <= w.i && x.saida_s >= w.f)!;
    expect(duracaoDoClipe(c)).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });

  it("mantém o começo: nada sai antes do tempo protegido", () => {
    const plano = planoDoCorteLimpo(new Montador(projetoTalkingHead()), { proteger_ate_s: 12 });
    plano.cortes.forEach((x) => expect(x.de_s).toBeGreaterThanOrEqual(12 - 1e-6));
  });

  it("a skill Cortar silêncios usa o corte limpo (determinística)", () => {
    const p = projetoTalkingHead();
    const a = proporSkill("cortar_silencios", p, { agora: AGORA_SINTETICO });
    const b = proporSkill("cortar_silencios", p, { agora: AGORA_SINTETICO });
    expect(a.operacoes.filter((o) => o.op === "recortar_varios")).toHaveLength(1);
    expect(JSON.stringify(a.operacoes)).toBe(JSON.stringify(b.operacoes));
  });
});

describe("fechar buracos em quadros inteiros", () => {
  it("clipe com duração fora da grade (2,98 s) não deixa meio quadro preto depois de encostar", () => {
    let p = projetoTalkingHead();
    const v = trilhaPrincipal(p)!;
    p = aplicarOperacao(p, { op: "dividir", clipe: v.clipes[0].id, em_s: 4.12 });
    const segundo = emOrdem(trilhaPrincipal(p)!)[1];
    // Simula o corte antigo: a saída fora da grade (4,12 + 2,98 = 7,10 na linha) e o próximo em 7,12.
    p = aplicarOperacao(p, { op: "recortar", clipe: segundo.id, de_s: 7.1, ate_s: 7.3 });
    p = aplicarOperacao(p, { op: "ondular", trilha: v.id });
    const l = emOrdem(trilhaPrincipal(p)!);
    for (let k = 1; k < l.length; k++) {
      expect(l[k].inicio_s).toBe(fimDoClipe(l[k - 1]));
      expect(naGrade(l[k].inicio_s)).toBe(true);
    }
  });
});
