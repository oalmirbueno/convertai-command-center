import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENTES_COM_BASE } from "../../supabase/functions/_shared/agentes-com-base";

// 17/10 (dono): "cada um tendo uma base de aprendizado, onde eu consigo mandar documentos,
// atualizar, complementar com mais prompt; quanto mais eu carrego, mais inteligente ele fica".
const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

/** Onde cada agente lê a base na geração. */
const LIGACOES: Record<string, string[]> = {
  "estudio.diretor": ["supabase/functions/estudio-arte/index.ts"],
  "estudio.imagem": ["supabase/functions/estudio-arte/index.ts"],
  "mes.estrategista": ["supabase/functions/agente-calendario/index.ts"],
  "contexto.agente": ["supabase/functions/agente-contexto/index.ts"],
  "ads.estatico": ["supabase/functions/mesa-ads/index.ts"],
  "ads.video": ["supabase/functions/mesa-ads/index.ts"],
  "ads.gestor": ["supabase/functions/mesa-ads/index.ts"],
  "videos.diretor": ["supabase/functions/mesa-videos/diretor.ts"],
  "foto.diretor": ["supabase/functions/mesa-foto/index.ts"],
  "motion.agente": ["supabase/functions/mesa-motion/index.ts"],
  "roteiros.roteirista": ["supabase/functions/mesa-roteiros/index.ts"],
};

describe("base dos agentes", () => {
  it("todo agente do catálogo lê a própria base na geração", () => {
    expect(Object.keys(LIGACOES).sort()).toEqual(AGENTES_COM_BASE.map((a) => a.chave).sort());
    for (const [chave, arquivos] of Object.entries(LIGACOES)) {
      for (const arq of arquivos) {
        const fonte = ler(arq);
        expect(fonte, `${arq} importa a base`).toContain('from "../_shared/base-do-agente.ts"');
        expect(fonte, `${arq} lê ${chave}`).toContain(`agente: "${chave}"`);
      }
    }
  });

  it("o gerador de imagem do Estúdio continua sem a base: ela vai para o diretor, que escreve o pedido de imagem", () => {
    const estudio = ler("supabase/functions/estudio-arte/index.ts");
    expect(estudio).toContain("PARA O PEDIDO DE IMAGEM DE CADA LÂMINA (layout.imagem)");
    expect(ler("supabase/functions/_shared/direcao-arte.ts")).not.toContain("base-do-agente");
  });

  it("o banco: fichas e fontes por agente, escrita só pela função, uso registrado e pesquisa semanal", () => {
    const sql = ler("supabase/migrations/20261017220000_base_dos_agentes.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.agente_base_fichas");
    expect(sql).toContain("client_id uuid NULL REFERENCES public.profiles(id)");
    expect(sql).toContain("CHECK (agente ~ '^[a-z]+\\.[a-z_]+$')");
    expect(sql).toContain("FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())))");
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.agente_base_registrar_uso(");
    expect(sql).toContain("'base-dos-agentes-pesquisa-semanal'");
  });

  it("a função: só admin e gestor ensinam, o cron só com o segredo, e o que chega já entra em uso", () => {
    const f = ler("supabase/functions/base-dos-agentes/index.ts");
    expect(f).toContain('p.role === "admin" || p.role === "manager"');
    expect(f).toContain('if (!ehCron(req)) return json({ error: "somente_cron"');
    // Decisão do dono: a ficha nasce ativa (a coluna tem default true e o insert não a desliga).
    expect(f).not.toContain("ativa: false");
    expect(ler("supabase/config.toml")).toContain("[functions.base-dos-agentes]");
  });

  it("a tela está no menu, na rota e com ensinar, pesquisar e ligar/desligar", () => {
    expect(ler("src/App.tsx")).toContain('<Route path="/base-dos-agentes" element={<StaffRoute><BaseDosAgentes /></StaffRoute>} />');
    expect(ler("src/components/AppLayout.tsx")).toContain('{ title: "Base dos agentes", url: "/base-dos-agentes"');
    const pagina = ler("src/pages/BaseDosAgentes.tsx");
    for (const t of ["Texto ou prompt", "Link ou vídeo", "Documento", "Ficha pronta", "Pesquisar agora", "Todos os clientes", "lerArquivosDoAgente"]) {
      expect(pagina, t).toContain(t);
    }
  });

  it("17/10: a base aprende com aprovação e com os números (resultado gravado na ficha, a que atrapalha sai)", () => {
    const sql = ler("supabase/migrations/20261017233000_base_dos_agentes_resultado.sql");
    for (const c of ["aprovadas", "ajustadas", "reprovadas", "posts", "multiplo", "resultado_em"]) expect(sql, c).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    const geracao = ler("supabase/functions/_shared/base-do-agente.ts");
    expect(geracao).toContain(".filter((f) => !deveSair(resultadoDaFicha(f)))");
    expect(geracao).toContain("0.5 * pesoDaFicha(resultadoDaFicha(f))");
    const funcao = ler("supabase/functions/base-dos-agentes/index.ts");
    expect(funcao).toContain("aprender_com_resultados: aprenderAgora");
    expect(funcao).toContain("x.m.multiplo >= DESTAQUE_A_PARTIR_DE");
    expect(funcao).toContain("const resultados = (recente || []).length ? null : await aprenderComResultados()");
    const pagina = ler("src/pages/BaseDosAgentes.tsx");
    expect(pagina).toContain("data-sugestao-desligar");
    expect(pagina).toContain("Aprender com os resultados agora");
  });

  it("17/10: a capa sai da melhor entre a do diretor e 3 alternativas, antes de qualquer imagem", () => {
    const estudio = ler("supabase/functions/estudio-arte/index.ts");
    expect(estudio).toContain("const escolha = await escolherCapa({");
    expect(estudio).toContain('fidelidadePedida !== "identico" && fidelidadePedida !== "proximo"');
    expect(estudio).toContain("!instrucao");
    expect(ler("supabase/functions/_shared/motores.ts")).toContain('"estudio-arte/index.ts#prepararItem/escolherCapa": "revisoes"');
  });

  it("17/10: a pasta de referências do Workspace entra sozinha e o diretor usa as que servem ao pedido", () => {
    const estudio = ler("supabase/functions/estudio-arte/index.ts");
    expect(estudio).toContain('if (interno.acao === "referencias_automaticas_interno")');
    expect(estudio).toContain("novas += (await ligarReferenciasDoWorkspace(c)).novas;");
    expect(estudio).toContain("const r = await lerUmaReferencia(ref, null);");
    expect(estudio).toContain(".limit(CANDIDATAS_DO_PEDIDO),");
    expect(estudio).toContain("referencias: (await refsDoPedidoP)");
    // A pasta que cita outra marca do cliente (ex.: CME) liga a imagem àquela marca.
    expect(estudio).toContain("const marcaDaPasta = (nome: string)");
    const sql = ler("supabase/migrations/20261017234500_referencias_do_workspace_automaticas.sql");
    expect(sql).toContain("'estudio-referencias-automaticas'");
    expect(sql).toContain("'referencias_automaticas_interno'");
  });
});
