import { describe, expect, it, vi } from "vitest";
import { contextoDasRespostas, juntarRespostas, perguntasAindaAbertas, idDaResposta, guardarEConferirResposta } from "../../supabase/functions/agente-central/continuidade";
import { escreverComModeloDaCentral } from "../../supabase/functions/_shared/modelo-da-central";
import { comporDossie, linhasDeConfirmacao, MARCADOR_AVANCOS, MARCADOR_CONFIRMADO } from "../../supabase/functions/agente-central/regras";
import { assinaturaDasRespostas, emLotes } from "@/components/central/filaDaCentral";

describe("continuidade entre rodadas da Central", () => {
  const antiga = { pergunta: "Qual é a prioridade de outubro?", resposta: "Fotos de produtos.", em: "2026-10-01" };
  it("uma correção prevalece e impede perguntar de novo, sem esconder decisões novas", () => {
    const atual = juntarRespostas([antiga], [{ ...antiga, pergunta: "Qual e a prioridade de outubro", resposta: "Vídeos do evento." }]);
    expect(atual).toHaveLength(1);
    expect(atual[0].resposta).toBe("Vídeos do evento.");
    expect(perguntasAindaAbertas([
      { pergunta: antiga.pergunta, por_que: "" },
      { pergunta: "Qual é a prioridade de novembro?", por_que: "Novo mês" },
    ], atual).map((p) => p.pergunta)).toEqual(["Qual é a prioridade de novembro?"]);
  });
  it("não trata pergunta sem resposta como resolvida", () => {
    expect(juntarRespostas([{ ...antiga, resposta: " " }, null], [])).toEqual([]);
  });
  it("preserva confirmações mesmo com milhares de avanços depois delas", () => {
    const dossie = `${MARCADOR_CONFIRMADO}\n- Verba confirmada: 30/dia.\n${MARCADOR_AVANCOS}\n${"Avanço\n".repeat(10000)}`;
    const prompt = contextoDasRespostas(dossie, [antiga]);
    expect(prompt).toContain("30/dia");
    expect(prompt).toContain("Fotos de produtos.");
    expect(prompt).not.toContain("Avanço\n");
  });
  it("o mesmo fato em outra data não ocupa duas posições no dossiê", () => {
    const d1 = comporDossie("Equipe", { confirmacoes: linhasDeConfirmacao(new Date("2026-10-01T12:00:00Z"), ["Priorizar vídeos."]) });
    const d2 = comporDossie(d1, { confirmacoes: linhasDeConfirmacao(new Date("2026-10-02T12:00:00Z"), ["Priorizar vídeos."]) });
    expect(d2.match(/Priorizar vídeos/g)).toHaveLength(1);
    expect(d2).toContain("02/10/2026");
  });
  it("repetir envio tem o mesmo id; outro cliente, resposta ou rodada não colide", async () => {
    const id = await idDaResposta("cliente-a", "rodada-1", "Sim");
    expect(await idDaResposta("cliente-a", "rodada-1", "Sim")).toBe(id);
    expect(await idDaResposta("cliente-b", "rodada-1", "Sim")).not.toBe(id);
    expect(await idDaResposta("cliente-a", "rodada-1", "Não")).not.toBe(id);
    expect(await idDaResposta("cliente-a", "rodada-2", "Sim")).not.toBe(id);
  });
  it("edição de resposta ou contexto invalida o resultado anterior", () => {
    const original = assinaturaDasRespostas(["Sim"], "", "");
    expect(assinaturaDasRespostas([" Sim "], "", "")).toBe(original);
    expect(assinaturaDasRespostas(["Não"], "", "")).not.toBe(original);
    expect(assinaturaDasRespostas(["Sim"], "Mudou", "")).not.toBe(original);
    expect(assinaturaDasRespostas(["Sim"], "", "Mudou")).not.toBe(original);
  });
});

describe("persistência confirmada antes da IA", () => {
  it("aceita repetição apenas se o conteúdo salvo corresponde ao envio", async () => {
    const inserir = async () => ({ error: { code: "23505" } });
    await expect(guardarEConferirResposta("Sim", { inserir, reler: async () => ({ data: { content: "Sim" }, error: null }) })).resolves.toBeUndefined();
    await expect(guardarEConferirResposta("Sim", { inserir, reler: async () => ({ data: { content: "Não" }, error: null }) })).rejects.toThrow("confirmar");
  });
  it("não confirma uma escrita recusada nem uma leitura sem permissão", async () => {
    const reler = vi.fn();
    await expect(guardarEConferirResposta("Sim", { inserir: async () => ({ error: { code: "42501" } }), reler })).rejects.toThrow("guardar");
    expect(reler).not.toHaveBeenCalled();
    await expect(guardarEConferirResposta("Sim", { inserir: async () => ({ error: null }), reler: async () => ({ data: null, error: "sem acesso" }) })).rejects.toThrow("confirmar");
  });
  it("pesquisa usa o motor com navegação e não inventa pesquisa na reserva", async () => {
    const motor = vi.fn().mockRejectedValue(new Error("offline"));
    const legado = vi.fn();
    const r = await escreverComModeloDaCentral({ clientId: "c1", sistema: "s", usuario: "u", pesquisaWeb: true }, { motor, legado });
    expect(motor).toHaveBeenCalledWith(expect.objectContaining({ pesquisaWeb: true }));
    expect(legado).not.toHaveBeenCalled();
    expect(r).toBeNull();
  });
});

it("fila inicia próximo cliente quando abre uma vaga, mantendo dois simultâneos", async () => {
  const iniciados: number[] = [];
  const liberar = new Map<number, () => void>();
  const fila = emLotes([1, 2, 3], 2, async (n) => {
    iniciados.push(n);
    await new Promise<void>((resolve) => liberar.set(n, resolve));
  });
  expect(iniciados).toEqual([1, 2]);
  liberar.get(2)!();
  await Promise.resolve(); await Promise.resolve();
  expect(iniciados).toEqual([1, 2, 3]);
  liberar.get(1)!(); liberar.get(3)!();
  await fila;
});
