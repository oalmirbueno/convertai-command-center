// @vitest-environment jsdom
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente MTR (30/09/2026): motores funcionando.
 * - Estado dos motores (função motores-estado, módulo puro) com os dados REAIS
 *   de 30/09: workers nunca ligados, 5 cenas e 1 trabalho do site na fila,
 *   OpenRouter com limite na chave, carteiras vazias;
 * - vídeo vencido segue conferido até o teto de 24 h (rodada 2), nunca vira
 *   erro por uma consulta só, e "Conferir de novo" reabre o que venceu;
 * - motor de código sem a chave direta segue pelo OpenRouter (ou falha logo);
 * - atalhos de ligar, guia, config.toml e migration;
 * - a tela: linha nas Configurações e o quadro com "O que fazer".
 */

const { invocar } = vi.hoisted(() => ({ invocar: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invocar(...a) }, from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/agencia/DadosDaAgencia", () => ({ default: () => null }));
vi.mock("@/components/NotificationsPanel", () => ({ default: () => null }));
// O SDK do opencode só existe no node_modules do próprio worker; estes testes provam que o
// trabalho falha ANTES de subir o opencode, então a subida aqui é um erro.
vi.mock("../../workers/motor-codigo/lib/opencode.ts", () => ({
  subirOpencode: vi.fn(async () => { throw new Error("o opencode não deveria subir neste teste"); }),
  rodarPassada: vi.fn(async () => { throw new Error("o opencode não deveria rodar neste teste"); }),
}));

import {
  dataCurta,
  type EntradaDoEstado,
  erroDoPedidoDeVideo,
  erroLegivel,
  lerChaveDoOpenrouter,
  lerCreditosDoOpenrouter,
  montarEstado,
  resumoGeral,
} from "../../supabase/functions/motores-estado/modulos/estado";
import { corpoDaGeracao, desfechoDaConsulta, passouDoTeto, podeReconferir, tetoDoEnvioMin } from "../../supabase/functions/mesa-videos/modulos/video-executor";
import { duracoesDoMotor, motorPorId } from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { escolherRota, idsNoOpenrouter } from "../../workers/motor-codigo/lib/rota-do-modelo";
import { ordenarPorUrgencia } from "@/lib/motores/estadoDosMotores";
import EstadoDosMotores from "@/components/config/EstadoDosMotores";
import SettingsPage from "@/pages/SettingsPage";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const AGORA = Date.parse("2026-09-30T19:30:00Z");

/** O que a produção tinha em 30/09 19:30 UTC (leitura do banco da frente MTR). */
function entradaDe30de09(extra: Partial<EntradaDoEstado> = {}): EntradaDoEstado {
  return {
    agora: AGORA,
    admin: true,
    segredos: { OPENROUTER_API_KEY: true, OPENAI_API_KEY: true, ANTHROPIC_API_KEY: false, FAL_KEY: true, TYPESAFE_API_KEY: true, ELEVENLABS_API_KEY: false },
    openrouter: { chave: { limite: 60, uso: 32, restante: 28 }, creditos: { total: 100, usado: 70 }, erro: null },
    site: {
      executores: [],
      abertos: [{ estado: "na_fila", criado_em: "2026-09-30T16:34:14Z", modelo: "openai:gpt-6-luna" }],
      ultimaFalha: null,
      ultimoFeito: null,
    },
    render: {
      workers: [],
      abertos: ["16:09:58", "16:10:00", "16:10:01", "16:10:02", "16:10:03"].map((h1) => ({ tipo: "cena_hf", estado: "fila", criado_em: `2026-09-30T${h1}Z`, atualizado_em: `2026-09-30T${h1}Z` })),
      erros: [],
      prontos: [],
    },
    imagem: {
      abertos: [{ status: "rodando", criado_em: "2026-09-30T19:22:48Z" }],
      erros: [{ erro_codigo: "saldo_insuficiente", erro_mensagem: "Saldo insuficiente na carteira de IA do cliente.", em: "2026-09-29T21:15:21Z", cliente: "Rodrigo" }],
      feitas24h: 40,
      ultimaFeita: "2026-09-30T19:22:27Z",
    },
    // O único pedido da história (28/09) foi uma troca de ângulo de FOTO (fal-ai/qwen-image-edit-2511-multiple-angles), não vídeo.
    video: { abertos: [], erros: [{ texto: "Passou do prazo de 10 min sem terminar. Nada foi cobrado.", em: "2026-09-30T01:25:16Z", tipo: "angulo" }], pedidos7d: 0, prontos7d: 0, angulos7d: 1, ultimoPronto: null },
    carteirasBaixas: [{ cliente: "Jobson", saldo: 0.0256 }, { cliente: "Rodrigo", saldo: 0.068 }],
    ...extra,
  };
}

const porId = (e: EntradaDoEstado) => {
  const m = montarEstado(e);
  return Object.fromEntries(m.map((x) => [x.id, x]));
};

describe("Estado dos motores com os dados reais de 30/09", () => {
  it("site: worker nunca ligado, 1 trabalho na fila, e o que falta é ligar o worker", () => {
    const m = porId(entradaDe30de09()).site;
    expect(m.situacao).toBe("parado");
    expect(m.resumo).toBe("O worker do motor de código nunca foi ligado. 1 trabalho na fila desde 30/09 13:34.");
    expect(m.fila).toEqual({ esperando: 1, rodando: 0, desde: "2026-09-30T16:34:14Z" });
    expect(m.falta[0]).toMatch(/ligar-motor-codigo\.cmd/);
    expect(m.falta[0]).toMatch(/LIGAR-OS-MOTORES\.md/);
    // Com mais de 2 dias na fila, a tela avisa que o trabalho cai quando o motor ligar (o SQL cancela).
    const velho = porId(entradaDe30de09({ agora: Date.parse("2026-10-02T20:00:00Z") })).site;
    expect(velho.detalhes.join(" ")).toMatch(/mais de 2 dias na fila/);
    expect(ler("supabase/migrations/20260930316000_estado_dos_motores.sql")).toContain("interval '48 hours'");
  });

  it("render do Motion: 5 cenas na fila desde 13:09, worker nunca ligado; a Mesa Edição também parada", () => {
    const e = porId(entradaDe30de09());
    expect(e.motion.situacao).toBe("parado");
    expect(e.motion.resumo).toBe("O worker de render nunca foi ligado. 5 cenas na fila desde 30/09 13:09.");
    expect(e.motion.falta[0]).toMatch(/ligar-render\.cmd/);
    expect(e.edicao.situacao).toBe("parado");
    expect(e.edicao.fila.esperando).toBe(0);
  });

  it("worker desligado desde uma hora conhecida; ligado com batida recente; progresso recente prova vida do worker antigo", () => {
    const desligado = porId(entradaDe30de09({ site: { ...entradaDe30de09().site, executores: [{ nome: "agencia-pc", visto_em: "2026-09-29T22:00:00Z", capacidades: { openrouter: true, openai: false, tunel: true, uiux: true, vercel: false } }] } })).site;
    expect(desligado.resumo).toMatch(/^Worker desligado desde 29\/09 19:00\./);
    // O trabalho pede a OpenAI direta e a máquina só tem o OpenRouter: segue pelo OpenRouter (detalhe, não falta).
    expect(desligado.detalhes.join(" ")).toMatch(/não tem OPENAI_API_KEY: o motor segue pelo mesmo modelo no OpenRouter/);
    expect(desligado.detalhes.join(" ")).toMatch(/VERCEL_TOKEN/);

    const ligado = porId(entradaDe30de09({ render: { ...entradaDe30de09().render, workers: [{ nome: "pc-render", visto_em: "2026-09-30T19:29:40Z", versao: "edt-1.0+mot-1.0+mtr-1", capacidades: { faltas: ["HyperFrames não instalado no worker (npm ci na pasta workers/render): cenas do Motion não renderizam"] }, pedido_id: null }] } }));
    expect(ligado.motion.situacao).toBe("atencao");
    expect(ligado.motion.falta.join(" ")).toMatch(/HyperFrames/);
    expect(ligado.edicao.situacao).toBe("ok");

    const antigo = porId(entradaDe30de09({ render: { workers: [{ nome: "pc", visto_em: "2026-09-30T19:00:00Z" }], abertos: [{ tipo: "render_final", estado: "rodando", criado_em: "2026-09-30T19:10:00Z", atualizado_em: "2026-09-30T19:27:00Z" }], erros: [], prontos: [] } }));
    expect(antigo.edicao.situacao).toBe("ok");
    expect(antigo.edicao.detalhes.join(" ")).toMatch(/Worker antigo/);
  });

  it("a máquina sem nenhuma chave de modelo vira falta do site", () => {
    const m = porId(entradaDe30de09({ site: { ...entradaDe30de09().site, executores: [{ nome: "pc", visto_em: "2026-09-30T19:29:50Z", capacidades: { openrouter: false, openai: false, anthropic: false } }] } })).site;
    expect(m.situacao).toBe("atencao");
    expect(m.falta.join(" ")).toMatch(/OPENAI_API_KEY \(ou OPENROUTER_API_KEY\)/);
  });

  it("imagem: funcionando nas últimas 24 h; OpenRouter sem crédito ou com a chave no limite para o motor", () => {
    const ok = porId(entradaDe30de09()).imagem;
    expect(ok.situacao).toBe("ok");
    expect(ok.resumo).toMatch(/^40 gerações feitas nas últimas 24 h \(última às 30\/09 16:22\)\./);
    expect(ok.ultimo_erro && ok.ultimo_erro.texto).toBe("Carteira de IA de Rodrigo sem saldo para gerar.");

    const semCredito = porId(entradaDe30de09({ openrouter: { chave: null, creditos: { total: 50, usado: 50 }, erro: null } }));
    expect(semCredito.imagem.situacao).toBe("parado");
    expect(semCredito.imagem.falta[0]).toMatch(/Recarregar o crédito do OpenRouter/);
    expect(semCredito.ia.situacao).toBe("parado");

    const noLimite = porId(entradaDe30de09({ openrouter: { chave: { limite: 25, uso: 25, restante: 0 }, creditos: { total: 100, usado: 60 }, erro: null } }));
    expect(noLimite.imagem.resumo).toMatch(/limite/);
    expect(noLimite.imagem.falta[0]).toMatch(/Aumentar o limite da chave/);
  });

  it("vídeo: troca de ângulo não prova vídeo; erro mais novo que o último pronto vira atenção; esquecido pede a Mesa Vídeos; sem FAL_KEY para", () => {
    const e = porId(entradaDe30de09());
    // Dados reais: 1 troca de ângulo, 0 vídeo, 1 erro e nenhum pronto -> atenção, nunca "Ligado" verde.
    expect(e.video.situacao).toBe("atencao");
    expect(e.video.resumo).toMatch(/nenhum VÍDEO pedido em 7 dias \(só 1 troca de ângulo de foto\)/);
    expect(e.video.resumo).not.toMatch(/Ligado pela fal: 1 pedido/);
    expect(e.video.ultimo_erro && e.video.ultimo_erro.texto).toMatch(/^Troca de ângulo de foto: Passou do prazo/);
    expect(e.video.detalhes.join(" ")).toMatch(/Runway, Higgsfield, HeyGen/);
    // Vídeo de verdade e o último pronto depois do erro: segue verde.
    const comVideo = porId(entradaDe30de09({ video: { abertos: [], erros: [{ texto: "x", em: "2026-09-30T01:00:00Z", tipo: "gerar_livre" }], pedidos7d: 3, prontos7d: 2, angulos7d: 1, ultimoPronto: "2026-09-30T02:00:00Z" } })).video;
    expect(comVideo.situacao).toBe("ok");
    expect(comVideo.resumo).toBe("Ligado pela fal: 3 vídeos pedidos em 7 dias, 2 prontos. Mais 1 troca de ângulo de foto.");
    // O erro mais novo que o último pronto sobe para atenção (como os outros motores).
    const erroNovo = porId(entradaDe30de09({ video: { abertos: [], erros: [{ texto: "x", em: "2026-09-30T03:00:00Z", tipo: "gerar_livre" }], pedidos7d: 3, prontos7d: 2, angulos7d: 0, ultimoPronto: "2026-09-30T02:00:00Z" } })).video;
    expect(erroNovo.situacao).toBe("atencao");
    const esquecido = porId(entradaDe30de09({ video: { abertos: [{ estado: "gerando", criado_em: "2026-09-30T18:00:00Z" }], erros: [], pedidos7d: 1, prontos7d: 0, angulos7d: 0, ultimoPronto: null } })).video;
    expect(esquecido.situacao).toBe("atencao");
    expect(esquecido.detalhes.join(" ")).toMatch(/abra a Mesa Vídeos/);
    const semFal = porId(entradaDe30de09({ segredos: { ...entradaDe30de09().segredos, FAL_KEY: false } })).video;
    expect(semFal.situacao).toBe("parado");
    expect(semFal.falta[0]).toMatch(/FAL_KEY/);
  });

  it("chaves da IA: Anthropic e ElevenLabs ausentes viram detalhe; carteiras e números só para o admin", () => {
    const admin = porId(entradaDe30de09()).ia;
    expect(admin.situacao).toBe("ok");
    expect(admin.resumo).toBe("OpenRouter com US$ 28,00 disponíveis.");
    const d = admin.detalhes.join(" ");
    expect(d).toMatch(/ANTHROPIC_API_KEY/);
    expect(d).toMatch(/ELEVENLABS_API_KEY/);
    expect(d).toMatch(/Jobson \(US\$ 0,03\), Rodrigo \(US\$ 0,07\)/);
    const equipe = porId(entradaDe30de09({ admin: false })).ia;
    expect(equipe.detalhes.join(" ")).not.toMatch(/Jobson|US\$ 70/);
    // Valor em dólar só para o admin, também no resumo.
    expect(equipe.resumo).toBe("OpenRouter com crédito.");
    expect(equipe.resumo).not.toMatch(/US\$/);
    const quaseEquipe = porId(entradaDe30de09({ admin: false, openrouter: { chave: { limite: 60, uso: 59, restante: 1 }, creditos: { total: 100, usado: 70 }, erro: null } })).ia;
    expect(quaseEquipe.resumo).toBe("OpenRouter quase sem crédito.");
    expect(quaseEquipe.situacao).toBe("atencao");
    const semJev = porId(entradaDe30de09({ segredos: { OPENROUTER_API_KEY: true, FAL_KEY: true } })).ia;
    expect(semJev.situacao).toBe("atencao");
    expect(semJev.falta.join(" ")).toMatch(/TYPESAFE_API_KEY/);
  });

  it("resumo geral, hora de Brasília e leitura das respostas do OpenRouter", () => {
    const g = resumoGeral(montarEstado(entradaDe30de09()));
    expect(g).toEqual({ parados: 3, atencao: 1, texto: "3 motores parados, 1 pede atenção" });
    expect(dataCurta("2026-09-30T02:05:00Z")).toBe("29/09 23:05");
    expect(lerChaveDoOpenrouter({ data: { limit: 60, usage: 32.5, limit_remaining: 27.5 } })).toEqual({ limite: 60, uso: 32.5, restante: 27.5 });
    expect(lerChaveDoOpenrouter({ data: { limit: null, usage: 10 } })).toEqual({ limite: null, uso: 10, restante: null });
    // A chave real da agência (30/09) vem com teto de 999.999.999: é "sem teto", não número para mostrar.
    expect(lerChaveDoOpenrouter({ data: { limit: 999999999, usage: 48.78, limit_remaining: 999999950.22 } })).toEqual({ limite: null, uso: 48.78, restante: null });
    expect(lerCreditosDoOpenrouter({ data: { total_credits: 100, total_usage: 99.9 } })).toEqual({ total: 100, usado: 99.9 });
    expect(lerCreditosDoOpenrouter({})).toBeNull();
    expect(erroDoPedidoDeVideo({ envios: [{ erro: null }, { erro: "Passou do prazo" }] })).toBe("Passou do prazo");
    expect(erroLegivel("provedor_erro", "openrouter respondeu 403: Key limit exceeded (total limit). Manage it using https://openrouter.ai/x")).toBe("A chave do OpenRouter chegou ao limite dela (Key limit exceeded).");
    expect(erroLegivel(null, "openrouter 402 Insufficient credits")).toMatch(/sem crédito/);
  });
});

describe("vídeo vencido segue conferido até o teto (desfechoDaConsulta, rodada 2)", () => {
  it("pronto no provedor baixa e cobra mesmo depois do prazo e até depois do teto", () => {
    expect(desfechoDaConsulta({ estado: "pronto" }, true, 10)).toEqual({ estado: "baixando", erro: null });
    expect(desfechoDaConsulta({ estado: "pronto" }, true, 10, null, true)).toEqual({ estado: "baixando", erro: null });
  });
  it("fila ou gerando depois do prazo NÃO vira erro: segue com aviso; dentro do prazo segue limpo", () => {
    const gerando = desfechoDaConsulta({ estado: "gerando" }, true, 10);
    expect(gerando.estado).toBe("gerando");
    expect(gerando.erro).toBe("Passou do prazo de 10 min e ainda gerando no provedor. Seguimos conferindo por até 24 h; nada é cobrado aqui antes de ficar pronto.");
    const fila = desfechoDaConsulta({ estado: "fila" }, true, 10);
    expect(fila.estado).toBeNull();
    expect(fila.erro).toMatch(/ainda na fila do provedor/);
    expect(desfechoDaConsulta({ estado: "gerando" }, false, 10)).toEqual({ estado: "gerando", erro: null });
    expect(desfechoDaConsulta({ estado: "fila" }, false, 10)).toEqual({ estado: null, erro: null });
  });
  it("falha passageira (rede, 5xx) depois do prazo não encerra; só o teto encerra", () => {
    expect(desfechoDaConsulta(null, false, 10, "rede")).toEqual({ estado: null, erro: "rede" });
    const vencido = desfechoDaConsulta(null, true, 10, "HTTP 503");
    expect(vencido.estado).toBeNull();
    expect(vencido.erro).toMatch(/a consulta falhou \(HTTP 503\)\. Seguimos conferindo por até 24 h/);
    const teto = desfechoDaConsulta(null, true, 10, "HTTP 503", true, "req-abc");
    expect(teto.estado).toBe("erro");
    expect(teto.erro).toMatch(/Passou de 24 h sem resposta do provedor \(última consulta: HTTP 503\)/);
    expect(teto.erro).toMatch(/O provedor pode ter cobrado; confira no painel dele \(pedido req-abc\)/);
    expect(teto.erro).not.toMatch(/Nada foi cobrado/);
    const tetoGerando = desfechoDaConsulta({ estado: "gerando" }, true, 10, null, true, "req-1");
    expect(tetoGerando.estado).toBe("erro");
    expect(tetoGerando.erro).toMatch(/^Passou de 24 h sem terminar no provedor\. O provedor pode ter cobrado/);
  });
  it("erro do provedor encerra com o motivo (o provedor não cobra erro)", () => {
    expect(desfechoDaConsulta({ estado: "erro", erro: "conteúdo recusado" }, false, 10)).toEqual({ estado: "erro", erro: "conteúdo recusado" });
    expect(desfechoDaConsulta({ estado: "erro" }, true, 10, null, true)).toEqual({ estado: "erro", erro: "O provedor recusou o pedido." });
  });
  it("teto de 24 h (ou 6x o prazo, se maior)", () => {
    const enviado = { enviado_em: "2026-09-29T19:00:00Z" };
    expect(tetoDoEnvioMin(10)).toBe(24 * 60);
    expect(tetoDoEnvioMin(300)).toBe(1800);
    expect(passouDoTeto(enviado, 10, Date.parse("2026-09-30T18:59:00Z"))).toBe(false);
    expect(passouDoTeto(enviado, 10, Date.parse("2026-09-30T19:01:00Z"))).toBe(true);
  });
  it("Conferir de novo: só o que venceu, com request_id e sem cobrança nem arquivo", () => {
    const base = { estado: "erro" as const, request_id: "req-28-09", uso_id: null, arquivo_id: null };
    // O texto exato que ficou no pedido de 28/09 (antes da frente MTR):
    expect(podeReconferir({ ...base, erro: "Passou do prazo de 10 min sem terminar. Nada foi cobrado." })).toBe(true);
    expect(podeReconferir({ ...base, erro: "Passou de 24 h sem terminar no provedor. O provedor pode ter cobrado; confira." })).toBe(true);
    expect(podeReconferir({ ...base, erro: "O motor deste pedido saiu do catálogo; não deu para conferir no provedor." })).toBe(true);
    expect(podeReconferir({ ...base, erro: "conteúdo recusado" })).toBe(false);
    expect(podeReconferir({ ...base, erro: "Cancelado. Nada foi cobrado." })).toBe(false);
    expect(podeReconferir({ ...base, request_id: "", erro: "Passou do prazo de 10 min" })).toBe(false);
    expect(podeReconferir({ ...base, uso_id: "u1", erro: "Passou do prazo de 10 min" })).toBe(false);
    expect(podeReconferir({ ...base, estado: "gerando" as never, erro: "Passou do prazo de 10 min" })).toBe(false);
    // Unificado com o Recuperar da VGN (01/10): mesma regra. Já cobrado, só volta o download não guardado.
    expect(podeReconferir({ ...base, uso_id: "u1", erro: "O provedor terminou, mas o arquivo não foi guardado depois de 5 tentativas." })).toBe(true);
    expect(podeReconferir({ ...base, erro: "Passou do prazo de 10 min", enviado_em: "2026-09-20T00:00:00Z" }, Date.parse("2026-09-30T00:00:00Z"))).toBe(false);
  });
  it("o consultarPedido usa o desfecho com o teto, nunca marca erro sem perguntar, e o reconferir está na rota", () => {
    const g = ler("supabase/functions/mesa-videos/geracao.ts");
    expect(g).toContain("desfechoDaConsulta(situacao, vencido, prazoMin, falha, alemDoTeto, e.request_id)");
    expect(g).not.toMatch(/if \(passouDoPrazo\(e, prazoMin, agora\)\) \{\s*e\.estado = "erro";/);
    expect(g).not.toMatch(/saiu do catálogo\. Nada foi cobrado/);
    expect(g).toMatch(/export async function gerarReconferir/);
    expect(ler("supabase/functions/mesa-videos/index.ts")).toContain("gerar_reconferir: comFolego(gerarReconferir)");
    expect(ler("src/components/mesa-videos/GeracoesRecentes.tsx")).toContain('acao: "gerar_reconferir"');
  });
});

describe("vídeo pela fal: corpo conferido contra o esquema público (prova sem custo, 30/09)", () => {
  const base = { prompt: "x", duracao_s: 5, formato: "9:16", audio: false, quadro_inicial_url: "https://a", quadro_final_url: "https://b" };
  it("Kling O3 image-to-video manda image_url (obrigatório lá); o v3 segue com start_image_url", () => {
    const o3 = corpoDaGeracao(motorPorId("kling-o3-standard")!, { ...base, modo: "primeiro_quadro" });
    expect(o3.image_url).toBe("https://a");
    expect(o3).not.toHaveProperty("start_image_url");
    expect(corpoDaGeracao(motorPorId("kling-o3-standard")!, { ...base, modo: "primeiro_ultimo" })).toEqual(expect.objectContaining({ image_url: "https://a", end_image_url: "https://b" }));
    expect(corpoDaGeracao(motorPorId("kling-3-pro")!, { ...base, modo: "primeiro_quadro" }).start_image_url).toBe("https://a");
  });
  it("MiniMax H3 manda prompt_expansion_mode e só oferece 5 a 15 s", () => {
    for (const id of ["minimax-h3-max", "minimax-h3-max-turbo"]) {
      const m = motorPorId(id)!;
      expect(corpoDaGeracao(m, { ...base, modo: "texto", quadro_inicial_url: null }).prompt_expansion_mode).toBe("balanced");
      expect(Math.min(...duracoesDoMotor(m))).toBe(5);
      expect(Math.max(...duracoesDoMotor(m))).toBe(15);
    }
  });
  it("LTX-2.3 Pro só 6, 8 ou 10 s; Hailuo 2.3 Pro sem duração no corpo (duração fixa)", () => {
    expect(duracoesDoMotor(motorPorId("ltx-2.3")!)).toEqual([6, 8, 10]);
    expect(duracoesDoMotor(motorPorId("hailuo-2.3-pro")!)).toEqual([6]);
    expect(corpoDaGeracao(motorPorId("hailuo-2.3-pro")!, { ...base, modo: "primeiro_quadro" })).not.toHaveProperty("duration");
  });
});

describe("motor de código: rota do modelo quando falta a chave direta", () => {
  const luna = { id: "openai:gpt-6-luna", provedor: "openai", modelo_api: "gpt-6-luna", preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: 0.01 };
  const lunaOr = { id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: 0.01 };
  it("ids do mesmo modelo no OpenRouter (hífen da versão vira ponto)", () => {
    expect(idsNoOpenrouter(luna)).toEqual(["openrouter:openai/gpt-6-luna"]);
    expect(idsNoOpenrouter({ provedor: "anthropic", modelo_api: "claude-opus-5-5" })).toEqual(["openrouter:anthropic/claude-opus-5-5", "openrouter:anthropic/claude-opus-5.5"]);
    expect(idsNoOpenrouter({ provedor: "openrouter", modelo_api: "openai/gpt-6-luna" })).toEqual([]);
  });
  it("com a chave direta segue igual; sem ela e com o OpenRouter, vai pelo OpenRouter com aviso", () => {
    expect(escolherRota(luna, () => true, null)).toEqual({ ok: true, modelo: luna, aviso: null, motivo: null, chave: null });
    const r = escolherRota(luna, (p) => p === "openrouter", lunaOr);
    expect(r.ok).toBe(true);
    expect(r.modelo && r.modelo.id).toBe("openrouter:openai/gpt-6-luna");
    expect(r.aviso).toMatch(/não tem OPENAI_API_KEY: o motor seguiu pelo OpenRouter/);
  });
  it("sem rota nenhuma falha dizendo o nome da chave (nunca o valor)", () => {
    const r = escolherRota(luna, () => false, null);
    expect(r.ok).toBe(false);
    expect(r.modelo).toBeNull();
    expect(r.chave).toBe("OPENAI_API_KEY");
    expect(r.motivo).toMatch(/LIGAR-OS-MOTORES\.md/);
    const semNoCatalogo = escolherRota(luna, (p) => p === "openrouter", null);
    expect(semNoCatalogo.ok).toBe(false);
    expect(semNoCatalogo.motivo).toMatch(/não tem rota pelo OpenRouter no catálogo/);
  });
  it("o worker confere a rota antes de montar projeto e prévia", () => {
    const x = ler("workers/motor-codigo/lib/executar.ts");
    const conferir = x.indexOf("escolherRota(modelo, temChave, alternativo)");
    expect(conferir).toBeGreaterThan(0);
    expect(conferir).toBeLessThan(x.indexOf("await garantirProjeto(pasta)"));
    expect(ler("workers/motor-codigo/lib/fila.ts")).toMatch(/modeloAlternativo\(ids\)[\s\S]*from\("ia_modelos"\)[\s\S]*\.eq\("ativo", true\)/);
  });
});

describe("worker de motor de código: trabalho sem chave falha logo, sem montar nada", () => {
  let pasta = "";
  const antes = { ...process.env };
  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), "mtr-motor-"));
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...antes };
    rmSync(pasta, { recursive: true, force: true });
  });
  it("estado falhou com o nome da chave e nenhum projeto criado", async () => {
    const { filaLocal } = await import("../../workers/motor-codigo/lib/fila");
    const { executarTrabalho } = await import("../../workers/motor-codigo/lib/executar");
    const fila = filaLocal(join(pasta, "fila"));
    const id = "11111111-1111-4111-8111-111111111111";
    fila.enfileirar({
      id, client_id: "22222222-2222-4222-8222-222222222222", marca_id: null, mesa: "site", projeto: "site-teste-mtr", referencia_tipo: "site", referencia_id: null,
      tipo: "construir", estado: "na_fila", modelo: "openai:gpt-6-luna", instrucao: "", teto_usd: 1, estimativa_usd: 0.2, custo_usd: 0, criado_por: null,
      pedido: { modelo: { id: "openai:gpt-6-luna", provedor: "openai", modelo_api: "gpt-6-luna", preco_entrada_1m: 0.1, preco_saida_1m: 0.5 }, secoes: ["hero"], pacote: {} },
    });
    const t = await fila.pegar("teste");
    const r = await executarTrabalho(t!, fila, { pastaProjetos: join(pasta, "projetos"), prazoPorPassadaMs: 60_000, comPrevia: false });
    expect(r).toEqual({ estado: "falhou", custo: 0 });
    const linha = fila.ler(id);
    expect(linha.estado).toBe("falhou");
    expect(String(linha.erro)).toMatch(/não tem a chave OPENAI_API_KEY/);
    expect(existsSync(join(pasta, "projetos", "site-teste-mtr"))).toBe(false);
  }, 30_000);

  it("órfão varrido por outro executor: a gravação final não sobrescreve nem manda outro fim (rodada 2)", async () => {
    const { filaLocal } = await import("../../workers/motor-codigo/lib/fila");
    const { executarTrabalho } = await import("../../workers/motor-codigo/lib/executar");
    const fila = filaLocal(join(pasta, "fila"));
    const base = {
      client_id: "22222222-2222-4222-8222-222222222222", marca_id: null, mesa: "site", projeto: "site-teste-mtr", referencia_tipo: "site", referencia_id: null,
      tipo: "construir", estado: "na_fila", modelo: "openai:gpt-6-luna", instrucao: "", teto_usd: 1, estimativa_usd: 0.2, custo_usd: 0, criado_por: null,
      pedido: { modelo: { id: "openai:gpt-6-luna", provedor: "openai", modelo_api: "gpt-6-luna", preco_entrada_1m: 0.1, preco_saida_1m: 0.5 }, secoes: ["hero"], pacote: {} },
    };
    // A: a varredura de órfão do worker B marcou "falhou" enquanto A ainda rodava.
    const idA = "33333333-3333-4333-8333-333333333333";
    fila.enfileirar({ id: idA, ...base });
    const tA = await fila.pegar("worker-a");
    expect(tA!.executor).toBe("worker-a");
    await fila.atualizar(idA, { estado: "falhou", erro: "O executor parou de responder (órfão)." });
    const r = await executarTrabalho(tA!, fila, { pastaProjetos: join(pasta, "projetos"), prazoPorPassadaMs: 60_000, comPrevia: false });
    expect(r.estado).toBe("encerrado_pela_fila");
    expect(fila.ler(idA).estado).toBe("falhou");
    expect(fila.ler(idA).erro).toBe("O executor parou de responder (órfão).");
    const ev = fila.eventos(idA);
    expect(ev.filter((e) => e.tipo === "fim").length).toBe(0);
    expect(ev.some((e) => e.tipo === "aviso" && /já tinha sido encerrado pela fila/.test(e.resumo))).toBe(true);
    // B pegou de novo o mesmo trabalho: o fim de A também não grava por cima.
    const idB = "44444444-4444-4444-8444-444444444444";
    fila.enfileirar({ id: idB, ...base });
    const tB = await fila.pegar("worker-a");
    await fila.atualizar(idB, { executor: "worker-b" });
    expect((await executarTrabalho(tB!, fila, { pastaProjetos: join(pasta, "projetos"), prazoPorPassadaMs: 60_000, comPrevia: false })).estado).toBe("encerrado_pela_fila");
    expect(fila.ler(idB).estado).toBe("executando");
    expect(ler("workers/motor-codigo/lib/fila.ts")).toMatch(/\.in\("estado", \["executando", "parando"\]\)/);
  }, 30_000);
});

describe("atalhos, guia, config e migration", () => {
  it("um atalho .cmd por worker, um que liga todos, um que confere e um que guarda as chaves", () => {
    const script = ler("workers/ligar/ligar-motores.ps1");
    for (const [cmd, arg] of [["ligar-render", "-Motor render"], ["ligar-motor-codigo", "-Motor codigo"], ["ligar-todos", "-Motor todos"], ["conferir-motores", "-Motor conferir"], ["guardar-chaves", "-GuardarChaves"]]) {
      const c = ler(`workers/ligar/${cmd}.cmd`);
      expect(c).toContain('"%~dp0ligar-motores.ps1"');
      expect(c).toContain(arg);
      expect(c.indexOf("\r")).toBe(-1);
    }
    // Lê do ambiente (sessão, Usuário, Máquina) e do arquivo fora do git; nunca mostra valor.
    expect(script).toContain("[Environment]::GetEnvironmentVariable($nome, $escopo)");
    expect(script).toContain("Read-Host -AsSecureString");
    expect(script).toContain(".aceleriq\\motores.env");
    expect(script).not.toMatch(/Write-Host \$valor|Escrever \$valor/);
    // Nada que pareça chave de verdade nos arquivos versionados.
    for (const f of ["workers/ligar/ligar-motores.ps1", "workers/ligar/motores.env.exemplo", "docs/motores/LIGAR-OS-MOTORES.md"]) {
      expect(ler(f)).not.toMatch(/sk-or-v1-[a-z0-9]{10,}|sk-[A-Za-z0-9]{20,}|eyJhbGciOi[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]{10,}/);
    }
    expect(ler("workers/ligar/motores.env.exemplo")).toMatch(/SUPABASE_SERVICE_ROLE_KEY=\n/);
    // Rodada 2: a sessão leva os caminhos do HyperFrames e do GSAP, e o ffprobe é conferido junto do ffmpeg.
    expect(script).toMatch(/Levar-ParaSessao[\s\S]*'RENDER_HYPERFRAMES', 'RENDER_GSAP'/);
    expect(script).toContain("if (Tem-Comando 'ffprobe')");
    expect(script).toContain("Ler-Variavel 'RENDER_FFPROBE'");
    expect(ler("workers/ligar/motores.env.exemplo")).toMatch(/RENDER_HYPERFRAMES=\nRENDER_GSAP=\n/);
  });

  it("o guia tem a tabela motor, causa, código e ação do dono, e o passo a passo", () => {
    const g = ler("docs/motores/LIGAR-OS-MOTORES.md");
    expect(g).toContain("| Motor | Causa exata | Corrigido no código? | Ação do dono |");
    ["guardar-chaves.cmd", "conferir-motores.cmd", "ligar-render.cmd", "ligar-motor-codigo.cmd", "ligar-todos.cmd", "Estado dos motores"].forEach((t) => expect(g).toContain(t));
  });

  it("função com JWT no config.toml e migration só amplia, com escrita só da service_role", () => {
    expect(ler("supabase/config.toml")).toContain("[functions.motores-estado]\n    verify_jwt = true");
    const sql = ler("supabase/migrations/20260930316000_estado_dos_motores.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS capacidades jsonb");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.render_workers FROM authenticated");
    expect(sql).not.toMatch(/DROP TABLE|DROP POLICY|DISABLE ROW LEVEL/i);
    const fn = ler("supabase/functions/motores-estado/index.ts");
    expect(fn).toContain('rpc("is_staff"');
    expect(fn).not.toMatch(/segredos\[n\] = segredo\(n\)/);
    expect(fn).toContain("segredos[n] = !!segredo(n)");
  });
});

describe("tela: Configurações, Estado dos motores", () => {
  const quadro = () => {
    const motores = montarEstado(entradaDe30de09());
    return { data: { motores, geral: resumoGeral(motores), avisos: [], conferido_em: "2026-09-30T19:30:00Z" }, error: null };
  };
  const montar = (el: ReturnType<typeof h>, rota = "/config") =>
    render(h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, el)));
  beforeEach(() => invocar.mockReset());

  it("a linha abre a seção sob demanda", async () => {
    invocar.mockResolvedValue(quadro());
    montar(h(SettingsPage));
    const linha = document.querySelector("[data-linha-motores]") as HTMLButtonElement;
    expect(linha.textContent).toContain("Estado dos motores");
    expect(linha.getAttribute("aria-expanded")).toBe("false");
    expect(invocar).not.toHaveBeenCalled();
    fireEvent.click(linha);
    await waitFor(() => expect(document.querySelector("[data-estado-dos-motores]")).not.toBeNull());
    expect(invocar).toHaveBeenCalledWith("motores-estado", { body: {} });
    expect(ler("src/pages/SettingsPage.tsx")).toContain('lazy(() => import("@/components/config/EstadoDosMotores"))');
  });

  it("com ?motores=1 a seção já chega aberta (link das mesas e do guia)", async () => {
    invocar.mockResolvedValue(quadro());
    montar(h(SettingsPage), "/config?motores=1");
    expect((document.querySelector("[data-linha-motores]") as HTMLButtonElement).getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(document.querySelector("[data-estado-dos-motores]")).not.toBeNull());
  });

  it("parados primeiro; abrir a linha mostra fila, último sinal e o que fazer", async () => {
    invocar.mockResolvedValue(quadro());
    montar(h(EstadoDosMotores));
    await waitFor(() => expect(document.querySelectorAll("[data-motor]").length).toBe(6));
    const ordem = Array.from(document.querySelectorAll("[data-motor]")).map((n) => n.getAttribute("data-situacao"));
    expect(ordem.slice(0, 3)).toEqual(["parado", "parado", "parado"]);
    expect(screen.getByText(/3 motores parados, 1 pede atenção · conferido 30\/09 16:30/)).toBeInTheDocument();
    const site = document.querySelector('[data-motor="site"] button') as HTMLButtonElement;
    fireEvent.click(site);
    expect(site.getAttribute("aria-expanded")).toBe("true");
    const corpo = document.querySelector('[data-motor="site"]') as HTMLElement;
    expect(corpo.textContent).toContain("1 esperando, 0 em andamento (desde 30/09 13:34)");
    expect(corpo.querySelector("[data-falta]")!.textContent).toMatch(/ligar-motor-codigo\.cmd/);
    expect((document.querySelector('[data-motor="ia"]') as HTMLElement).textContent).toContain("Em dia");
  });

  it("erro da função aparece legível, com Atualizar", async () => {
    invocar.mockResolvedValue({ data: null, error: { context: { status: 404 } } });
    montar(h(EstadoDosMotores));
    await waitFor(() => expect(screen.getByText(/ainda não foi publicado no servidor/)).toBeInTheDocument());
    expect(document.querySelectorAll("[data-atualizar-motores]").length).toBeGreaterThan(0);
  });

  it("ordenar por urgência mantém a ordem da função no empate", () => {
    const m = montarEstado(entradaDe30de09());
    expect(ordenarPorUrgencia(m).map((x) => x.id)).toEqual(["site", "motion", "edicao", "video", "imagem", "ia"]);
  });
});
