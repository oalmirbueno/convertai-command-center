import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const pagina = ler("src/pages/AdminComercial.tsx");
const layout = ler("src/components/AppLayout.tsx");
const agenda = ler("src/components/comercial/AgendaComercial.tsx");
const kanban = ler("src/components/comercial/FunilKanban.tsx");
const atividades = ler("src/components/comercial/AtividadesDoLead.tsx");
const lib = ler("src/lib/comercial.ts");
const migration = ler(
  "supabase/migrations/20260821230000_agenda_com_compromisso_proprio.sql",
);

/**
 * O relato: "está sem a aba CRM e a agenda dentro do comercial, e ali está
 * tudo junto". Eram três coisas de uma vez: a aba se chamava Funil e não
 * anunciava o que era, a agenda era uma lista quando devia ser calendário, e
 * cinco cartões de número ficavam empilhados no topo das quatro telas, iguais
 * em todas, obrigando a ler tudo para achar o que servia àquela.
 */

describe("cada aba é uma área, com nome que diz o que é", () => {
  it("a aba se chama CRM", () => {
    expect(pagina).toContain('{ id: "crm", label: "CRM"');
    expect(pagina).toContain('const ABAS_VALIDAS: Aba[] = ["crm", "agenda", "metas", "marketing"]');
  });

  it("o menu leva direto para CRM e para Agenda", () => {
    expect(layout).toContain('{ title: "CRM", url: "/comercial"');
    expect(layout).toContain('{ title: "Agenda", url: "/comercial/agenda"');
  });

  it("cada aba explica a si mesma, em vez da frase genérica do módulo", () => {
    // Quem abre Metas quer saber o que Metas faz, não o que o departamento faz.
    expect(pagina).toContain("const TITULO_DA_ABA: Record<Aba, string>");
    for (const aba of ["crm:", "agenda:", "metas:", "marketing:"]) {
      expect(pagina.slice(pagina.indexOf("TITULO_DA_ABA"))).toContain(aba);
    }
  });

  it("o seletor de mês só aparece onde o mês manda", () => {
    // CRM e agenda vivem no presente; metas e marketing olham um mês fechado.
    expect(pagina).toContain('{(aba === "metas" || aba === "marketing") && (');
  });

  it("os números moram dentro da aba que os usa", () => {
    // Antes eram cinco cartões iguais no topo das quatro telas. O cabeçalho
    // ficou só com identidade e abas; cada bloco de número vive dentro do
    // guard da aba a que pertence.
    const cabecalho = pagina.slice(
      pagina.indexOf("<header"),
      pagina.indexOf("</header>"),
    );
    expect(cabecalho).not.toContain("<Tile");
    expect(pagina).toContain('titulo="Previsão do mês"');
    expect(pagina).toContain('titulo="Receita do mês"');
  });
});

describe("a agenda virou calendário de mês", () => {
  it("desenha a grade do mês, não uma lista", () => {
    // Lista responde "o que faço agora"; calendário responde "como está
    // minha semana", que é a pergunta de quem vai marcar reunião.
    expect(agenda).toContain("const celulas = useMemo");
    expect(agenda).toContain("DIAS_DA_SEMANA");
    expect(agenda).toContain("grid-cols-7");
  });

  it("a grade começa no domingo da semana do dia 1", () => {
    // Mês que começa na quinta perderia os três primeiros dias.
    expect(agenda).toContain("inicio.setDate(inicio.getDate() - inicio.getDay())");
  });

  it("o dia do compromisso é o do relógio de quem olha", () => {
    // Reunião das 21h de Brasília cai no dia seguinte em UTC e apareceria
    // na casinha errada.
    expect(agenda).toContain("const diaDoCompromisso = (atividade: Atividade) =>");
    expect(agenda).toContain("diaIso(new Date(atividade.due_at))");
  });

  it("dá para marcar tocando no dia", () => {
    expect(agenda).toContain("setNovoEm(diaEscolhido)");
    expect(agenda).toContain("Marcar na agenda");
  });
});

describe("compromisso próprio: reunião sua, sem lead", () => {
  it("o banco aceita atividade sem lead", () => {
    expect(migration).toContain(
      "alter column lead_id drop not null",
    );
  });

  it("o robô de lembrete passou a LEFT JOIN, senão o próprio nunca avisaria", () => {
    // Com INNER JOIN o compromisso seria criado, ficaria na tela e nunca
    // dispararia: o pior tipo de falha, porque parece que funciona.
    expect(migration).toContain(
      "left join public.commercial_leads as lead on lead.id = atividade.lead_id",
    );
    expect(migration).toContain("atividade.lead_id is null or lead.archived_at is null");
  });

  it("a mensagem do sininho não inventa nome de lead quando não há", () => {
    expect(migration).toContain("when destinatarios.lead_name is null then");
    expect(migration).toContain("format('Hoje: %s', destinatarios.title)");
  });

  it("o aviso leva para a agenda, e não para a raiz do módulo", () => {
    expect(migration).toContain("'/comercial/agenda'");
  });

  it("a tela oferece marcar sem lead", () => {
    expect(agenda).toContain('<SelectItem value="proprio">Compromisso seu (sem lead)</SelectItem>');
    expect(agenda).toContain('leadId: leadId === "proprio" ? null : leadId');
  });

  it("só o compromisso ligado a lead vira linha na história dele", () => {
    expect(lib).toContain("if (concluir && atividade.lead_id) {");
  });

  it("o tipo do lead na atividade aceita nulo", () => {
    expect(lib).toContain("lead_id: string | null;");
  });
});

describe("sem travessão no texto que aparece na tela", () => {
  const visiveis = (fonte: string) =>
    fonte
      .split("\n")
      .filter((linha) => {
        const limpa = linha.trim();
        // Comentário de código não é texto de tela.
        return !limpa.startsWith("*") && !limpa.startsWith("//") && !limpa.startsWith("/*");
      })
      .filter((linha) => linha.includes("—"));

  it.each([
    ["página", pagina],
    ["kanban", kanban],
    ["agenda", agenda],
    ["atividades do lead", atividades],
  ])("%s", (_nome, fonte) => {
    const sobrando = visiveis(fonte).filter((linha) => !linha.trim().startsWith("{/*"));
    expect(sobrando).toEqual([]);
  });
});
