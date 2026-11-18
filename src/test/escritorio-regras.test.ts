import { describe, expect, it } from "vitest";
import { CAMPOS_DA_REGRA, fraseDeUsos, inicioDaSemana, modelosDaRegra, podeLigar, quemUsaARegra, usosNestaSemana, validarLimites } from "@/lib/escritorio/regras";

/**
 * 18/11/2026: aba Regras do Escritório. As contas sem tela: conferir os
 * limites de cada regra antes de mandar para o banco, saber se a regra pode
 * ligar e contar os usos da semana (que começa na segunda-feira, 00:00).
 */

const MODELOS = {
  mensalidade_vencida: { nome: "Mensalidade vencida", texto: "Oi, [nome do cliente]. A mensalidade venceu." },
  lembrete_aprovacao: { nome: "Lembrete de aprovação", texto: "Oi, [nome do cliente]. Falta aprovar." },
  pedido_material: { nome: "Pedido de material", texto: "Oi, [nome do cliente]. Pode mandar o material?" },
};
const MENSAGENS = { hora_inicio: 9, hora_fim: 18, max_por_assunto: 2, intervalo_dias: 6, modelos: MODELOS };
const erros = (r: ReturnType<typeof validarLimites>) => (r.ok ? {} : r.erros);

describe("limites de cada regra", () => {
  it("conteúdo: rejeições inteiras de 0 a 5; o texto digitado vira número", () => {
    expect(validarLimites("conteudo_revisado", { max_rejeicoes: " 3 " })).toEqual({ ok: true, limites: { max_rejeicoes: 3 } });
    expect(validarLimites("conteudo_revisado", { max_rejeicoes: 0 }).ok).toBe(true);
    expect(erros(validarLimites("conteudo_revisado", { max_rejeicoes: "6" }))).toEqual({ max_rejeicoes: "Use um número de 0 a 5." });
    expect(erros(validarLimites("conteudo_revisado", { max_rejeicoes: "-1" }))).toEqual({ max_rejeicoes: "Use um número de 0 a 5." });
    expect(erros(validarLimites("conteudo_revisado", { max_rejeicoes: "1,5" }))).toEqual({ max_rejeicoes: "Use um número inteiro." });
    expect(erros(validarLimites("conteudo_revisado", { max_rejeicoes: "" }))).toEqual({ max_rejeicoes: "Preencha este campo." });
    expect(erros(validarLimites("conteudo_revisado", { max_rejeicoes: "duas" }))).toEqual({ max_rejeicoes: "Use só números." });
    expect(erros(validarLimites("conteudo_revisado", {}))).toEqual({ max_rejeicoes: "Preencha este campo." });
  });

  it("tráfego: teto de 0 a 100000 aceita centavos com vírgula; dias sem coleta de 1 a 14", () => {
    expect(validarLimites("trafego_ate_o_teto", { teto_semana_brl: "120,50", dias_sem_coleta: "3" })).toEqual({ ok: true, limites: { teto_semana_brl: 120.5, dias_sem_coleta: 3 } });
    expect(validarLimites("trafego_ate_o_teto", { teto_semana_brl: 100000, dias_sem_coleta: 14 }).ok).toBe(true);
    expect(erros(validarLimites("trafego_ate_o_teto", { teto_semana_brl: "100000,01", dias_sem_coleta: "0" }))).toEqual({
      teto_semana_brl: "Use um número de 0 a 100000.", dias_sem_coleta: "Use um número de 1 a 14.",
    });
    expect(erros(validarLimites("trafego_ate_o_teto", { teto_semana_brl: "120", dias_sem_coleta: "15" }))).toEqual({ dias_sem_coleta: "Use um número de 1 a 14." });
  });

  it("mensagens: horas de 0 a 23 com início antes do fim, 1 a 5 por assunto, intervalo de 1 a 30", () => {
    expect(validarLimites("mensagens_de_rotina", { ...MENSAGENS, hora_inicio: "0", hora_fim: "23", max_por_assunto: "5", intervalo_dias: "30" })).toEqual({
      ok: true, limites: { hora_inicio: 0, hora_fim: 23, max_por_assunto: 5, intervalo_dias: 30, modelos: MODELOS },
    });
    expect(erros(validarLimites("mensagens_de_rotina", { ...MENSAGENS, hora_inicio: "18", hora_fim: "18" }))).toEqual({ hora_fim: "A hora de fim precisa ser depois da hora de início." });
    expect(erros(validarLimites("mensagens_de_rotina", { ...MENSAGENS, hora_inicio: "19", hora_fim: "9" }))).toEqual({ hora_fim: "A hora de fim precisa ser depois da hora de início." });
    expect(erros(validarLimites("mensagens_de_rotina", { ...MENSAGENS, hora_inicio: "24", hora_fim: "-1", max_por_assunto: "0", intervalo_dias: "31" }))).toEqual({
      hora_inicio: "Use um número de 0 a 23.", hora_fim: "Use um número de 0 a 23.", max_por_assunto: "Use um número de 1 a 5.", intervalo_dias: "Use um número de 1 a 30.",
    });
    expect(erros(validarLimites("mensagens_de_rotina", { ...MENSAGENS, max_por_assunto: "6", intervalo_dias: "0" }))).toEqual({
      max_por_assunto: "Use um número de 1 a 5.", intervalo_dias: "Use um número de 1 a 30.",
    });
  });

  it("mensagens: o texto do modelo vai sem espaço sobrando; vazio só passa com a regra desligada", () => {
    const comVazio = { ...MENSAGENS, modelos: { ...MODELOS, pedido_material: { nome: "Pedido de material", texto: "   " } } };
    const desligada = validarLimites("mensagens_de_rotina", comVazio, { ligada: false });
    expect(desligada.ok && (desligada.limites.modelos as typeof MODELOS).pedido_material).toEqual({ nome: "Pedido de material", texto: "" });
    expect(erros(validarLimites("mensagens_de_rotina", comVazio, { ligada: true }))).toEqual({ "modelo:pedido_material": "Com a regra ligada, o texto não pode ficar vazio." });
    const comEspaco = validarLimites("mensagens_de_rotina", { ...MENSAGENS, modelos: { ...MODELOS, pedido_material: { nome: "Pedido de material", texto: "  Oi, [nome do cliente].  " } } });
    expect(comEspaco.ok && (comEspaco.limites.modelos as typeof MODELOS).pedido_material.texto).toBe("Oi, [nome do cliente].");
  });

  it("o que a tela não edita segue junto, porque o banco troca os limites inteiros; regra desconhecida passa como veio", () => {
    expect(validarLimites("conteudo_revisado", { max_rejeicoes: "1", outro: "fica" })).toEqual({ ok: true, limites: { max_rejeicoes: 1, outro: "fica" } });
    expect(validarLimites("regra_nova", { qualquer: "coisa" })).toEqual({ ok: true, limites: { qualquer: "coisa" } });
    expect(Object.keys(CAMPOS_DA_REGRA)).toEqual(["conteudo_revisado", "trafego_ate_o_teto", "mensagens_de_rotina"]);
  });

  it("modelos: na ordem do banco, com o nome e o texto; sem modelos, lista vazia", () => {
    expect(modelosDaRegra(MENSAGENS).map((m) => [m.chave, m.nome])).toEqual([["mensalidade_vencida", "Mensalidade vencida"], ["lembrete_aprovacao", "Lembrete de aprovação"], ["pedido_material", "Pedido de material"]]);
    expect(modelosDaRegra({ modelos: { solto: null } })).toEqual([{ chave: "solto", nome: "solto", texto: "" }]);
    expect(modelosDaRegra({ max_rejeicoes: 1 })).toEqual([]);
    expect(modelosDaRegra(null)).toEqual([]);
  });
});

describe("a regra pode ligar?", () => {
  it("mensagens com qualquer texto vazio não liga; com todos colados, liga", () => {
    const vazios = { ...MENSAGENS, modelos: { ...MODELOS, lembrete_aprovacao: { nome: "Lembrete de aprovação", texto: " " } } };
    expect(podeLigar({ chave: "mensagens_de_rotina", limites: vazios })).toEqual({ pode: false, motivo: "Falta colar o texto dos modelos." });
    expect(podeLigar({ chave: "mensagens_de_rotina", limites: {} })).toEqual({ pode: false, motivo: "Falta colar o texto dos modelos." });
    expect(podeLigar({ chave: "mensagens_de_rotina", limites: MENSAGENS })).toEqual({ pode: true, motivo: null });
  });

  it("as outras regras ligam sempre", () => {
    expect(podeLigar({ chave: "conteudo_revisado", limites: { max_rejeicoes: 1 } }).pode).toBe(true);
    expect(podeLigar({ chave: "trafego_ate_o_teto", limites: {} }).pode).toBe(true);
  });
});

describe("usos da semana", () => {
  const local = (ano: number, mes: number, dia: number, hora = 0, min = 0) => new Date(ano, mes - 1, dia, hora, min).getTime();
  const iso = (ms: number) => new Date(ms).toISOString();

  it("a semana começa na segunda-feira, 00:00, no horário local", () => {
    // 18/11/2026 é quarta-feira; a segunda é 16/11.
    expect(inicioDaSemana(local(2026, 11, 18, 15, 30))).toBe(local(2026, 11, 16));
    expect(inicioDaSemana(local(2026, 11, 16))).toBe(local(2026, 11, 16));
    expect(inicioDaSemana(local(2026, 11, 16, 0, 1))).toBe(local(2026, 11, 16));
    // Domingo ainda é da semana que começou na segunda anterior.
    expect(inicioDaSemana(local(2026, 11, 22, 23, 59))).toBe(local(2026, 11, 16));
    expect(inicioDaSemana(local(2026, 11, 23))).toBe(local(2026, 11, 23));
  });

  it("conta só os usos da regra desde segunda-feira", () => {
    const agora = local(2026, 11, 18, 15, 30);
    const usos = [
      { regra: "conteudo_revisado", usado_em: iso(local(2026, 11, 18, 10)) },
      { regra: "conteudo_revisado", usado_em: iso(local(2026, 11, 16)) },
      { regra: "conteudo_revisado", usado_em: iso(local(2026, 11, 15, 23, 59)) },
      { regra: "trafego_ate_o_teto", usado_em: iso(local(2026, 11, 17, 8)) },
    ];
    expect(usosNestaSemana(usos, "conteudo_revisado", agora)).toBe(2);
    expect(usosNestaSemana(usos, "trafego_ate_o_teto", agora)).toBe(1);
    expect(usosNestaSemana(usos, "mensagens_de_rotina", agora)).toBe(0);
    expect(usosNestaSemana([], "conteudo_revisado", agora)).toBe(0);
  });

  it("a frase da contagem e de quem usa a regra", () => {
    expect(fraseDeUsos(0)).toBe("usada 0 vezes nesta semana");
    expect(fraseDeUsos(1)).toBe("usada 1 vez nesta semana");
    expect(fraseDeUsos(12)).toBe("usada 12 vezes nesta semana");
    const nome = (slug: string) => ({ trafe: "Trafe", lia: "Lia" } as Record<string, string>)[slug] ?? slug;
    expect(quemUsaARegra([], nome)).toBe("qualquer agente");
    expect(quemUsaARegra(null, nome)).toBe("qualquer agente");
    expect(quemUsaARegra(["trafe", "lia", "novo"], nome)).toBe("Trafe, Lia, novo");
  });
});
