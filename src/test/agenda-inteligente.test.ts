import { describe, expect, it } from "vitest";
import { avisoDoDia, cabeNoDia, ehHype, encaixarNaAgenda, horaLivre, proximoEspaco, regraDoCliente, REGRA_PADRAO, type Ocupacao } from "../../supabase/functions/_shared/agenda-inteligente";

/**
 * 17/10/2026, dono: um post comum por dia (configurável), o hype pode dividir o dia em outro horário, a leva
 * se espalha pela semana em vez de 50 no mesmo dia, hype sempre perto de hoje, a data escolhida é respeitada.
 */
const HOJE = "2026-10-19"; // segunda
const ocup = (data: string, hora: string | null, hype = false): Ocupacao => ({ data, hora, hype });

describe("regra do dia", () => {
  it("padrão 1 comum + 1 hype com 3 horas; valores do cliente dentro dos limites", () => {
    expect(regraDoCliente(null)).toEqual(REGRA_PADRAO);
    expect(regraDoCliente({ posts_por_dia: 2, hypes_por_dia: 0, horas_entre_posts: 4 })).toEqual({ porDia: 2, hypesPorDia: 0, horasEntre: 4, fimDeSemana: false });
    expect(regraDoCliente({ posts_por_dia: 50 })).toEqual(REGRA_PADRAO);
  });
  it("dia com post comum não aceita outro comum, mas aceita o hype; fim de semana nunca", () => {
    const o = [ocup(HOJE, "11:30")];
    expect(cabeNoDia(o, HOJE, false)).toBe(false);
    expect(cabeNoDia(o, HOJE, true)).toBe(true);
    expect(cabeNoDia([], "2026-10-24", false)).toBe(false);
    expect(ehHype("Hype: Black Friday")).toBe(true);
    expect(ehHype("Nicho: IA nas buscas")).toBe(true);
    expect(ehHype("Concorrente @x: responder")).toBe(false);
  });
  it("hora do hype a pelo menos 3 horas do outro post do dia", () => {
    expect(horaLivre([ocup(HOJE, "11:30")], HOJE, "11:30")).toBe("14:30");
    // A mais perto da preferida que respeita as 3 horas das duas já marcadas.
    expect(horaLivre([ocup(HOJE, "11:30"), ocup(HOJE, "14:30", true)], HOJE, "12:00")).toBe("08:30");
  });
});

describe("leva sem empilhar", () => {
  it("50 posts pedidos no mesmo dia viram um por dia útil", () => {
    const itens = Array.from({ length: 10 }, () => ({ data: HOJE, hype: false }));
    const r = encaixarNaAgenda(itens, [], { hoje: HOJE, inicio: HOJE, fim: "2026-11-30", horaPreferida: "11:30" });
    const datas = r.map((x) => x.data);
    expect(new Set(datas).size).toBe(10);
    expect(datas[0]).toBe(HOJE);
    expect(datas.every((d) => [0, 6].indexOf(new Date(`${d}T12:00:00Z`).getUTCDay()) < 0)).toBe(true);
  });
  it("hype pode dividir o dia com o comum, em outro horário, e nunca vai para dezembro", () => {
    const r = encaixarNaAgenda([{ data: "2026-12-10", hype: true }], [ocup(HOJE, "11:30")], { hoje: HOJE, inicio: HOJE, fim: "2026-12-31", horaPreferida: "11:30" });
    expect(r[0].data).toBe(HOJE);
    expect(r[0].hora).toBe("14:30");
  });
  it("data escolhida pela equipe fica, com o aviso do dia cheio", () => {
    const r = encaixarNaAgenda([{ data: HOJE, hype: false, fixa: true }], [ocup(HOJE, "11:30")], { hoje: HOJE, inicio: HOJE, fim: "2026-11-30", horaPreferida: "11:30" });
    expect(r[0]).toMatchObject({ data: HOJE, mudou: false });
    expect(r[0].aviso).toContain("já tem 1 post");
    expect(avisoDoDia([ocup(HOJE, "11:30")], HOJE, false)).toContain("limite 1 por dia");
  });
  it("próximo espaço livre pula o dia cheio e o fim de semana", () => {
    const o = [ocup("2026-10-23", "11:30")]; // sexta cheia
    expect(proximoEspaco(o, { desde: "2026-10-23", ate: "2026-10-31", hype: false, horaPreferida: "11:30" })).toEqual({ data: "2026-10-26", hora: "11:30" });
  });
});

describe("fim de semana por cliente (24/10)", () => {
  const FDS = regraDoCliente({ posts_por_dia: 3, postar_fim_de_semana: true });
  it("desligado mantém tudo como antes; ligado aceita sábado e domingo", () => {
    expect(regraDoCliente({ postar_fim_de_semana: "sim" }).fimDeSemana).toBe(false);
    expect(FDS).toEqual({ porDia: 3, hypesPorDia: 1, horasEntre: 3, fimDeSemana: true });
    expect(cabeNoDia([], "2026-10-31", false)).toBe(false);
    expect(cabeNoDia([], "2026-10-31", false, FDS)).toBe(true);
    expect(cabeNoDia([], "2026-11-01", false, FDS)).toBe(true);
    expect(avisoDoDia([], "2026-10-31", false, FDS)).toBeNull();
    expect(avisoDoDia([], "2026-10-31", false)).toContain("fim de semana");
  });
  it("próximo espaço e encaixe ficam no sábado só para quem posta no fim de semana", () => {
    const o = [ocup("2026-10-30", "11:30")];
    expect(proximoEspaco(o, { desde: "2026-10-30", ate: "2026-11-06", hype: false, horaPreferida: "11:30" })?.data).toBe("2026-11-02");
    expect(proximoEspaco(o, { desde: "2026-10-30", ate: "2026-11-06", hype: false, horaPreferida: "11:30", regra: FDS })).toEqual({ data: "2026-10-30", hora: "14:30" });
    const r = encaixarNaAgenda([{ data: "2026-10-31", hype: false }, { data: "2026-11-01", hype: false }], [], { hoje: HOJE, inicio: HOJE, fim: "2026-11-30", horaPreferida: "11:30", regra: FDS });
    expect(r.map((x) => x.data)).toEqual(["2026-10-31", "2026-11-01"]);
    const semFds = encaixarNaAgenda([{ data: "2026-10-31", hype: false }], [], { hoje: HOJE, inicio: HOJE, fim: "2026-11-30", horaPreferida: "11:30" });
    expect(semFds[0].data).toBe("2026-11-02");
  });
  it("contrato: Mês, gravar, Entrega e agendador leem a coluna nova", () => {
    const ler = (p: string) => require("node:fs").readFileSync(p, "utf8") as string;
    const f = ler("supabase/functions/agente-calendario/index.ts");
    expect(f).toContain("p._fim_de_semana = await fimDeSemanaDoCliente(servico, p.client_id);");
    expect(f).toContain("if (ehDiaUtil(d) || (fimDeSemana && DATA.test(d))) dias.push(d);");
    expect(ler("src/components/mesa/AbaEntrega.tsx")).toContain("data-fim-de-semana-editar");
    expect(ler("src/components/mesa/agendaInteligenteApi.ts")).toContain("_postar_fim_de_semana: r.fimDeSemana === true");
    const m = ler("supabase/migrations/20261024150000_fim_de_semana_por_cliente.sql");
    expect(m).toContain("ADD COLUMN IF NOT EXISTS postar_fim_de_semana boolean NOT NULL DEFAULT false");
    expect(m).toContain("_quando := public.mesa_proximo_horario_do_cliente(_t.client_id, _task.due_date, _hora, _fuso);");
  });
});

describe("contrato: a agenda inteligente nos caminhos que criam e agendam", () => {
  const ler = (p: string) => require("node:fs").readFileSync(p, "utf8") as string;
  it("Mês: planejamento, campanha e pedido livre passam pelo encaixe; data citada fica", () => {
    const f = ler("supabase/functions/agente-calendario/index.ts");
    expect(f).toContain("const datas = datasPelaAgenda(distribuirDatas(ordenados.length, uteis, ctx.datasOcupadas), uteis, ctx);");
    expect(f).toContain("fixa: citadas.has(i.data)");
    expect(f).toContain('servico.from("mesa_cliente_config").select("posts_por_dia, hypes_por_dia, horas_entre_posts, postar_fim_de_semana")');
    expect(f).toContain("pauta_pronta: obj({");
  });
  it("Estúdio: a hora da publicação fica longe das outras do dia", () => {
    expect(ler("supabase/functions/estudio-arte/publicacao-da-peca.ts")).toContain("export async function horaComEspacoNoDia(");
    expect(ler("supabase/functions/estudio-arte/index.ts")).toContain("const hora = await horaComEspacoNoDia(db, { clientId: t.client_id, dia: s.dia, hora: s.hora, fuso, excluirPostId: t.post_id ?? null });");
  });
  it("tela: arte rápida sugere o próximo espaço livre e avisa o dia cheio; a Entrega configura a regra", () => {
    const r = ler("src/components/mesa/EstudioArteRapida.tsx");
    expect(r).toContain("data-aviso-da-agenda");
    expect(r).toContain("proximoEspaco(agenda.data.ocupacao");
    expect(ler("src/components/mesa/AbaEntrega.tsx")).toContain("salvarRegraDoDia(clientId");
    expect(ler("supabase/migrations/20261017173319_agenda_inteligente_por_cliente.sql")).toContain("CREATE OR REPLACE FUNCTION public.mesa_config_agenda(");
  });
});
