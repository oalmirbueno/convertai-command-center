import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agruparPorDia, explicacaoDoMovimento, iconeDoMovimento, movimentosComoFatos, type Movimento } from "@/lib/movimentos";

/**
 * Regra do dono (2026-09-18): a Central reconhece sozinha qualquer movimento
 * (material novo e o que ele é, enviado para aprovação, aprovado, ajustes,
 * agendado, publicado, tarefa, marco, pedido, mensagem) e isso entra no
 * dossiê, no histórico do cliente e na geração dos rituais, com o dia certo.
 * Os antigos entram também, porque a leitura é direto das tabelas.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const migracao = ler("supabase/migrations/20260918160000_movimentos_do_cliente_no_dossie.sql");
const central = ler("src/pages/AdminExperience.tsx");
const diario = ler("src/components/shared/ProjectJournal.tsx");

describe("uma leitura só de todos os movimentos, no banco", () => {
  it("cobre arquivos (com o que o material é), aprovação, calendário, tarefas, marcos, diário e pedidos", () => {
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.movimentos_do_cliente(");
    for (const fonte of ["FROM capa c", "FROM public.file_approval_events ev", "FROM public.editorial_events e", "FROM public.tasks t", "FROM public.milestones m", "FROM public.project_memory pm", "FROM public.client_requests r"]) {
      expect(migracao).toContain(fonte);
    }
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.rotulo_do_material(");
    expect(migracao).toContain("THEN 'Carrossel'");
    expect(migracao).toContain("' lâminas)'");
    expect(migracao).toContain("'DD/MM \"às\" HH24:MI'");
  });

  it("o cliente lê o próprio histórico na voz 'você'; a equipe lê tudo", () => {
    expect(migracao).toContain("IF auth.uid() <> _client_id THEN");
    expect(migracao).toContain("'Você aprovou: '");
    expect(migracao).toContain("'Cliente aprovou: '");
    expect(migracao).toContain("WHERE (NOT _somente_visiveis OR t.visivel_ao_cliente)");
    expect(migracao).toContain("GRANT EXECUTE ON FUNCTION public.movimentos_do_cliente(uuid, timestamptz, timestamptz, boolean) TO authenticated, service_role;");
  });

  it("a seção automática do dossiê vira diário por dia, 14 dias, com agenda e o que aguarda aprovação", () => {
    expect(migracao).toContain("'## Avanços recentes (automático, '");
    expect(migracao).toContain("WHEN 1 THEN 'Segunda'");
    expect(migracao).toContain("_secao := public.dossie_avancos_texto(_client_id, 14);");
    expect(migracao).toContain("**Aguardando aprovação do cliente:**");
    expect(migracao).toContain("**Agenda à frente:**");
    expect(migracao).toContain("' [interno]'");
  });

  it("o dossiê acompanha o movimento na hora, inclusive quando é o cliente que age, e o lote de upload entra a cada 15 minutos", () => {
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.dossie_registrar_avancos_interno(uuid)".replace("(uuid)", "(_client_id uuid)"));
    expect(migracao).toContain("REVOKE ALL ON FUNCTION public.dossie_registrar_avancos_interno(uuid) FROM PUBLIC, anon, authenticated;");
    for (const tabela of ["public.file_approval_events", "public.editorial_events", "public.client_requests", "public.milestones"]) {
      expect(migracao).toContain(`CREATE TRIGGER movimento_atualiza_dossie AFTER INSERT${tabela === "public.milestones" ? " OR UPDATE OF status" : ""} ON ${tabela}`);
    }
    expect(migracao).toContain("cron.schedule('dossie-movimentos-15min', '*/15 * * * *'");
    // A porta pública continua exigindo equipe.
    expect(migracao).toContain("PERFORM app_private.require_rpc_client_staff(_client_id);\n  RETURN public.dossie_registrar_avancos_interno(_client_id);");
  });
});

describe("o texto para a IA e para o diário", () => {
  const base: Movimento = {
    quando: "2026-09-16T13:05:00Z", tipo: "aprovado", titulo: 'Cliente aprovou: Carrossel "Primavera" (4 lâminas)',
    titulo_cliente: 'Você aprovou: Carrossel "Primavera" (4 lâminas)', detalhe: null, visivel_ao_cliente: true, origem: "file_approval_events", ref_id: null, link: null,
  };
  const lista: Movimento[] = [
    base,
    { ...base, quando: "2026-09-18T15:30:00Z", tipo: "agendado", titulo: 'Agendado no calendário: Carrossel "Primavera" para 22/09 às 09:00 (Instagram)', titulo_cliente: 'Agendado para publicar: Carrossel "Primavera" em 22/09 às 09:00 (Instagram)' },
    { ...base, quando: "2026-09-18T16:00:00Z", tipo: "tarefa_feita", titulo: "Tarefa concluída: Revisar legenda", titulo_cliente: "Tarefa concluída: Revisar legenda", visivel_ao_cliente: false, detalhe: "linha 1\nlinha 2" },
  ];

  it("agrupa por dia no fuso do Brasil, do mais recente para o mais antigo", () => {
    const dias = agruparPorDia(lista);
    expect(dias.map((d) => d.rotulo)).toEqual(["Sexta, 18/09", "Quarta, 16/09"]);
    expect(dias[0].itens).toHaveLength(2);
  });

  it("os fatos para o ritual trazem dia e hora reais e marcam o que é interno", () => {
    const fatos = movimentosComoFatos(lista, { max: 40, dias: 14 });
    expect(fatos.startsWith("MOVIMENTOS DOS ÚLTIMOS 14 DIAS, DIA A DIA")).toBe(true);
    expect(fatos).toContain("Sexta, 18/09:");
    expect(fatos).toContain('- 12:30 · Agendado no calendário: Carrossel "Primavera" para 22/09 às 09:00 (Instagram)');
    expect(fatos).toContain("- 13:00 · Tarefa concluída: Revisar legenda — linha 1\nlinha 2 [interno: não citar ao cliente]");
    expect(fatos).toContain("Quarta, 16/09:");
    expect(fatos).toContain('- 10:05 · Cliente aprovou: Carrossel "Primavera" (4 lâminas)');
    expect(movimentosComoFatos([], {})).toBe("");
    expect(movimentosComoFatos(lista, { max: 1 })).toContain("(+2 movimentos anteriores no histórico.)");
  });

  it("ícone e explicação por tipo, na voz certa", () => {
    expect(iconeDoMovimento("agendado")).toBe("publication");
    expect(iconeDoMovimento("aprovado")).toBe("approved");
    expect(iconeDoMovimento("mensagem")).toBe("report");
    expect(explicacaoDoMovimento(lista[1], false)).toContain("vai ao ar sozinho na data marcada");
    expect(explicacaoDoMovimento(lista[1], true)).toBe("Entrou no calendário com data e hora.");
  });
});

describe("Central e diário do portal usam a mesma fonte", () => {
  it("a mensagem de avanço recebe os movimentos datados junto dos fatos do painel", () => {
    expect(central).toContain('import { lerMovimentos, movimentosComoFatos } from "@/lib/movimentos";');
    expect(central).toContain("lerMovimentos(c.id, { dias: 14 }).then((lista) => movimentosComoFatos(lista, { max: 40, dias: 14 }))");
    expect(central).toContain("const painel = [collectFacts(c, context), movimentos, ultima].filter(Boolean).join(");
  });

  it("o diário do cliente mostra o tipo do material e complementa com agendamento, ajustes, mensagem e pedido", () => {
    expect(diario).toContain('lerMovimentos(clientId, { dias: 120, somenteVisiveis: !canWrite })');
    expect(diario).toContain('const TIPOS_COMPLEMENTARES = new Set(["agendado", "reagendado", "ajustes_pedidos", "compartilhado", "mensagem", "pedido", "acao", "cancelado", "falha_publicacao"]);');
    expect(diario).toContain("title: canWrite ? m.titulo : m.titulo_cliente,");
    expect(diario).toContain('const rotulo = `${kindLabel(resolveKind(file))} "${nomeDoMaterial(file.file_name)}"${laminas}`;');
    expect(diario).toContain("title: `Material aprovado: ${rotulo}`,");
    expect(diario).not.toContain("title: `Material aprovado: ${file.file_name}`");
  });
});
