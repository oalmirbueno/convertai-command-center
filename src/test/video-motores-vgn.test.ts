import { describe, expect, it } from "vitest";
import esquemas from "./fixtures/fal-esquemas-video-2026-09-30.json";
import {
  atende,
  custoDoMotor,
  duracoesDoMotor,
  estadoDoMotor,
  MOTORES_DE_VIDEO,
  type MotorDeVideo,
  motorDoNivel,
  motorPorId,
  nivelDoMotor,
} from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { corpoDaGeracao, endpointDaGeracao, type EntradaDaGeracao, faltaParaGerar, type ModoDaGeracao } from "../../supabase/functions/mesa-videos/modulos/video-executor";

/**
 * Frente VGN (30/09/2026): o corpo de cada motor do fal bate com o esquema
 * real do provedor (fotografia de 30/09 em fixtures/fal-esquemas-video-*.json,
 * lida de fal.ai/api/openapi). Campo obrigatório presente, nenhum campo que o
 * provedor não conhece e valor fechado (duração, resolução, proporção) dentro
 * da lista. Foi assim que o H3 Max (sem prompt_expansion_mode) e o Kling O3
 * (start_image_url no lugar de image_url) apareceram: davam 422 no provedor.
 */

type Esquema = { obrigatorios: string[]; campos: string[]; valores: Record<string, unknown[]> };
const ESQUEMAS = (esquemas as unknown as { endpoints: Record<string, Esquema> }).endpoints;

const URL = (n: string) => `https://exemplo.supabase.co/storage/v1/object/sign/mesa/c/${n}.png?token=x`;

function entradaDoModo(m: MotorDeVideo, modo: ModoDaGeracao, formato: string, duracao: number, resolucao: string): EntradaDaGeracao {
  const base: EntradaDaGeracao = { modo, prompt: "A woman opens the kitchen door and smiles, slow dolly in", duracao_s: duracao, formato, resolucao, audio: true, seed: 7, negativo: "blur" };
  if (modo === "primeiro_quadro") return { ...base, quadro_inicial_url: URL("a") };
  if (modo === "primeiro_ultimo") return { ...base, quadro_inicial_url: URL("a"), quadro_final_url: URL("b") };
  if (modo === "referencia") return { ...base, quadro_inicial_url: URL("a"), referencias_urls: [URL("r1"), URL("r2")] };
  if (modo === "estender") return { ...base, video_url: "https://exemplo.supabase.co/v.mp4" };
  if (modo === "labial") return { ...base, prompt: "", quadro_inicial_url: URL("rosto"), audio_url: "https://exemplo.supabase.co/voz.mp3", duracao_s: 12 };
  return base;
}

function modosDo(m: MotorDeVideo): ModoDaGeracao[] {
  const s: ModoDaGeracao[] = [];
  if (m.familia === "labial") return ["labial"];
  if (m.familia !== "video") return s;
  if (m.cap.texto && m.endpoints.texto) s.push("texto");
  if (m.cap.primeiro_quadro && m.endpoints.imagem) s.push("primeiro_quadro");
  if (m.cap.ultimo_quadro && m.endpoints.ultimo) s.push("primeiro_ultimo");
  if (m.cap.referencias > 0 && (m.endpoints.referencia || m.endpoints.imagem)) s.push("referencia");
  if (m.cap.estender && m.endpoints.estender) s.push("estender");
  return s;
}

const doFal = MOTORES_DE_VIDEO.filter((m) => m.provedor === "fal" && !m.situacao && (m.familia === "video" || m.familia === "labial"));

describe("corpo de cada motor bate com o esquema do fal (30/09)", () => {
  it("todo endpoint do catálogo existe na fotografia do provedor", () => {
    doFal.forEach((m) =>
      Object.keys(m.endpoints).forEach((k) => {
        const ep = (m.endpoints as Record<string, string>)[k];
        expect(ESQUEMAS[ep], `${m.id} ${k} ${ep}`).toBeTruthy();
      }),
    );
  });

  for (const m of doFal) {
    for (const modo of modosDo(m)) {
      it(`${m.id} · ${modo}: obrigatórios, campos conhecidos e valores da lista`, () => {
        // Todos os formatos que a tela oferece (4:5 vira 3:4 em alguns motores; 1:1 nem todos aceitam).
        const formatos = m.formatos;
        formatos.forEach((formato) => {
          const duracoes = duracoesDoMotor(m);
          const amostras = [duracoes[0], duracoes[duracoes.length - 1]];
          amostras.forEach((d) => {
            m.resolucoes.forEach((res) => {
              const e = entradaDoModo(m, modo, formato, m.familia === "labial" ? 12 : d, res);
              // Luma a partir de imagem só aceita 5 s: a conferência recusa antes (sem gastar).
              const falta = faltaParaGerar(m, e);
              if (falta) {
                expect(m.dialeto === "luma" && modo !== "texto" && d > 5, `${m.id} ${modo}: ${falta}`).toBe(true);
                return;
              }
              const ep = endpointDaGeracao(m, e);
              const esq = ESQUEMAS[ep];
              expect(esq, ep).toBeTruthy();
              const corpo = corpoDaGeracao(m, e);
              esq.obrigatorios.forEach((c) => expect(corpo[c], `${m.id} ${modo} falta ${c} em ${ep}`).not.toBeUndefined());
              Object.keys(corpo).forEach((c) => expect(esq.campos, `${m.id} ${modo} manda ${c} que ${ep} não conhece`).toContain(c));
              Object.keys(esq.valores).forEach((c) => {
                if (corpo[c] === undefined) return;
                expect(esq.valores[c], `${m.id} ${modo} ${c}=${String(corpo[c])} (${formato}, ${d} s, ${res})`).toContain(corpo[c]);
              });
            });
          });
        });
      });
    }
  }
});

describe("catálogo da frente VGN", () => {
  const soFal = (nome: string) => nome === "FAL_KEY";

  it("motores novos ligados pela mesma FAL_KEY, com preço conferido em 30/09", () => {
    ["kling-3-turbo-pro", "kling-3-4k", "kling-o3-pro", "wan-3.0-prime", "seedance-2.0-mini", "luma-ray-3.2", "happyhorse-1.1", "h3-max-labial", "heygen-avatar4-labial", "sync-3-labial"].forEach((id) => {
      const m = motorPorId(id);
      expect(m, id).toBeTruthy();
      expect(estadoDoMotor(m!, { temChave: soFal }), id).toBe("pronto");
      expect(m!.preco!.conferido_em, id).toBe("2026-09-30");
    });
  });

  it("preços corrigidos pela página do provedor", () => {
    expect(custoDoMotor(motorPorId("ltx-2.3")!, { duracao_s: 6 }).usd).toBe(0.48);
    expect(custoDoMotor(motorPorId("ltx-2.3-fast")!, { duracao_s: 6 }).usd).toBe(0.36);
    expect(custoDoMotor(motorPorId("happyhorse-1.1")!, { duracao_s: 5, resolucao: "1080p" }).usd).toBe(0.9);
    expect(custoDoMotor(motorPorId("seedance-2.5")!, { duracao_s: 5, resolucao: "1080p" }).usd).toBe(5.82);
    expect(custoDoMotor(motorPorId("veo-3.1")!, { duracao_s: 8, resolucao: "4k", audio: true }).usd).toBe(4.8);
    expect(custoDoMotor(motorPorId("hailuo-2.3-pro")!, { duracao_s: 10 }).usd).toBe(0.49);
  });

  it("labial: o vídeo dura o que o áudio dura; H3 cobra 1,2 vez acima de 15 s", () => {
    const h3 = motorPorId("h3-max-labial")!;
    expect(custoDoMotor(h3, { duracao_s: 10.2 }).usd).toBe(0.88); // 11 s x 0,08 (768p)
    expect(custoDoMotor(h3, { duracao_s: 20 }).usd).toBe(1.92); // 20 x 0,08 x 1,2
    expect(custoDoMotor(h3, { duracao_s: 20 }).detalhe).toMatch(/acima de 15 s/);
    expect(custoDoMotor(motorPorId("heygen-avatar4-labial")!, { duracao_s: 30 }).usd).toBe(3);
    expect(atende(h3, { modo: "labial" })).toBe(true);
    expect(atende(h3, { modo: "primeiro_quadro" })).toBe(false);
    expect(atende(motorPorId("veo-3.1")!, { modo: "labial" })).toBe(false);
    expect(motorDoNivel("top", { modo: "labial" })!.familia).toBe("labial");
  });

  it("conferência antes do custo: labial pede foto, áudio e até 60 s; Luma de imagem só 5 s", () => {
    const h3 = motorPorId("h3-max-labial")!;
    const base: EntradaDaGeracao = { modo: "labial", prompt: "", duracao_s: 10, formato: "9:16", audio: true };
    expect(faltaParaGerar(h3, base)).toMatch(/foto/);
    expect(faltaParaGerar(h3, { ...base, quadro_inicial_url: URL("a") })).toMatch(/áudio/);
    expect(faltaParaGerar(h3, { ...base, quadro_inicial_url: URL("a"), audio_url: URL("v"), duracao_s: 75 })).toMatch(/60 s/);
    expect(faltaParaGerar(h3, { ...base, quadro_inicial_url: URL("a"), audio_url: URL("v") })).toBeNull();
    const luma = motorPorId("luma-ray-3.2")!;
    expect(faltaParaGerar(luma, { modo: "primeiro_quadro", prompt: "x", duracao_s: 10, formato: "9:16", audio: false, quadro_inicial_url: URL("a") })).toMatch(/só 5 s/);
    expect(faltaParaGerar(luma, { modo: "texto", prompt: "x", duracao_s: 10, formato: "9:16", audio: false })).toBeNull();
  });

  it("níveis continuam coerentes com os motores novos", () => {
    expect(nivelDoMotor(motorPorId("wan-3.0-prime")!)).toBe("top");
    expect(nivelDoMotor(motorPorId("wan-3.0")!)).toBe("normal");
    expect(nivelDoMotor(motorPorId("kling-3-turbo-pro")!)).toBe("normal");
    expect(nivelDoMotor(motorPorId("kling-3-pro")!)).toBe("top");
    expect(motorDoNivel("top", { modo: "primeiro_quadro" })!.id).toBe("seedance-2.5");
  });
});
