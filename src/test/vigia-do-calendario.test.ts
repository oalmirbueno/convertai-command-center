// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import * as zod from "zod";
import * as seguranca from "../../supabase/functions/_shared/mcp-security";
import * as guardaDoCliente from "../../supabase/functions/_shared/mcp-client-id-guard";
import {
  classificar,
  decidirAtrasados,
  descricaoDaTarefa,
  escolherPautas,
  type FatosDoCliente,
  type HypeDosFatos,
  medir,
  metaDoCliente,
  precisaPreparar,
  primeiroBuraco,
  sequenciaDeFormatos,
  tituloDaTarefa,
  urgencia,
} from "../../supabase/functions/agente-calendario/modulos/vigia-do-calendario";
import { normalizarResumo } from "@/lib/resumoDoDia";

/**
 * Vigia do calendário, publicação atrasada, resumo do dia e faxina (26/10/2026). Dono: "não pode o cliente
 * ficar sem postar mais de 3 dias"; "já tem que preparar algo e me avisar"; "enxuto"; "tarefas sem sentido
 * devem sumir". O cálculo é código (sem IA); o banco guarda um estado por cliente e uma tarefa por cliente.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const MIGRATION = ler("supabase/migrations/20261026190000_vigia_do_calendario_e_resumo_do_dia.sql");
const FAXINA = ler("supabase/migrations/20261026190100_faxina_das_tarefas.sql");
const AGENTE = ler("supabase/functions/agente-calendario/index.ts");

/** O corpo de uma função SQL da migration (do create até o $$; final). */
function corpoDaFuncao(sql: string, nome: string): string {
  const i = sql.indexOf(`create or replace function public.${nome}(`);
  expect(i, `função ${nome} na migration`).toBeGreaterThanOrEqual(0);
  const abre = sql.indexOf("$$", i);
  const fecha = sql.indexOf("$$;", abre + 2);
  return sql.slice(i, fecha + 3);
}

const HOJE = "2026-10-26"; // segunda
const CLIENTE = "33333333-3333-4333-8333-333333333333";

function fatos(parcial: Partial<FatosDoCliente> = {}): FatosDoCliente {
  return { client_id: CLIENTE, nome: "Verzelo", futuros: [], atrasados: [], ...parcial };
}

// ─── 1. Classificação ──────────────────────────────────────────

describe("vigia classifica cada cliente certo", () => {
  it("sem nada nos próximos 14 dias: sem post agendado, preparar o plano de 2 semanas até hoje", () => {
    const f = fatos({ ultimo_post: "2026-10-15" });
    const m = medir(f, HOJE);
    expect(m).toMatchObject({ dias_sem_post: 11, prox14: 0, meta_semana: 3, meta_fonte: "padrao", buraco_em: HOJE });
    const c = classificar(m, f, HOJE);
    expect(c.estado).toBe("sem_post_agendado");
    expect(c.situacao).toBe("sem post agendado");
    expect(c.faltam).toBe(6);
    expect(c.preparar_ate).toBe(HOJE);
    expect(c.motivos).toContain("11 dias sem post");
  });

  it("vai passar de 3 dias sem post nesta semana: 'vai ficar 3 dias sem post em dd/mm'", () => {
    // Postou hoje, próximo só dia 31: 27, 28, 29 sem post (3 dias) e 30 é o primeiro dia acima do limite.
    const f = fatos({ ultimo_post: HOJE, futuros: [{ dia: "2026-10-31", n: 1 }, { dia: "2026-11-03", n: 1 }, { dia: "2026-11-05", n: 1 }, { dia: "2026-11-07", n: 1 }, { dia: "2026-11-08", n: 1 }] });
    const m = medir(f, HOJE);
    expect(m.buraco_em).toBe("2026-10-30");
    const c = classificar(m, f, HOJE);
    expect(c.estado).toBe("vai_ficar_sem_post");
    expect(c.situacao).toBe("vai ficar 3 dias sem post em 30/10");
    expect(c.faltam).toBe(1);
    expect(c.preparar_ate).toBe("2026-10-29");
  });

  it("agendado que passou da hora e não saiu, com o resto do calendário cheio: atrasado", () => {
    const futuros = ["2026-10-27", "2026-10-29", "2026-10-31", "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-08"].map((dia) => ({ dia, n: 1 }));
    const f = fatos({ ultimo_post: "2026-10-24", futuros, atrasados: [{ id: "p1", titulo: "Poda", quando: "2026-10-25T15:00:00Z", status: "planned", conta: true, liberada: false, segurada: false }] });
    const c = classificar(medir(f, HOJE), f, HOJE);
    expect(c.estado).toBe("atrasado");
    expect(c.situacao).toBe("atrasado: agendado não publicado");
    expect(c.motivos.join(" ")).toContain("1 agendado não publicado (desde 25/10)");
    expect(c.faltam).toBe(0);
  });

  it("atrasado que a vigia já pôs no ar não conta mais como atraso", () => {
    const futuros = ["2026-10-27", "2026-10-29", "2026-10-31", "2026-11-02", "2026-11-04", "2026-11-06"].map((dia) => ({ dia, n: 1 }));
    const f = fatos({ ultimo_post: "2026-10-25", futuros, atrasados: [{ id: "p1", titulo: "Poda", quando: "2026-10-24T15:00:00Z", status: "planned", conta: true, liberada: true, segurada: false, tentativa: "agendado" }] });
    expect(classificar(medir(f, HOJE), f, HOJE).estado).toBe("em_dia");
  });

  it("sem buraco mas com menos posts que o plano: calendário abaixo do plano", () => {
    const futuros = ["2026-10-28", "2026-10-31", "2026-11-03", "2026-11-06"].map((dia) => ({ dia, n: 1 }));
    const f = fatos({ ultimo_post: "2026-10-25", futuros });
    const c = classificar(medir(f, HOJE), f, HOJE);
    expect(c.estado).toBe("abaixo_do_plano");
    expect(c.situacao).toBe("calendário abaixo do plano");
    expect(c.faltam).toBe(2);
  });

  it("calendário cheio e sem atraso: em dia, nada a preparar", () => {
    const futuros = ["2026-10-27", "2026-10-29", "2026-10-31", "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-08"].map((dia) => ({ dia, n: 1 }));
    const f = fatos({ ultimo_post: HOJE, futuros });
    const c = classificar(medir(f, HOJE), f, HOJE);
    expect(c).toMatchObject({ estado: "em_dia", faltam: 0, preparar_ate: null });
  });

  it("a meta vem de Posts por mês quando há; senão 3 por semana", () => {
    expect(metaDoCliente(12)).toEqual({ meta: 3, fonte: "plano" });
    expect(metaDoCliente(8)).toEqual({ meta: 2, fonte: "plano" });
    expect(metaDoCliente(null)).toEqual({ meta: 3, fonte: "padrao" });
    const f = fatos({ posts_por_mes: 8, ultimo_post: HOJE, futuros: [{ dia: "2026-10-29", n: 1 }, { dia: "2026-11-01", n: 1 }, { dia: "2026-11-04", n: 1 }, { dia: "2026-11-07", n: 1 }] });
    expect(classificar(medir(f, HOJE), f, HOJE).estado).toBe("em_dia");
  });

  it("buraco: cada dia com post zera a conta; nunca postou = hoje", () => {
    expect(primeiroBuraco(HOJE, "2026-10-23", new Set())).toBe("2026-10-27"); // 24, 25, 26 sem post = 3 dias; o 27 passa
    expect(primeiroBuraco(HOJE, "2026-10-22", new Set())).toBe(HOJE);
    expect(primeiroBuraco(HOJE, "2026-10-24", new Set())).toBe("2026-10-28");
    expect(primeiroBuraco(HOJE, null, new Set([HOJE]))).toBe("2026-10-30");
    expect(primeiroBuraco(HOJE, null, new Set())).toBe(HOJE);
  });

  it("o mais grave prepara primeiro", () => {
    const sem = fatos({ ultimo_post: "2026-10-10" });
    const abaixo = fatos({ ultimo_post: "2026-10-25", futuros: [{ dia: "2026-10-28", n: 1 }, { dia: "2026-10-31", n: 1 }] });
    const u = (f: FatosDoCliente) => { const m = medir(f, HOJE); return urgencia(classificar(m, f, HOJE), m); };
    expect(u(sem)).toBeLessThan(u(abaixo));
  });
});

// ─── 2. Sem duplicar ───────────────────────────────────────────

describe("vigia não duplica alerta nem tarefa", () => {
  it("um estado por cliente: chave client_id e upsert por client_id", () => {
    expect(MIGRATION).toContain("client_id uuid primary key references public.profiles(id) on delete cascade");
    expect(AGENTE).toContain('.from("vigia_calendario_estado").upsert(estados, { onConflict: "client_id" })');
  });

  it("uma tarefa por cliente: origem vigia:calendario no índice único (projeto + origem) e reaproveitada", () => {
    expect(AGENTE).toContain("origem_externa: ORIGEM_DA_TAREFA");
    expect(AGENTE).toContain("const t = l.f.tarefa ?? null;");
    expect(MIGRATION).toContain("tk.origem_externa = 'vigia:calendario' and tk.deleted_at is null");
    // A tarefa só é reescrita quando algo mudou (sem barulho a cada meia hora).
    expect(AGENTE).toContain("if (t.titulo === titulo && (t.descricao ?? \"\") === descricao && t.due_date === prazo && t.status !== \"done\") return t.id;");
  });

  it("preparo (com custo) só com risco e no máximo a cada 5 dias, salvo falta maior", () => {
    const agora = new Date("2026-10-26T12:00:00Z");
    const risco = { estado: "sem_post_agendado" as const, situacao: "", motivos: [], faltam: 4, preparar_ate: HOJE };
    expect(precisaPreparar(risco, null, agora)).toBe(true);
    expect(precisaPreparar(risco, { preparado_em: "2026-10-25T12:00:00Z", preparo: "feito", pautas: new Array(4).fill({}) }, agora)).toBe(false);
    expect(precisaPreparar(risco, { preparado_em: "2026-10-20T12:00:00Z", preparo: "feito", pautas: new Array(4).fill({}) }, agora)).toBe(true);
    expect(precisaPreparar(risco, { preparado_em: "2026-10-26T11:00:00Z", preparo: "parcial", pautas: [] }, agora)).toBe(false);
    expect(precisaPreparar({ ...risco, estado: "em_dia", faltam: 0 }, null, agora)).toBe(false);
    expect(precisaPreparar({ ...risco, estado: "atrasado", faltam: 0 }, null, agora)).toBe(false);
  });

  it("prepara um cliente por chamada e só busca o que está em alta sem a busca da semana e com saldo", () => {
    expect(AGENTE).toContain("const alvo = fila[0] ?? null;");
    expect(AGENTE).toContain("if (autorValido && !alvo.f.hype_desta_semana && temSaldo) {");
  });
});

// ─── 3. Publicar o atrasado: só com aprovação, uma vez ──────────

describe("publicar o atrasado só com aprovação e uma vez", () => {
  const agora = new Date("2026-10-26T18:00:00Z");
  const base = { id: "a", titulo: "Poda", quando: "2026-10-26T09:00:00Z", status: "planned", plataforma: "instagram", conta: true, liberada: true, segurada: false };

  it("planejado, aprovado, com conta, entre 6 h e 7 dias: publica", () => {
    expect(decidirAtrasados([base], agora)[0]).toMatchObject({ acao: "publicar" });
  });

  it("sem aprovação, sem conta, segurado, já tentado, cedo demais ou velho demais: nunca publica", () => {
    const casos = [
      { ...base, liberada: false },
      { ...base, conta: false },
      { ...base, segurada: true },
      { ...base, tentativa: "falhou" },
      { ...base, quando: "2026-10-26T15:00:00Z" },
      { ...base, quando: "2026-10-15T15:00:00Z" },
      { ...base, status: "scheduled" },
      { ...base, plataforma: "facebook" },
    ];
    for (const c of casos) expect(decidirAtrasados([c], agora)[0].acao, JSON.stringify(c)).toBe("avisar");
    expect(decidirAtrasados([{ ...base, liberada: false }], agora)[0].motivo).toBe("falta a aprovação da arte");
  });

  it("no banco: aprovação (arte liberada), não segurado, uma tentativa só, pelo caminho oficial", () => {
    const f = corpoDaFuncao(MIGRATION, "vigia_publicar_atrasado");
    expect(f).toContain("coalesce(public.editorial_file_is_publishable(");
    expect(f).toContain("and not public.mesa_publicacao_segurada(");
    expect(f).toContain("if exists (select 1 from public.vigia_publicacoes_tentadas t where t.publication_id = _publication_id) then");
    expect(f).toContain("'ja_tentado'");
    expect(f).toContain("perform public.transition_editorial_publication_unlocked(_pub.id, 'schedule', _pub.version, _quando, _pub.tz);");
    expect(f).toContain("and p.status = 'planned'");
    expect(f).toContain("p.scheduled_at < now() - interval '6 hours'");
    expect(f).toContain("p.scheduled_at >= now() - interval '7 days'");
    // A tentativa é gravada antes do bloco que pode falhar: a falha fica registrada e não repete.
    expect(f.indexOf("insert into public.vigia_publicacoes_tentadas")).toBeLessThan(f.indexOf("perform public.transition_editorial_publication_unlocked"));
    expect(MIGRATION).toContain("grant execute on function public.vigia_publicar_atrasado(uuid, text) to service_role;");
    expect(MIGRATION).not.toMatch(/grant execute on function public\.vigia_publicar_atrasado\(uuid, text\) to authenticated/);
  });
});

// ─── 4. Pauta pronta ───────────────────────────────────────────

describe("pauta pronta vem do que está em alta, sem repetir nem voltar ao que foi mal", () => {
  const hype = (titulo: string, nota: number | null, extra: Partial<HypeDosFatos> = {}): HypeDosFatos => ({
    semana: "2026-10-26", tipo: "hype", titulo, janela: "esta_semana", formato: "carrossel", nota,
    pauta: { tema: titulo, gancho: `Gancho de ${titulo}`, laminas: ["capa", "dois", "tres", "cta"], legenda: `Legenda de ${titulo}` }, ...extra,
  });

  it("maior nota primeiro; vencido, nota baixa, assunto da agenda e tema ruim ficam fora", () => {
    const hypes = [
      hype("Halloween seguro no jardim", 7),
      hype("Black Friday da poda programada", 9),
      hype("Nota baixa demais", 3),
      hype("Hype velho de outubro", 9, { semana: "2026-10-05" }),
      hype("Poda de primavera antes das chuvas", 8),
      hype("Gramado amarelado no calor", 8.5, { tipo: "nicho" }),
    ];
    const p = escolherPautas(hypes, { hoje: HOJE, quantas: 5, temasNaAgenda: ["Poda de primavera antes das chuvas"], evitar: ["Gramado amarelado no calor de outubro"] });
    expect(p.map((x) => x.tema)).toEqual(["Black Friday da poda programada", "Halloween seguro no jardim"]);
    expect(p[0]).toMatchObject({ gancho: "Gancho de Black Friday da poda programada", legenda: "Legenda de Black Friday da poda programada", origem: "hype" });
  });

  it("nos formatos da mistura: a vaga de vídeo leva o tema como vídeo (gravar)", () => {
    const hypes = [hype("Um", 9), hype("Dois", 8, { formato: "estatico" }), hype("Tres", 7)];
    const formatos = sequenciaDeFormatos({ video: 1, carrossel: 1, estatico: 1 }, 3);
    expect(formatos).toEqual(["video", "carrossel", "estatico"]);
    const p = escolherPautas(hypes, { hoje: HOJE, quantas: 3, formatos });
    expect(p.map((x) => x.formato)).toEqual(["video", "carrossel", "estatico"]);
    expect(p.find((x) => x.formato === "estatico")!.tema).toBe("Dois");
    expect(p.find((x) => x.formato === "video")!.laminas.length).toBe(1);
  });

  it("nunca mais que 6 pautas", () => {
    const nomes = ["Halloween", "Finados", "Proclamação", "Consciência", "Black Friday", "Natal", "Réveillon", "Férias", "Verão", "Chuva", "Podas", "Gramado"];
    const muitas = nomes.map((n, i) => hype(n, 9 - i * 0.1));
    expect(escolherPautas(muitas, { hoje: HOJE, quantas: 10 }).length).toBe(6);
  });
});

// ─── 5. A tarefa: "Cliente · Área · assunto", enxuta ────────────

describe("a tarefa da vigia", () => {
  it("nome no padrão da casa", () => {
    const c = { estado: "sem_post_agendado" as const, situacao: "sem post agendado", motivos: [], faltam: 4, preparar_ate: "2026-10-29" };
    expect(tituloDaTarefa("Verzelo", c, 0)).toBe("Verzelo · Conteúdo · preparar 4 posts até 29/10");
    expect(tituloDaTarefa("Verzelo", { ...c, faltam: 1 }, 0)).toBe("Verzelo · Conteúdo · preparar 1 post até 29/10");
    expect(tituloDaTarefa("Stop", { ...c, estado: "atrasado", faltam: 0, preparar_ate: null }, 2)).toBe("Stop · Conteúdo · resolver 2 agendados que não saíram");
  });

  it("descrição curta com a pauta e o link da Mesa", () => {
    const f = fatos({ ultimo_post: "2026-10-15" });
    const m = medir(f, HOJE);
    const c = classificar(m, f, HOJE);
    const texto = descricaoDaTarefa({
      clientId: CLIENTE, classificacao: c, medida: m, ultimoPost: "2026-10-15",
      pautas: [{ tema: "Poda programada", gancho: "Sua árvore aguenta o verão?", formato: "carrossel", legenda: "Agende.", laminas: [], origem: "hype", assunto: "Verão", nota: 8 }],
      ruins: [{ titulo: "Post institucional" }],
    });
    expect(texto).toContain("Situação: sem post agendado");
    expect(texto).toContain('1. [Carrossel] Poda programada · gancho: "Sua árvore aguenta o verão?"');
    expect(texto).toContain("Faltam 5: use Propor temas no Mês.");
    expect(texto).toContain('Evitar (foram mal, alcance abaixo da metade do normal): "Post institucional".');
    expect(texto).toContain(`Abrir: /mesa?client=${CLIENTE}`);
    expect(texto.length).toBeLessThan(3800);
  });
});

// ─── 6. Resumo do dia ───────────────────────────────────────────

describe("resumo do dia: limitado, um aviso por dia, no formato da tela /hoje", () => {
  const interno = corpoDaFuncao(MIGRATION, "resumo_do_dia_interno");

  it("no máximo 10 linhas por seção (campanhas, 5)", () => {
    const limites = interno.match(/\n\s+limit (\d+)\n/g)?.map((x) => Number(x.trim().split(" ")[1])) ?? [];
    expect(limites).toEqual([10, 10, 10, 5, 10, 10]);
  });

  it("devolve as chaves que a tela lê", () => {
    for (const chave of ["'gerado_em'", "'anuncios'", "'mudancas'", "'alertas'", "'calendario'", "'clientes_em_risco'", "'precisa_de_voce'", "'feito_ontem'", "'dias_sem_post'", "'falta'", "'sugestao'", "'prova_url'", "'link_id'", "'aprovacao_id'"]) {
      expect(interno).toContain(chave);
    }
  });

  it("um exemplo no formato do banco passa pelo leitor da tela", () => {
    const r = normalizarResumo({
      gerado_em: "2026-10-26T11:00:00Z",
      anuncios: { mudancas: [{ id: "m1", client_id: CLIENTE, cliente: "Verzelo", acao: "pausar", alvo: "Conjunto A", quem: "paperclip", quando: "2026-10-26T10:00:00Z", prova_url: "https://x" }], alertas: [{ cliente: "Verzelo", nivel: "critico", texto: "CPL subiu" }] },
      calendario: { clientes_em_risco: [{ client_id: CLIENTE, nome: "Verzelo", situacao: "sem post agendado", dias_sem_post: 11, falta: "preparar 6 posts até 26/10", sugestao: "pauta pronta: Carrossel \"Poda\"" }], campanhas: [] },
      precisa_de_voce: [{ id: "p1", tipo: "mensagem", titulo: "Mensagem da semana para aprovar", cliente: "Verzelo", area: "Atendimento", link: "/central/mensagens" }],
      feito_ontem: [{ id: "f1", titulo: "2 posts publicados", cliente: "Verzelo", area: "Conteúdo", quando: "2026-10-25T14:00:00Z", prova_url: "https://instagram.com/p/x" }],
    });
    expect(r.clientesEmRisco[0]).toMatchObject({ clientId: CLIENTE, situacao: "sem post agendado", diasSemPost: 11, falta: "preparar 6 posts até 26/10" });
    expect(r.precisaDeVoce[0].tipo).toBe("mensagem");
    expect(r.mudancas).toHaveLength(1);
    expect(r.feitoOntem[0].provaUrl).toBe("https://instagram.com/p/x");
  });

  it("um aviso por dia, às 8h, só para os admins, com link /hoje; sem nada a dizer, não toca", () => {
    const avisar = corpoDaFuncao(MIGRATION, "resumo_do_dia_avisar");
    expect(avisar).toContain("'ja_avisado_hoje'");
    expect(avisar).toContain("'nada_a_avisar'");
    expect(avisar).toContain("'resumo_do_dia', '/hoje'");
    expect(avisar).toContain("not ilike 'n8n@%'");
    expect(MIGRATION).toContain("perform cron.schedule('resumo-do-dia-aviso', '0 11 * * *'");
    expect(MIGRATION).toContain("perform cron.schedule('vigia-calendario', '7,37 9-21 * * *'");
    expect(MIGRATION).toContain("body := jsonb_build_object('acao', 'vigia_do_calendario_interno')");
    expect(AGENTE).toContain('acao === "vigia_do_calendario_interno") return await vigiaDoCalendarioInterno(servico, corpo);');
  });

  it("a tela é só da equipe; os fatos e o preparo só pela chave de serviço", () => {
    expect(corpoDaFuncao(MIGRATION, "resumo_do_dia")).toContain("not coalesce(public.is_staff(auth.uid()), false)");
    expect(MIGRATION).toContain("revoke all on function public.vigia_calendario_fatos(timestamptz) from public, anon, authenticated;");
    expect(MIGRATION).toContain("revoke all on function public.resumo_do_dia_interno() from public, anon, authenticated;");
  });
});

// ─── 7. Faxina: simula sem alterar ──────────────────────────────

describe("faxina simula sem alterar e encerra sem apagar", () => {
  const faxina = corpoDaFuncao(FAXINA, "faxina_das_tarefas");
  const candidatos = corpoDaFuncao(FAXINA, "faxina_das_tarefas_candidatos");

  it("simular é o padrão e toda escrita fica dentro do 'não simular'", () => {
    expect(FAXINA).toContain("create or replace function public.faxina_das_tarefas(_simular boolean default true)");
    const bloco = faxina.indexOf("if not coalesce(_simular, true) then");
    const fim = faxina.indexOf("end if;", bloco);
    expect(bloco).toBeGreaterThan(0);
    const escritas = [...faxina.matchAll(/\b(insert into|update public\.|delete from|truncate|create temporary)/g)].map((m) => m.index!);
    expect(escritas.length).toBeGreaterThan(0);
    for (const i of escritas) expect(i > bloco && i < fim, `escrita fora do bloco em ${i}`).toBe(true);
    expect(candidatos).toMatch(/\bstable\b/);
    expect(candidatos).not.toMatch(/\b(insert|update|delete)\s/i);
  });

  it("encerra sem apagar: tarefa ganha deleted_at, vínculo vira parado, cópia com o motivo para desfazer", () => {
    expect(faxina).not.toMatch(/delete\s+from/i);
    expect(faxina).toContain("update public.tasks t set deleted_at = now()");
    expect(faxina).toContain("set status = 'parado'");
    expect(faxina).toContain("insert into app_private.arquivo_limpeza (lote, tabela, acao, linha)");
    expect(faxina).toContain("'motivo_da_faxina'");
  });

  it("os quatro motivos e o que fica sempre", () => {
    for (const motivo of ["'duplicada'", "'vencida_automatica'", "'sem_dono_sem_prazo'", "'vinculo_parado'", "'vinculo_sem_tarefa'", "'vinculo_de_tarefa_concluida'", "'vinculo_de_tarefa_encerrada'"]) {
      expect(candidatos).toContain(motivo);
    }
    expect(candidatos).toContain("not like 'client_request:%'");
    expect(candidatos).toContain("<> 'client_feedback'");
    expect(candidatos).toContain("<> 'vigia:calendario'");
    expect(candidatos).toContain("o.created_at < now() - interval '14 days'");
    expect(candidatos).toContain("o.due_date < (select d from hoje) - 7");
    expect(faxina).toContain("has_role(auth.uid(), 'admin'::public.app_role)");
    expect(FAXINA).not.toMatch(/cron\.schedule/);
  });
});

// ─── 8. create_task do MCP: "Cliente · Área · assunto" ──────────

type Consulta = { tabela: string; op: string; valor?: unknown; filtros: Array<[string, string, unknown]> };
function bancoFalso(responder: (q: Consulta) => { data: unknown; error: unknown }) {
  const consultas: Consulta[] = [];
  const from = (tabela: string) => {
    const q: Consulta = { tabela, op: "", filtros: [] };
    consultas.push(q);
    const b: Record<string, unknown> = {};
    const filtro = (nome: string) => (col: string, v?: unknown) => { q.filtros.push([nome, col, v]); return b; };
    Object.assign(b, {
      select: () => { if (!q.op) q.op = "select"; return b; },
      insert: (v: unknown) => { q.op = "insert"; q.valor = v; return b; },
      update: (v: unknown) => { q.op = "update"; q.valor = v; return b; },
      eq: filtro("eq"), neq: filtro("neq"), in: filtro("in"), is: filtro("is"), gte: filtro("gte"), gt: filtro("gt"), lt: filtro("lt"),
      contains: filtro("contains"), not: (c: string, o: string, v: unknown) => { q.filtros.push(["not", c, [o, v]]); return b; },
      order: () => b, limit: () => b, maybeSingle: () => b, single: () => b,
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(responder(q)).then(ok, erro),
    });
    return b;
  };
  return { consultas, banco: { from, rpc: async () => ({ data: null, error: null }) } };
}
function servicoDeEscrita(responder: (q: Consulta) => { data: unknown; error: unknown }) {
  const falso = bancoFalso(responder);
  const js = transpileModule(ler("supabase/functions/_shared/mcp-write-services.ts"), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const deps: Record<string, unknown> = {
    "https://esm.sh/@supabase/supabase-js@2.45.4": { createClient: () => falso.banco },
    "https://esm.sh/zod@3.23.8": zod,
    "./mcp-security.ts": seguranca,
    "./mcp-client-id-guard.ts": guardaDoCliente,
  };
  const exp: Record<string, any> = {};
  new Function("exports", "require", "Deno", js)(exp, (n: string) => {
    if (!(n in deps)) throw new Error(`Unexpected dependency: ${n}`);
    return deps[n];
  }, { env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://x.supabase.co" : k === "SUPABASE_SERVICE_ROLE_KEY" ? "chave" : undefined) } });
  return { ...falso, mod: exp };
}
const PROJETO = "44444444-4444-4444-8444-444444444444";
const CTX = { keyId: "532d49bb-9b15-427f-bada-ce4e10bb5092", origin: "mcp", correlationId: "c1", dataScope: { unrestricted: true, clientIds: [], principalUserId: null, source: "api_key" } };

describe("create_task do MCP nasce 'Cliente · Área · assunto'", () => {
  const { mod } = servicoDeEscrita(() => ({ data: [], error: null }));

  it("prefixa o cliente e a área (pelo tipo de entrega ou pelo assunto) só quando falta", () => {
    expect(mod.tituloNoPadraoDaCasa("Pausar conjunto com CPL alto", "Verzelo - Jardins e Poda de árvores")).toBe("Verzelo - Jardins e Poda de árvores · Tráfego · Pausar conjunto com CPL alto");
    expect(mod.tituloNoPadraoDaCasa("Softy — retomar mensagens", "Softy Móveis")).toBe("Softy Móveis · Operação · Retomar mensagens");
    expect(mod.tituloNoPadraoDaCasa("ACE-275 | Meta: arquivar anúncio", "AcelerIQ")).toBe("Aceleriq · Tráfego · ACE-275 | Meta: arquivar anúncio");
    expect(mod.tituloNoPadraoDaCasa("Revisar copy", "Stop Informatica", "carousel")).toBe("Stop Informatica · Conteúdo · Revisar copy");
    expect(mod.tituloNoPadraoDaCasa("Stop Informatica · Site · Trocar banner", "Stop Informatica")).toBe("Stop Informatica · Site · Trocar banner");
    expect(mod.tituloNoPadraoDaCasa("Sem cliente", null)).toBe("Sem cliente");
  });

  it("grava o título no padrão e reconhece a tarefa antiga pelo assunto", async () => {
    const criar = servicoDeEscrita((q) => {
      if (q.tabela === "projects") return { data: { id: PROJETO, client_id: CLIENTE, deleted_at: null }, error: null };
      if (q.tabela === "profiles") return { data: { company_name: "Verzelo", full_name: null }, error: null };
      if (q.tabela === "tasks" && q.op === "insert") return { data: { id: "t-nova" }, error: null };
      return { data: [], error: null };
    });
    await criar.mod.createTask(criar.mod.createTaskSchema.parse({ project_id: PROJETO, title: "Relatório semanal", idempotency_key: "chave-padrao-1" }), CTX);
    const insert = criar.consultas.find((q) => q.tabela === "tasks" && q.op === "insert")!;
    expect((insert.valor as Record<string, unknown>).title).toBe("Verzelo · Relatório · Relatório semanal");

    const antiga = servicoDeEscrita((q) => {
      if (q.tabela === "projects") return { data: { id: PROJETO, client_id: CLIENTE, deleted_at: null }, error: null };
      if (q.tabela === "profiles") return { data: { company_name: "Verzelo", full_name: null }, error: null };
      if (q.tabela === "tasks" && q.op === "select") return { data: [{ id: "t-velha", title: "Verzelo — relatório  semanal", status: "todo" }], error: null };
      return { data: [], error: null };
    });
    const r = await antiga.mod.createTask(antiga.mod.createTaskSchema.parse({ project_id: PROJETO, title: "Relatório semanal", idempotency_key: "chave-padrao-2" }), CTX);
    expect(r).toMatchObject({ ja_existia: true, record: { id: "t-velha" } });
    expect(antiga.consultas.find((q) => q.tabela === "tasks" && q.op === "insert")).toBeUndefined();
  });
});
