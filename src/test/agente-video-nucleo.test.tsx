import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// A tela só precisa do cliente do banco para importar (o teste não chama nada).
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), functions: { invoke: vi.fn() } } }));

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

/**
 * Lote B (09/10): o agente fixo da Mesa Vídeos e da Mesa Edição no núcleo comum.
 * Teste isolado de contrato (não é teste de produção): a conversa mora no banco,
 * pergunta livre e "peça ao Hermes" passam pelo núcleo, a resposta da tela entra no
 * histórico e o Hermes alcança o agente pelo MCP.
 */
describe("agente da Mesa de Vídeo no núcleo comum", () => {
  const funcao = ler("supabase/functions/mesa-videos/index.ts");
  const tela = ler("src/components/mesa-videos/AgenteDaMesaDeVideo.tsx");

  it("a função guarda a troca em agente_conversas e responde a pergunta livre pelo núcleo", () => {
    expect(funcao).toContain('const referenciaDaConversaDaMesa = (mesa: MesaDoAgente) => (mesa === "edicao" ? "mesa_edicao_agente" : "mesa_videos_agente");');
    expect(funcao).toContain("const conversaId = await conversaDoAgenteDaMesa(ch, clientId, mesa, corpo.conversa_id);");
    expect(funcao).toContain("if (pedeAoHermes(texto)) {");
    expect(funcao).toContain("if (!r.resposta && r.intencao === NENHUMA) {");
    expect(funcao).toContain("const previas = await prepararNucleo(servico(), {");
    expect(funcao).toContain("const fechado = await fecharNucleo(servico(), bruto, previas, {");
    expect(funcao).toContain("INSTRUCAO_DO_NUCLEO_DAS_MESAS,");
    expect(funcao).toContain('await gravarTroca(servico(), { conversaId, clientId, usuario: { conteudo: texto, anexos: [] }, agente: { conteudo: String(r.resposta), anexos }, onde: "mesa-videos agente da mesa" });');
    expect(funcao).toContain("agente_agir: agenteAgir,");
    expect(funcao).toContain("agente_anotar: agenteAnotar,");
    // O cartão da anotação é lido de video_acoes, nunca o que a tela mandou.
    expect(funcao).toContain('.from(TABELA_DAS_ACOES).select("id, client_id, anexos").eq("id", corpo.mensagem_id)');
    expect(funcao).toContain("if (linha && linha.client_id === clientId");
  });

  it("a tela lê a conversa do banco (sem chamar a função ao abrir), manda conversa_id e anota o que respondeu", () => {
    expect(tela).toContain('banco.from("agente_conversas").select("id").eq("client_id", clientId).eq("agente", "diretor_arte")');
    expect(tela).toContain("conversa_id: conversaId });");
    expect(tela).toContain('acao: "agente_anotar"');
    expect(tela).toContain("<HistoricoDoAgente");
    expect(tela).not.toContain('acao: "agente_conversa"');
  });

  it("a mensagem do banco volta com o cartão e sem as marcas internas", async () => {
    const { mensagemDoBanco } = await import("@/components/mesa-videos/AgenteDaMesaDeVideo");
    const { TIPO_DA_ACAO } = await import("@/lib/agentes/acoesDoAgente");
    const acao = { tipo: TIPO_DA_ACAO, id: "agente-1", agente: "envio_para_edicao", resumo: "Mandar 1 vídeo para a Edição.", itens: [{ alvo_id: "a", titulo: "r1", operacao: "enviar_para_edicao" }], recusados: [] };
    const m = mensagemDoBanco({
      id: "m1",
      papel: "agente",
      conteudo: "Feito.",
      criado_em: "2026-10-09T00:00:00Z",
      anexos: [{ tipo: "resposta_da_tela", mesa: "videos" }, { tipo: "acao_da_mesa_de_video", tabela: "video_acoes", mensagem_id: "4f0c4a8e-0000-4000-8000-000000000001", acao }, { tipo: "aprendizado", regra: "x" }],
    });
    expect(m.papel).toBe("agente");
    expect(m.mensagem_id).toBe("4f0c4a8e-0000-4000-8000-000000000001");
    expect(m.acao && m.acao.id).toBe("agente-1");
    expect(m.anexos).toEqual([{ tipo: "aprendizado", regra: "x" }]);
    const s = mensagemDoBanco({ id: "m2", papel: "sistema", conteudo: "Pedido ao Hermes em revisão.", anexos: [], criado_em: "2026-10-09T00:00:01Z" });
    expect(s.papel).toBe("agente");
    expect(s.acao).toBeNull();
  });

  it("o Hermes alcança o agente da Mesa Vídeos e da Mesa Edição pelo MCP", () => {
    const mapa = ler("supabase/functions/_shared/mcp-agentes-das-mesas.ts");
    expect(mapa).toContain("videos: { agente: 'diretor_arte', referencia: 'mesa_videos_agente', nome: 'Agente da Mesa Vídeos' },");
    expect(mapa).toContain("edicao: { agente: 'diretor_arte', referencia: 'mesa_edicao_agente', nome: 'Agente da Mesa Edição' },");
  });
});
