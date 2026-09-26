import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alvosDasPecas,
  alvosDosRoteiros,
  blocoDasAcoesDosRoteiros,
  normalizarAcoesDosRoteiros,
  OPERACOES_DOS_ROTEIROS,
  pecasDaSemana,
  tipoPedido,
  type PecaParaAcao,
  type RoteiroParaAcao,
} from "../../supabase/functions/mesa-roteiros/acoes-dos-roteiros";
import { motor } from "../../supabase/functions/_shared/motores";

/**
 * Agente da Mesa Roteiros (contrato comum, _shared/acoes-do-agente.ts): o
 * agente vê apelidos (r1, p1), nunca UUID; propõe; a equipe confirma com o
 * custo antes; travas recusam com motivo. Pedidos do dono: "refaça o gancho",
 * "gere os roteiros das 4 peças de vídeo da semana", "mude o tom", "arquive
 * este roteiro".
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

const ROTEIROS: RoteiroParaAcao[] = [
  { id: id(1), titulo: "Salário-maternidade", tipo: "fala_camera", status: "rascunho", versao_atual: 2, arquivado: false, data_da_peca: "2026-09-29" },
  { id: id(2), titulo: "BPC para crianças", tipo: "fala_camera", status: "gravado", versao_atual: 4, arquivado: false },
  { id: id(3), titulo: "Roteiro antigo", tipo: "tutorial", status: "rascunho", versao_atual: 1, arquivado: true },
];
const PECAS: PecaParaAcao[] = [
  { id: id(11), titulo: "Reels 1", formato: "reel", data: "2026-09-27" },
  { id: id(12), titulo: "Reels 2", formato: "reel", data: "2026-09-29" },
  { id: id(13), titulo: "Story", formato: "story", data: "2026-10-01", roteiro_status: "rascunho" },
  { id: id(14), titulo: "Vídeo", formato: "video", data: "2026-10-02", roteiro_status: "aprovado" },
  { id: id(15), titulo: "Mês que vem", formato: "reel", data: "2026-10-20" },
];

describe("apelidos e bloco do prompt", () => {
  it("roteiros viram r1..rN e peças p1..pN, com detalhe curto e sem UUID no prompt", () => {
    expect(alvosDosRoteiros(ROTEIROS).map((a) => a.ref)).toEqual(["r1", "r2", "r3"]);
    expect(alvosDasPecas(PECAS).map((a) => a.ref)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    const bloco = blocoDasAcoesDosRoteiros(ROTEIROS, PECAS);
    expect(bloco).toContain("r1 | Salário-maternidade | Rascunho · v2 · Fala para câmera · peça de 29/09");
    expect(bloco).toContain("p4 | Vídeo | Vídeo · 02/10 · roteiro aprovado");
    for (const x of [...ROTEIROS, ...PECAS]) expect(bloco).not.toContain(x.id);
    for (const op of OPERACOES_DOS_ROTEIROS) expect(bloco).toContain(op);
  });
});

describe("ações propostas", () => {
  it("as quatro operações do dono viram itens com o id real; custo estimado só para IA", () => {
    const acao = normalizarAcoesDosRoteiros(
      {
        resumo: "Vou gerar 2 roteiros, refazer 1 gancho, mudar 1 tom e arquivar 1.",
        itens: [
          { operacao: "gerar_roteiro", ref: "p1", para: "" },
          { operacao: "gerar_roteiro", ref: "p2", para: "tutorial" },
          { operacao: "refazer_gancho", ref: "r1", para: "" },
          { operacao: "mudar_tom", ref: "R1", para: "mais leve" },
          { operacao: "arquivar_roteiro", ref: "r1", para: "" },
        ],
      },
      ROTEIROS,
      PECAS,
      "cliente-1",
      0.05,
    )!;
    expect(acao.agente).toBe("roteiros");
    expect(acao.itens.map((i) => [i.operacao, i.ref, i.alvo_id, i.para])).toEqual([
      ["gerar_roteiro", "p1", id(11), "fala_camera"],
      ["gerar_roteiro", "p2", id(12), "tutorial"],
      ["refazer_gancho", "r1", id(1), "sem pedido extra"],
    ]);
    // O mesmo roteiro não recebe duas operações (a segunda vira ignorado).
    expect(acao.ignorados).toEqual(["r1", "r1"]);
    expect(acao.custo_estimado_usd).toBeCloseTo(0.15, 6);
    expect(acao.contexto).toEqual({ client_id: "cliente-1" });
    expect(acao.itens[1].para_rotulo).toBe("Tutorial");
  });

  it("travas: gravado e arquivado não mudam; peça com roteiro aprovado não gera de novo", () => {
    const acao = normalizarAcoesDosRoteiros(
      {
        resumo: "",
        itens: [
          { operacao: "refazer_gancho", ref: "r2", para: "" },
          { operacao: "arquivar_roteiro", ref: "r3", para: "" },
          { operacao: "gerar_roteiro", ref: "p4", para: "" },
          { operacao: "gerar_roteiro", ref: "p3", para: "ugc" },
        ],
      },
      ROTEIROS,
      PECAS,
      "c",
      0.05,
    )!;
    expect(acao.recusados.map((r) => [r.ref, r.motivo])).toEqual([
      ["r2", "Roteiro já gravado. Volte para aprovado antes de mexer."],
      ["r3", "Já está arquivado."],
      ["p4", "A peça já tem roteiro aprovado. Peça uma mudança no roteiro dela."],
    ]);
    // Peça com roteiro em rascunho pode gerar de novo (vira versão nova).
    expect(acao.itens.map((i) => [i.ref, i.para])).toEqual([["p3", "ugc"]]);
  });

  it("apelido inventado, operação fora da lista, alvo do tipo errado e tom vazio viram ignorados", () => {
    const acao = normalizarAcoesDosRoteiros(
      {
        itens: [
          { operacao: "apagar_tudo", ref: "r1", para: "" },
          { operacao: "arquivar_roteiro", ref: "r99", para: "" },
          { operacao: "arquivar_roteiro", ref: "p1", para: "" },
          { operacao: "gerar_roteiro", ref: "r1", para: "" },
          { operacao: "mudar_tom", ref: "r1", para: "" },
          { operacao: "gerar_roteiro", ref: "p1", para: "ópera rock" },
        ],
      },
      ROTEIROS,
      PECAS,
      "c",
      0.05,
    );
    expect(acao).toBeNull();
  });

  it("sem pedido de ação, nada para confirmar", () => {
    expect(normalizarAcoesDosRoteiros(null, ROTEIROS, PECAS, "c", 0.05)).toBeNull();
    expect(normalizarAcoesDosRoteiros({ resumo: "x", itens: [] }, ROTEIROS, PECAS, "c", 0.05)).toBeNull();
  });

  it("tipo pedido em palavras vira o valor da mesa", () => {
    expect(tipoPedido("")).toBe("fala_camera");
    expect(tipoPedido("Tutorial passo a passo")).toBe("tutorial");
    expect(tipoPedido("história")).toBe("cinema");
    expect(tipoPedido("UGC")).toBe("ugc");
    expect(tipoPedido("anúncio")).toBe("ugc");
    expect(tipoPedido("fala para câmera")).toBe("fala_camera");
    expect(tipoPedido("ópera")).toBeNull();
  });

  it("'peças da semana' = próximos 7 dias a partir de hoje", () => {
    expect(pecasDaSemana(PECAS, "2026-09-26").map((p) => p.titulo)).toEqual(["Reels 1", "Reels 2", "Story", "Vídeo"]);
    expect(pecasDaSemana(PECAS, "2026-10-19").map((p) => p.titulo)).toEqual(["Mês que vem"]);
  });
});

describe("a função mesa-roteiros segue o contrato", () => {
  const fonte = ler("supabase/functions/mesa-roteiros/index.ts");

  it("confirma pela proposta guardada, com auditoria e Desfazer", () => {
    for (const t of ["acaoGuardadaNaMensagem(", "confirmarAcaoGuardada(", "desfazerAcaoGuardada(", "auditLog(", 'agente: "roteiros"', "executar_acao_agente: executarAcao", "desfazer_acao_agente: desfazerAcao"]) {
      expect(fonte, t).toContain(t);
    }
    // Reverso de cada operação: versão anterior, desarquivar, arquivar o criado.
    for (const t of ['tipo: "voltar_versao"', 'tipo: "desarquivar"', 'tipo: "arquivar_criado"']) expect(fonte, t).toContain(t);
  });

  it("Jev só como aviso: uma conferência por geração, sem laço de correção", () => {
    expect(fonte.match(/avisoDoJev\(/g)!.length).toBe(2); // a definição e a chamada única em escreverRoteiro
    expect(fonte).toContain("O Jev é aviso");
    expect(fonte).not.toMatch(/while\s*\(.*aviso|for\s*\(.*tentativa/i);
  });

  it("ações longas com fôlego, verify_jwt no config e o motor registrado", () => {
    expect(fonte).toContain('const ACOES_LONGAS = new Set(["gerar", "gancho_refazer", "tom_mudar", "agente_conversar", "executar_acao_agente", "pdf_compartilhar"]);');
    expect(fonte).toContain("respostaComFolego(rodar, corsHeaders)");
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.mesa-roteiros\]\s+verify_jwt = true/);
    expect(motor("mesa_roteiros.roteirista")!.funcao).toBe("mesa-roteiros");
    expect(motor("mesa_roteiros.agente")!.promete).toContain("papeis_do_roteiro");
  });

  it("compartilhar só roteiro aprovado, pelo caminho de Arquivos e revisão da agência", () => {
    expect(fonte).toContain('"roteiro_sem_aprovacao_interna"');
    expect(fonte).toContain('rpc("create_file_record"');
    expect(fonte).toContain('rpc("request_file_agency_review"');
    expect(fonte).toContain('folder: "estrategicos"');
  });

  it("textos sem travessão e prompts sem pedir chance de viralizar", () => {
    for (const p of ["supabase/functions/mesa-roteiros/index.ts", "supabase/functions/mesa-roteiros/acoes-dos-roteiros.ts", "supabase/functions/_shared/conhecimento-roteiros.ts", "supabase/functions/_shared/pdf-roteiro.ts"]) {
      expect(ler(p), p).not.toMatch(/—/);
    }
  });
});
