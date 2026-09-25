import { describe, expect, it } from "vitest";
import {
  aberturaDoRitual,
  extrairMemoriaDoRitual,
  montarContextoDeContinuidade,
  verificarRepeticao,
  type PendenciasAbertas,
  type RitualAnterior,
} from "../../supabase/functions/ritual-writer/memoria";
import { juntarRituais, lerContextoDoRitual, semanasSeguidasComRitual } from "../../supabase/functions/ritual-writer/contexto";
import { normalizarTarefas, proximoPassoDoTexto } from "../../supabase/functions/ritual-writer/escritor";
import { blocoDoMetodoParaPrompt, faseDoCliente, METODO_ACELERA, ORDEM_ACELERA } from "../../supabase/functions/_shared/metodo-acelera";
import { phaseForClient, PHASE_LABELS } from "@/lib/cycleTasks";

const SEXTA = `Boa tarde, Priscila.
Fechamos a semana com a campanha de primavera no ar e o calendário de outubro montado.

*O que avançou*
• A campanha de primavera entrou no ar na quarta para trazer pedidos de orçamento pelo WhatsApp.
• O calendário de outubro ficou pronto com doze publicações ligadas à oferta do mês.

*O que vem agora*
Na segunda a gente começa a produzir os vídeos curtos da oferta de outubro.

*Precisamos de você*
Aprovando as três artes de outubro até terça, elas entram no ar na data planejada.

Tudo detalhado no painel: aceleriq.online`;

const SEGUNDA_NOVA = `Bom dia, Priscila.
A semana começa com os vídeos curtos da oferta de outubro em produção, como combinamos na sexta.

*O plano desta semana*
• Gravar e editar dois vídeos curtos mostrando o antes e depois dos jardins atendidos.
• Ajustar o público dos anúncios para bairros com mais pedidos de poda.

*O que vem agora*
Na quarta mostramos a primeira versão dos vídeos para você aprovar.

Tudo detalhado no painel: aceleriq.online`;

const vazio: PendenciasAbertas = { aprovacoes: [], tarefasAtrasadas: [], pedidosAbertos: [], agendaProxima: [] };

describe("conferência de repetição (determinística)", () => {
  it("texto igual ao anterior passa do limite com índice alto e frases repetidas", () => {
    const r = verificarRepeticao(SEXTA, [{ quando: "2026-09-19T18:00:00Z", titulo: "Primavera no ar", texto: SEXTA }]);
    expect(r.acima_do_limite).toBe(true);
    expect(r.indice).toBeGreaterThan(0.9);
    expect(r.frases_repetidas.length).toBeGreaterThanOrEqual(2);
    expect(r.abertura_repetida).not.toBeNull();
    expect(r.motivos.join(" ")).toMatch(/parecido/);
  });

  it("segunda que continua a sexta (assunto novo, retomada curta) não é repetição", () => {
    const r = verificarRepeticao(SEGUNDA_NOVA, [{ quando: "2026-09-19T18:00:00Z", texto: SEXTA }]);
    expect(r.acima_do_limite).toBe(false);
    expect(r.indice).toBeLessThan(0.3);
    expect(r.motivos).toEqual([]);
  });

  it("o cumprimento e a linha fixa do painel nunca contam como repetição", () => {
    const a = "Bom dia, Priscila.\nHoje a gente mostra a vitrine nova da loja com as fotos do estúdio.\n\nTudo detalhado no painel: aceleriq.online";
    const b = "Bom dia, Priscila.\nOs anúncios de sábado trouxeram onze conversas novas no WhatsApp da loja.\n\nTudo detalhado no painel: aceleriq.online";
    const r = verificarRepeticao(b, [{ quando: "2026-09-22T12:00:00Z", texto: a }]);
    expect(r.abertura_repetida).toBeNull();
    expect(r.acima_do_limite).toBe(false);
  });

  it("abertura repetida é pega mesmo com o resto do texto diferente", () => {
    const antes = "Boa tarde, João.\nA semana fecha com a base do perfil pronta para crescer.\n\n*Resumo*\nAs fotos da equipe entraram no destaque do perfil.";
    const agora = "Boa tarde, João.\nA semana fecha com a base do perfil pronta para crescer.\n\n*Resumo*\nO anúncio de inverno trouxe seis pedidos de orçamento novos.";
    const r = verificarRepeticao(agora, [{ quando: "2026-09-19T12:00:00Z", texto: antes }]);
    expect(r.abertura_repetida?.abertura).toContain("A semana fecha");
    expect(r.acima_do_limite).toBe(true);
  });

  it("mesma sequência de títulos do ritual anterior vira aviso de estrutura", () => {
    const outro = SEXTA.replace(/campanha de primavera/g, "campanha de inverno").replace(/outubro/g, "novembro").replace(/doze/g, "oito");
    const r = verificarRepeticao(outro, [{ quando: "2026-09-19T12:00:00Z", texto: SEXTA }]);
    expect(r.estrutura_igual).not.toBeNull();
  });

  it("sem anteriores, nada a conferir", () => {
    const r = verificarRepeticao(SEXTA, []);
    expect(r).toMatchObject({ indice: 0, acima_do_limite: false, comparados: 0 });
  });
});

describe("memória do ritual", () => {
  it("extrai abertura, estrutura, assuntos e promessas do texto de WhatsApp", () => {
    const m = extrairMemoriaDoRitual(SEXTA, "Aprovar as três artes de outubro até terça.");
    expect(m.abertura).toContain("Fechamos a semana");
    expect(m.estrutura).toEqual(["O que avançou", "O que vem agora", "Precisamos de você"]);
    expect(m.assuntos[0]).toMatch(/^O que avançou: A campanha de primavera/);
    expect(m.promessas.some((p) => p.includes("vídeos curtos"))).toBe(true);
    expect(m.promessas.some((p) => p.includes("três artes"))).toBe(true);
    // O próximo passo que já está dito no texto não entra duplicado.
    expect(m.promessas.filter((p) => p.includes("três artes")).length).toBe(1);
  });

  it("abertura ignora o cumprimento e pega a frase que importa", () => {
    expect(aberturaDoRitual("Bom dia, Ana.\nA loja nova ganhou a primeira campanha da semana.")).toBe("A loja nova ganhou a primeira campanha da semana.");
  });

  it("o próximo passo sai do bloco O que vem agora quando a IA esquece o campo", () => {
    expect(proximoPassoDoTexto(SEXTA)).toContain("vídeos curtos");
  });

  it("tarefas sugeridas ficam curtas, sem repetição e com frente e prazo válidos", () => {
    const t = normalizarTarefas([
      { titulo: "Editar os dois vídeos de outubro", passo: "Cortar em 20 s", frente: "social", prazo_dias: 3, promessa: "vídeos curtos" },
      { titulo: "Editar os dois vídeos de outubro", passo: "duplicada" },
      { titulo: "Subir verba", frente: "outra", prazo_dias: 99 },
      { titulo: "ok" },
    ]);
    expect(t).toHaveLength(2);
    expect(t[1]).toMatchObject({ frente: "geral", prazo_dias: 14 });
  });
});

describe("bloco de continuidade para o escritor", () => {
  const rituais: RitualAnterior[] = [
    { quando: "2026-09-19T18:00:00Z", tipo: "prova_movimento", titulo: "Primavera no ar", texto: SEXTA, proximo_passo: "Aprovar as três artes até terça.", situacao: "enviado" },
    { quando: "2026-09-15T12:00:00Z", tipo: "rota_semana", titulo: "Semana da primavera", texto: SEGUNDA_NOVA, proximo_passo: null, situacao: "enviado" },
  ];

  it("traz progressão do dia, o que já foi dito, promessas, mudanças, pendências e método", () => {
    const texto = montarContextoDeContinuidade({
      agora: new Date("2026-09-22T12:00:00Z"),
      ritualPedido: "rota_semana",
      rituais,
      movimentos: [
        { quando: "2026-09-20T13:10:00Z", titulo: "Cliente aprovou: arte da oferta", visivel_ao_cliente: true },
        { quando: "2026-09-21T10:00:00Z", titulo: "Estúdio gerou 3 artes", visivel_ao_cliente: false },
      ],
      desde: "2026-09-19T18:00:00Z",
      pendencias: { ...vazio, aprovacoes: [{ nome: "Carrossel outubro", dias: 4 }], tarefasAtrasadas: [{ titulo: "Legenda do reels", prazo: "2026-09-20" }] },
      metodo: blocoDoMetodoParaPrompt("executar", "rota_semana"),
      cerebro: "CÉREBRO DO CLIENTE\n- Evitar fundo preto",
    });
    expect(texto).toContain("Segunda PLANEJA");
    expect(texto).toContain("É PROIBIDO repetir a abertura");
    expect(texto).toContain("ENVIADO");
    expect(texto).toContain("PROMESSAS DO ÚLTIMO RITUAL ENVIADO");
    expect(texto).toContain("vídeos curtos");
    expect(texto).toContain("O QUE MUDOU DESDE O ÚLTIMO RITUAL");
    expect(texto).toContain("[interno: não citar ao cliente]");
    expect(texto).toContain("Pronto esperando o aval do cliente: Carrossel outubro (há 4 dia(s))");
    expect(texto).toContain("Tarefa interna com prazo vencido: Legenda do reels (prazo 20/09)");
    expect(texto).toContain("MÉTODO ACELERA");
    expect(texto).toContain("Evitar fundo preto");
    // O método vem antes da memória: é curto e decide a condução.
    expect(texto.indexOf("MÉTODO ACELERA")).toBeLessThan(texto.indexOf("O QUE JÁ FOI DITO"));
  });

  it("respeita o teto de caracteres", () => {
    const longo = Array.from({ length: 8 }, (_, i) => ({ ...rituais[0], quando: `2026-09-${10 + i}T12:00:00Z`, texto: SEXTA.repeat(4) }));
    const texto = montarContextoDeContinuidade({
      agora: new Date("2026-09-22T12:00:00Z"), ritualPedido: "prova_movimento", rituais: longo, movimentos: [], desde: null, pendencias: vazio,
      cerebro: "x".repeat(4000), limite: 3000,
    });
    expect(texto.length).toBeLessThanOrEqual(3000);
  });

  it("sem ritual anterior, avisa que é o começo e não inventa histórico", () => {
    const texto = montarContextoDeContinuidade({ agora: new Date(), ritualPedido: "meio_semana", rituais: [], movimentos: [], desde: null, pendencias: vazio });
    expect(texto).toContain("não há ritual registrado");
    expect(texto).toContain("Quarta ACOMPANHA");
  });
});

describe("rituais anteriores lidos do banco", () => {
  const rep = (over: Record<string, unknown>) => ({
    id: "r1", title: "t", summary: SEXTA, next_steps: "p", status: "published", created_at: "2026-09-19T18:00:00Z",
    metrics: { ritual_type: "prova_movimento", sent_at: "2026-09-19T19:00:00Z" }, ...over,
  });

  it("não compara o rascunho com ele mesmo, ignora rascunho velho e não duplica o diário", () => {
    const lista = juntarRituais(
      [
        rep({ id: "atual", status: "draft", created_at: "2026-09-22T10:00:00Z", metrics: { ritual_type: "rota_semana" } }),
        rep({ id: "velho", status: "draft", created_at: "2026-09-10T10:00:00Z", metrics: { ritual_type: "prova_movimento" } }),
        rep({ id: "r1" }),
        rep({ id: "sem-ritual", metrics: {} }),
      ],
      [
        { id: "m1", content: `${SEXTA}\n\nPróximo passo combinado: p`, created_at: "2026-09-19T19:00:00Z", metadata: { report_id: "r1" } },
        { id: "m2", content: "Marcado no Ciclo.", created_at: "2026-09-17T19:00:00Z", metadata: {} },
        { id: "m3", content: SEGUNDA_NOVA, created_at: "2026-09-15T12:00:00Z", metadata: { ritual_type: "rota_semana" } },
      ],
      "atual",
    );
    expect(lista.map((r) => r.quando)).toEqual(["2026-09-19T19:00:00Z", "2026-09-15T12:00:00Z"]);
    expect(lista[0]).toMatchObject({ situacao: "enviado", tipo: "prova_movimento" });
  });

  it("conta semanas seguidas com ritual marcado no Ciclo, da passada para trás", () => {
    const agora = new Date("2026-09-24T12:00:00Z"); // quinta; segunda = 21/09
    expect(semanasSeguidasComRitual(["2026-09-14", "2026-09-07", "2026-08-24"], agora)).toBe(2);
    expect(semanasSeguidasComRitual(["2026-09-21"], agora)).toBe(0);
  });

  it("monta o contexto com um banco de mentira e transforma fonte quebrada em aviso", async () => {
    const tabelas: Record<string, unknown[] | Error> = {
      profiles: [{ id: "c1", created_at: "2026-05-01T00:00:00Z", onboarding_done: true }],
      reports: [rep({})],
      project_memory: [],
      projects: [{ id: "p1" }],
      files: [{ id: "f1", file_name: "Carrossel outubro", created_at: "2026-09-18T12:00:00Z" }],
      client_requests: [{ id: "q1", title: "Trocar a foto da capa", status: "open", created_at: "2026-09-20T12:00:00Z" }, { id: "q2", title: "velho", status: "done" }],
      editorial_publications: [{ id: "e1", scheduled_at: "2026-09-25T15:00:00Z", editorial_posts: { title: "Reels da poda" } }],
      cycle_rituals: [],
      social_metrics_weekly: [
        { external_account_id: "a", week_start: "2026-09-15", followers: 1200, reach: 3000, total_interactions: 90 },
        { external_account_id: "a", week_start: "2026-09-08", followers: 1150, reach: 2500, total_interactions: 80 },
      ],
      ads_campaign_daily: new Error("sem permissão"),
      ads_sales: [],
      tasks: [{ title: "Legenda do reels", due_date: "2026-09-20" }],
      agente_memoria: [{ id: "a1", agente: "geral", area: "geral", categoria: "evitar", texto: "Nunca usar fundo preto", ativa: true, criado_em: "2026-09-01T00:00:00Z" }],
      ads_aprendizados: [], file_approval_events: [], social_post_metrics: [],
    };
    const construtor = (tabela: string) => {
      const resposta = () => {
        const v = tabelas[tabela];
        return v instanceof Error ? { data: null, error: { message: v.message } } : { data: v ?? [], error: null };
      };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "lte", "lt", "neq", "in", "is", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = () => Promise.resolve({ data: (resposta().data as unknown[] | null)?.[0] ?? null, error: null });
      q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, erro);
      return q;
    };
    const db = {
      from: construtor,
      rpc: (_fn: string) => Promise.resolve({ data: [{ quando: "2026-09-21T12:00:00Z", titulo: "Cliente aprovou: arte", detalhe: null, visivel_ao_cliente: true }], error: null }),
    };
    const ctx = await lerContextoDoRitual(db, "c1", { ritual: "rota_semana", agora: new Date("2026-09-22T12:00:00Z") });
    expect(ctx.anteriores).toHaveLength(1);
    expect(ctx.fase).toBe("revisar");
    expect(ctx.contagem).toMatchObject({ rituais: 1, movimentos: 1, aprovacoes: 1, tarefasAtrasadas: 1, pedidos: 1, agenda: 1 });
    expect(ctx.texto).toContain("Reels da poda");
    expect(ctx.texto).toContain("Trocar a foto da capa");
    expect(ctx.texto).not.toContain("velho");
    expect(ctx.texto).toContain("seguidores 1200 (+4% contra a semana anterior)");
    expect(ctx.texto).toContain("Nunca usar fundo preto");
    expect(ctx.avisos.some((a) => a.startsWith("anuncios"))).toBe(true);
  });
});

describe("método Acelera", () => {
  it("tem as sete fases do Ciclo, na mesma ordem e com os mesmos nomes", () => {
    expect([...ORDEM_ACELERA]).toEqual(Object.keys(PHASE_LABELS));
    for (const f of ORDEM_ACELERA) expect(METODO_ACELERA[f].nome).toBe(PHASE_LABELS[f]);
  });

  it("a fase do ritual é a mesma que o Ciclo mostra, para qualquer cliente", () => {
    for (const onboardingDone of [true, false, undefined]) {
      for (const daysAsClient of [0, 10, 20, 45, 70, 95, 130, 400]) {
        for (const closedStreak of [0, 3, 4, 8]) {
          const e = { onboardingDone, daysAsClient, closedStreak };
          expect(faseDoCliente(e).fase).toBe(phaseForClient(e));
        }
      }
    }
  });

  it("o bloco do prompt diz o que o ritual do dia conduz na fase e o sinal para subir", () => {
    const b = blocoDoMetodoParaPrompt("lancar", "prova_movimento", "45 dias de casa");
    expect(b).toContain("fase L · Lançar (45 dias de casa)");
    expect(b).toContain(METODO_ACELERA.lancar.ritual.sexta);
    expect(b).toContain("Sinal para subir para Executar");
    expect(b).not.toContain("—");
  });
});
