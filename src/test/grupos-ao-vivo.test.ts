import { describe, expect, it } from "vitest";
import {
  duracao,
  haQuanto,
  itensPorTipo,
  linhaDaMensagem,
  normalizarGrupos,
  numerosDosGrupos,
  ordenarGrupos,
  papelNoGrupo,
  tomDaEspera,
} from "@/lib/gruposAoVivo";

const AGORA = Date.parse("2026-11-18T18:00:00Z");
const bruto = {
  disponivel: true,
  gerado_em: "2026-11-18T18:00:00Z",
  saude: { ultima_mensagem: "2026-11-18T17:50:00Z", ultimo_resumo: "2026-11-17T14:30:00Z", resumos_com_falha: 12, midias_24h: 4, midias_entendidas_24h: 4 },
  clientes: [
    { client_id: "a", cliente: "Acerbi", conversas: 13, respondidas: 13, mediana_resposta_min: 1, esperando_desde: null, mensagens_hoje: 5, ultima_da_agencia: "2026-11-18T16:00:00Z", ultima_do_cliente: "2026-11-18T15:59:00Z", mensagens: [] },
    {
      client_id: "m", cliente: "Mirante", conversas: 11, respondidas: 10, mediana_resposta_min: 7, esperando_desde: "2026-11-18T14:22:00Z", esperando_mensagens: 1,
      esperando_texto: "Pq estou longe", esperando_quem: "Simone", mensagens_hoje: 8, tarefas_abertas: 8, resumo_falhou_hoje: true,
      resumo: { dia: "2026-11-17", gerado_em: "2026-11-17T14:30:00Z", no_dossie: true, resumo: null, sugestoes: ["Cobrar a Simone", "", 3],
        itens: [{ tipo: "feito_agencia", texto: "A agência subiu o anúncio." }, { tipo: "pedido_cliente", texto: "Pediu a arte do feriado.", veio_de_audio: true }, { tipo: "inventado", texto: "x" }, { tipo: "decisao" }] },
      mensagens: [
        { id: "1", quando: "2026-11-18T14:15:00Z", papel: "agencia", nome: "Almir", tipo: "texto", texto: "Consegue mandar hoje?" },
        { id: "2", quando: "2026-11-18T14:22:00Z", papel: "cliente_equipe", nome: "Simone", tipo: "texto", texto: "Pq estou longe" },
        { id: "3", quando: "2026-11-18T14:23:00Z", papel: "cliente_decisor", nome: "Simone", tipo: "imagem", texto: null, descricao: "Print de conversa.", guardada: true },
        { id: "4", quando: "2026-11-18T09:00:00Z", papel: "bot", tipo: "texto", texto: "Post novo no ar" },
        { quando: "2026-11-18T09:00:00Z" },
      ] },
    { client_id: "s", cliente: "Stop", conversas: 3, respondidas: 3, mediana_resposta_min: 41, esperando_desde: "2026-11-18T17:30:00Z", mensagens: "nada" },
    { cliente: "sem id" },
  ],
};

describe("grupos ao vivo", () => {
  it("normaliza a leitura sem quebrar com campo ausente ou torto", () => {
    const g = normalizarGrupos(bruto);
    expect(g.disponivel).toBe(true);
    expect(g.clientes.map((c) => c.cliente)).toEqual(["Acerbi", "Mirante", "Stop"]);
    const m = g.clientes[1];
    expect([m.esperandoQuem, m.esperandoTexto, m.tarefasAbertas, m.resumoFalhouHoje]).toEqual(["Simone", "Pq estou longe", 8, true]);
    expect(m.resumo?.itens.map((i) => i.tipo)).toEqual(["feito_agencia", "pedido_cliente"]);
    expect(m.resumo?.itens[1].veioDeAudio).toBe(true);
    expect(m.resumo?.sugestoes).toEqual(["Cobrar a Simone"]);
    expect(m.mensagens.map((x) => x.papel)).toEqual(["agencia", "cliente", "cliente", "automatico"]);
    expect(g.clientes[2].mensagens).toEqual([]);
    expect(normalizarGrupos(null).disponivel).toBe(false);
    expect(normalizarGrupos({ disponivel: false }).clientes).toEqual([]);
  });

  it("papel do banco vira o que a tela mostra", () => {
    expect([papelNoGrupo("cliente_equipe"), papelNoGrupo("agencia"), papelNoGrupo("bot"), papelNoGrupo(null)]).toEqual(["cliente", "agencia", "automatico", "outro"]);
  });

  it("quem espera resposta vem primeiro, o mais antigo no topo", () => {
    const ordem = ordenarGrupos(normalizarGrupos(bruto).clientes).map((c) => c.cliente);
    expect(ordem).toEqual(["Mirante", "Stop", "Acerbi"]);
  });

  it("números do topo: espera, mensagens e a mediana do tempo de resposta", () => {
    const n = numerosDosGrupos(normalizarGrupos(bruto).clientes);
    expect(n).toEqual({ esperando: 2, mensagensHoje: 13, respostaMin: 7, conversas: 27, respondidas: 26 });
    expect(numerosDosGrupos([]).respostaMin).toBeNull();
  });

  it("a espera pesa pelo relógio: até 1 h é conversa, 3 h pede resposta", () => {
    expect(tomDaEspera(null, AGORA)).toBe("calmo");
    expect(tomDaEspera("2026-11-18T17:30:00Z", AGORA)).toBe("calmo");
    expect(tomDaEspera("2026-11-18T16:00:00Z", AGORA)).toBe("atencao");
    expect(tomDaEspera("2026-11-18T14:22:00Z", AGORA)).toBe("urgente");
  });

  it("tempo em palavras", () => {
    expect([haQuanto("2026-11-18T17:59:50Z", AGORA), haQuanto("2026-11-18T17:48:00Z", AGORA), haQuanto("2026-11-18T14:22:00Z", AGORA), haQuanto("2026-11-15T18:00:00Z", AGORA), haQuanto(null, AGORA)])
      .toEqual(["agora", "há 12 min", "há 4 h", "há 3 d", ""]);
    expect([duracao(7), duracao(60), duracao(95), duracao(1500), duracao(null)]).toEqual(["7 min", "1 h", "1 h 35", "1 d", "-"]);
  });

  it("resumo agrupado na ordem de quem precisa agir; mensagem sem texto mostra o que havia no arquivo", () => {
    const m = normalizarGrupos(bruto).clientes[1];
    expect(itensPorTipo(m.resumo!.itens).map((g) => g.tipo)).toEqual(["pedido_cliente", "feito_agencia"]);
    expect(linhaDaMensagem(m.mensagens[2])).toBe("Print de conversa.");
    expect(linhaDaMensagem({ ...m.mensagens[2], descricao: null })).toBe("Imagem");
    expect(linhaDaMensagem({ ...m.mensagens[2], descricao: null, tipo: "audio" })).toBe("Áudio sem transcrição");
  });
});
