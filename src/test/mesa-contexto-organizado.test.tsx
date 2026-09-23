import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * 23/09, três correções de tela pedidas pelo dono:
 * 1. Contexto organizado: chave própria do acervo (o checklist contava 0 fotos
 *    quando o Estúdio enchia o cache antes), referências com a imagem de
 *    qualquer origem, galeria de fontes gravando o arquivo certo.
 * 2. Agenda mostra a arte que o Estúdio entregou para o item ainda sem post.
 * 3. Carrossel em Arquivos e na aprovação na ordem real das lâminas.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    storage: {
      from: () => ({
        createSignedUrl: async (caminho: string) => ({ data: { signedUrl: `https://assinada.test/${caminho}` }, error: null }),
      }),
    },
  },
}));

vi.mock("@/components/shared/FilePreviewContent", () => ({
  default: ({ fileName }: { fileName: string }) => <p data-testid="lamina-aberta">{fileName}</p>,
  prefetchImages: () => undefined,
}));

import CarouselSlider, { ordenarLaminasDoCarrossel } from "@/components/shared/CarouselSlider";
import { EditorialFileThumbnail, seloDaArteDoEstudio } from "@/components/editorial/EditorialCalendarViews";
import EditorialCalendarViews from "@/components/editorial/EditorialCalendarViews";
import { montarArteDoEstudio, type EditorialFileRow } from "@/hooks/useEditorialCalendar";
import {
  caminhoDaFonteDaBiblioteca,
  chaveDoAcervo,
  chaveDoAcervoDoEstudio,
  resolverReferencia,
  type FonteDaBiblioteca,
} from "@/components/mesa/contextoDoCliente";
import { planejarTrocaDeFontes } from "@/components/mesa/ContextoBibliotecaDeFontes";
import { camposDoConsolidado, completude, montarChecklist } from "@/components/mesa/ContextoAutomatico";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

// Carrossel de 12 lâminas como o Estúdio entrega: capa e filhas "(n/12)" em
// <cliente>/<grupo>/v1/<n>-arte.png, e o banco devolve em criação decrescente.
const capa = {
  id: "capa",
  file_name: "Arte do estúdio",
  file_url: "files://c/g/v1/1-arte.png",
  storage_bucket: "files",
  storage_path: "c/g/v1/1-arte.png",
  mime_type: "image/png",
  created_at: "2026-09-23T10:00:00Z",
};
const filhasDecrescentes = Array.from({ length: 11 }, (_, i) => {
  const n = 12 - i;
  return {
    id: `l${n}`,
    file_name: `Arte do estúdio (${n}/12)`,
    file_url: `files://c/g/v1/${n}-arte.png`,
    storage_bucket: "files",
    storage_path: `c/g/v1/${n}-arte.png`,
    mime_type: "image/png",
    created_at: `2026-09-23T10:${String(60 - n).padStart(2, "0")}:00Z`,
  };
});

describe("carrossel na ordem real das lâminas", () => {
  it("com as filhas já passadas (initialChildren), ordena em vez de devolver como veio", () => {
    const ordem = ordenarLaminasDoCarrossel(capa, filhasDecrescentes).map((f) => f.id);
    expect(ordem).toEqual(["capa", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10", "l11", "l12"]);
  });

  it("o slider abre a lâmina 2 logo depois da capa, mesmo com initialChildren", () => {
    render(<CarouselSlider parent={capa} initialChildren={filhasDecrescentes} />);
    expect(screen.getByText("1/12")).toBeTruthy();
    expect(screen.getByTestId("lamina-aberta").textContent).toBe("Arte do estúdio");
    fireEvent.click(screen.getByLabelText("Abrir item 2"));
    expect(screen.getByTestId("lamina-aberta").textContent).toBe("Arte do estúdio (2/12)");
    fireEvent.click(screen.getByLabelText("Abrir item 12"));
    expect(screen.getByTestId("lamina-aberta").textContent).toBe("Arte do estúdio (12/12)");
  });

  it("o atalho que devolvia a lista crua saiu e a aprovação da equipe usa a ordem numérica", () => {
    const slider = ler("src/components/shared/CarouselSlider.tsx");
    expect(slider).not.toContain("if (initialChildren !== undefined) return list;");
    const aprovacoes = ler("src/pages/AdminApprovals.tsx");
    const trecho = aprovacoes.slice(aprovacoes.indexOf("const getCarouselImages"), aprovacoes.indexOf("const getCorrectionUrl"));
    expect(trecho).toContain("orderEditorialCarouselFiles(f, children)");
    expect(trecho).not.toContain(".localeCompare(");
  });
});

// ------------------------------------------------------------------ agenda

const arquivo = (id: string, extra: Partial<EditorialFileRow> = {}): EditorialFileRow => ({
  id,
  client_id: "cli",
  project_id: "proj",
  file_name: `${id}.png`,
  mime_type: "image/png",
  file_url: `files://cli/g/v1/${id}.png`,
  storage_bucket: "files",
  storage_path: `cli/g/v1/${id}.png`,
  approval_status: "pending",
  visibility: "internal",
  locked_at: null,
  status: "ready",
  archived_at: null,
  parent_file_id: null,
  ...extra,
});

describe("agenda mostra a arte do Estúdio no item sem post", () => {
  const trabalhos = [
    { task_id: "t1", client_id: "cli", status: "rascunho", entrega_status: null, file_ids: [], atualizado_em: "2026-09-23T12:00:00Z" },
    { task_id: "t1", client_id: "cli", status: "entregue", entrega_status: "aguardando_cliente", file_ids: ["capa1", "f3", "f2"], atualizado_em: "2026-09-22T12:00:00Z" },
    { task_id: "t2", client_id: "cli", status: "dirigido", entrega_status: null, file_ids: [], atualizado_em: "2026-09-23T12:00:00Z" },
  ];
  const capas = [arquivo("capa1", { file_name: "Tema" })];
  const filhos = [
    arquivo("f3", { file_name: "Tema (3/3)", parent_file_id: "capa1", storage_path: "cli/g/v1/3-tema.png" }),
    arquivo("f2", { file_name: "Tema (2/3)", parent_file_id: "capa1", storage_path: "cli/g/v1/2-tema.png" }),
  ];

  it("fica com o trabalho que tem arte, ordena as lâminas e conta o total", () => {
    const mapa = montarArteDoEstudio(trabalhos, capas, filhos);
    expect(mapa.t1.capa?.id).toBe("capa1");
    expect(mapa.t1.filhos.map((f) => f.id)).toEqual(["f2", "f3"]);
    expect(mapa.t1.total).toBe(3);
    expect(mapa.t1.entregaStatus).toBe("aguardando_cliente");
    // Trabalho ainda sem entrega: a tarefa segue marcada (aviso "Abrir na Mesa"), sem miniatura.
    expect(mapa.t2.capa).toBeNull();
    expect(mapa.t2.total).toBe(0);
  });

  it("o resultado é JSON puro (vai para cache persistido)", () => {
    const mapa = montarArteDoEstudio(trabalhos, capas, filhos);
    expect(mapa instanceof Map).toBe(false);
    expect(JSON.parse(JSON.stringify(mapa))).toEqual(mapa);
  });

  it("a miniatura aceita o arquivo direto, sem post, com o contador de lâminas", () => {
    const { container } = render(<EditorialFileThumbnail file={capas[0]} fileChildren={filhos} className="h-12 w-12" />);
    expect(container.textContent).toContain("3");
  });

  it("o selo é discreto e diz o estado da entrega", () => {
    expect(seloDaArteDoEstudio({ entregaStatus: "aguardando_cliente", total: 5 })).toEqual({
      texto: "Arte pronta · aguardando aprovação",
      laminas: "5 lâminas",
      alerta: false,
    });
    expect(seloDaArteDoEstudio({ entregaStatus: null, total: 1 }).laminas).toBeNull();
    expect(seloDaArteDoEstudio({ entregaStatus: "reprovado", total: 3 }).alerta).toBe(true);
  });

  it("o cartão de prazo do item sem post desenha a arte e o selo", () => {
    const mapa = montarArteDoEstudio(trabalhos, capas, filhos);
    render(
      <EditorialCalendarViews
        view="list"
        anchorDate={new Date("2026-09-15T12:00:00")}
        posts={[]}
        tasks={[{ id: "t1", project_id: "proj", title: "Tema do carrossel", status: "doing", due_date: "2026-09-20" }]}
        clientNames={new Map()}
        projectNames={new Map()}
        canCreate
        canEdit
        canPublish={false}
        onSelectPost={() => undefined}
        onCreateOnDate={() => undefined}
        onShowBacklog={() => undefined}
        artesDoEstudio={mapa}
      />,
    );
    expect(screen.getByText("Arte pronta · aguardando aprovação")).toBeTruthy();
    expect(screen.getByText("· 3 lâminas")).toBeTruthy();
  });

  it("sem o mapa (cliente), nada novo aparece", () => {
    render(
      <EditorialCalendarViews
        view="list"
        anchorDate={new Date("2026-09-15T12:00:00")}
        posts={[]}
        tasks={[{ id: "t1", project_id: "proj", title: "Tema do carrossel", status: "doing", due_date: "2026-09-20" }]}
        clientNames={new Map()}
        projectNames={new Map()}
        canCreate
        canEdit
        canPublish={false}
        onSelectPost={() => undefined}
        onCreateOnDate={() => undefined}
        onShowBacklog={() => undefined}
      />,
    );
    expect(screen.queryByText("Arte pronta · aguardando aprovação")).toBeNull();
  });

  it("a página lê capa e lâminas pelo file_ids, inclui o quadro e não cria post", () => {
    const pagina = ler("src/pages/EditorialCalendar.tsx");
    const trecho = pagina.slice(pagina.indexOf("const usaMesa ="), pagina.indexOf("const ancoradosPorDia"));
    expect(trecho).toContain('.select("task_id, client_id, status, entrega_status, file_ids, atualizado_em")');
    expect(trecho).toContain("deadlineTasksForGrid.concat(productionTasks)");
    expect(trecho).toContain('from("staff_files_secure")');
    expect(trecho).toContain('.in("parent_file_id", capaIds)');
    expect(trecho).not.toContain("savePost");
    expect(trecho).not.toContain("editorial_posts");
    expect(pagina).toContain("artesDoEstudio={usaMesa ? mesaPorTarefa.data : undefined}");
  });
});

// ------------------------------------------------------------------ contexto

describe("Contexto: acervo com chave própria", () => {
  it("não divide a chave com o seletor do Estúdio (formatos diferentes)", () => {
    expect(chaveDoAcervo("c1")).toEqual(["mesa", "acervo-contexto", "c1"]);
    expect(chaveDoAcervo("c1")).not.toEqual(chaveDoAcervoDoEstudio("c1"));
    const seletor = ler("src/components/mesa/SeletorDoAcervo.tsx");
    expect(seletor).toContain('queryKey: ["mesa", "acervo", clientId]');
  });

  it("invalidar o contexto relê as duas leituras do acervo", () => {
    const fonte = ler("src/components/mesa/contextoDoCliente.ts");
    const trecho = fonte.slice(fonte.indexOf("export function useInvalidarContexto"), fonte.indexOf("export const ROTULOS_DO_QUE_MUDOU"));
    expect(trecho).toContain("chaveDoAcervo(clientId)");
    expect(trecho).toContain("chaveDoAcervoDoEstudio(clientId)");
  });

  it("o ler vale 5 minutos e a tela não some enquanto lê", () => {
    const fonte = ler("src/components/mesa/contextoDoCliente.ts");
    const trecho = fonte.slice(fonte.indexOf("export function useLeituraDoContexto"), fonte.indexOf("export function useHistoricoDoContexto"));
    expect(trecho).toContain("staleTime: 5 * 60_000");
    const tela = ler("src/components/mesa/ContextoAutomatico.tsx");
    expect(tela).not.toContain("{dados && (\n        <>");
  });
});

describe("Contexto: referências com imagem de qualquer origem", () => {
  const base = { origem: "workspace", papel: "tecnica" as const, url_origem: null, storage_path: null, workspace_node_id: null, file_id: null, leitura: null, tags: [], ativa: true, criado_em: null };
  it("Workspace vem do bucket workspace, arte aprovada do arquivo e Pinterest do bucket mesa", () => {
    const nos = { n1: { id: "n1", name: "ref-1.jpg", storage_path: "cli/ref-1.jpg" } };
    const arquivos = { a1: { id: "a1", file_name: "Arte aprovada.png", file_url: "files://cli/g/1.png", storage_bucket: "files", storage_path: "cli/g/1.png" } };
    expect(resolverReferencia({ ...base, id: "r1", workspace_node_id: "n1" }, nos, arquivos).imagem).toEqual({ bucket: "workspace", caminho: "cli/ref-1.jpg" });
    const arte = resolverReferencia({ ...base, id: "r2", origem: "arquivo", papel: "identidade", file_id: "a1" }, nos, arquivos);
    expect(arte.imagem).toEqual({ bucket: "files", caminho: "cli/g/1.png" });
    expect(arte.nome).toBe("Arte aprovada.png");
    expect(resolverReferencia({ ...base, id: "r3", origem: "pinterest", storage_path: "cli/referencias/x.jpg" }, nos, arquivos).imagem).toEqual({
      bucket: "mesa",
      caminho: "cli/referencias/x.jpg",
    });
  });
});

describe("Contexto: fontes da biblioteca", () => {
  const familia: FonteDaBiblioteca = {
    id: "fb1",
    familia: "Montserrat",
    slug: "montserrat",
    categoria: "sans",
    personalidade: [],
    usos: [],
    nichos: [],
    pareamentos: [],
    amostra_path: "biblioteca/fontes/montserrat/amostra.png",
    suporta_portugues: true,
    arquivos: [
      { peso: 400, estilo: "Regular", arquivo: "biblioteca/fontes/montserrat/Montserrat-Regular.ttf", italico: false },
      { peso: 700, estilo: "Bold", arquivo: "biblioteca/fontes/montserrat/Montserrat-Bold.ttf", italico: false },
      { peso: 800, estilo: "ExtraBold", arquivo: "biblioteca/fontes/montserrat/Montserrat-ExtraBold.ttf", italico: false },
      { peso: 800, estilo: "ExtraBold Italic", arquivo: "biblioteca/fontes/montserrat/Montserrat-ExtraBoldItalic.ttf", italico: true },
      { peso: 900, estilo: "Black", arquivo: "biblioteca/fontes/montserrat/Montserrat-Black.ttf", italico: false },
    ],
  };

  it("título pega o não itálico mais forte até 800; texto, o mais próximo de 400", () => {
    expect(caminhoDaFonteDaBiblioteca(familia, "titulo")).toBe("biblioteca/fontes/montserrat/Montserrat-ExtraBold.ttf");
    expect(caminhoDaFonteDaBiblioteca(familia, "texto")).toBe("biblioteca/fontes/montserrat/Montserrat-Regular.ttf");
  });

  it("trocar a fonte do papel grava a nova com storage_path e tira a antiga", () => {
    const atuais = [
      { id: "old-t", nome: "Antiga", papel: "titulo", storage_path: "cli/fontes/old.ttf", amostra_path: "cli/fontes/amostra-old.png", origem: "upload", biblioteca_id: null },
      { id: "old-x", nome: "Open Sans", papel: "texto", storage_path: "biblioteca/fontes/open/OpenSans.ttf", amostra_path: null, origem: "biblioteca", biblioteca_id: "fb2" },
    ];
    const plano = planejarTrocaDeFontes("cli", atuais, { titulo: familia });
    expect(plano.inserir).toEqual([
      {
        client_id: "cli",
        nome: "Montserrat",
        papel: "titulo",
        storage_path: "biblioteca/fontes/montserrat/Montserrat-ExtraBold.ttf",
        amostra_path: "biblioteca/fontes/montserrat/amostra.png",
        biblioteca_id: "fb1",
        origem: "biblioteca",
      },
    ]);
    expect(plano.apagar).toEqual(["old-t"]);
    // Só o arquivo enviado pelo cliente sai do Storage; o da biblioteca é compartilhado.
    expect(plano.arquivosParaRemover).toEqual(["cli/fontes/old.ttf", "cli/fontes/amostra-old.png"]);
    // Mesma família no mesmo papel: nada muda.
    expect(planejarTrocaDeFontes("cli", [{ ...atuais[1], papel: "texto", biblioteca_id: "fb1" }], { texto: familia }).inserir).toEqual([]);
  });

  it("tirar uma fonte da biblioteca nunca apaga o arquivo compartilhado", () => {
    const fontes = ler("src/components/mesa/ContextoFontes.tsx");
    expect(fontes).toContain('const daBiblioteca = f.origem !== "upload";');
    expect(fontes).toContain("if (!daBiblioteca) {");
  });
});

describe("Contexto: topo compacto", () => {
  it("oito chips; o que ainda lê aparece como lendo, não como falta", () => {
    const itens = montarChecklist({ kit: null, fontes: null, referencias: null, acervo: null, documentos: null });
    expect(itens.map((i) => i.rotulo)).toEqual(["Logo", "Paleta", "Fontes", "Estilo", "Regras", "Referências", "Fotos reais", "Documentos"]);
    expect(itens.filter((i) => i.situacao === "carregando").map((i) => i.chave)).toEqual(["fontes", "referencias", "imagens", "documentos"]);
    expect(completude(itens)).toBe(0);
  });

  it("fontes só ficam completas com título e texto", () => {
    const so = montarChecklist({ kit: null, fontes: [{ papel: "titulo", nome: "A" }], referencias: null, acervo: null, documentos: null });
    expect(so.find((i) => i.chave === "fontes")!.situacao).toBe("parcial");
    const par = montarChecklist({ kit: null, fontes: [{ papel: "titulo", nome: "A" }, { papel: "texto", nome: "B" }], referencias: null, acervo: null, documentos: null });
    expect(par.find((i) => i.chave === "fontes")!.situacao).toBe("feito");
  });

  it("o consolidado vira campos curtos e lista o que falta", () => {
    const { cheios, vazios } = camposDoConsolidado({
      client_id: "c",
      paleta: null,
      logo_file_id: null,
      estilo: "Luz natural",
      regras: null,
      contexto: { negocio: "Loja de móveis", diferenciais: ["Entrega rápida", "Projeto sob medida"] },
      contexto_atualizado_em: null,
    });
    expect(cheios.map((c) => c.rotulo)).toEqual(["Negócio", "Diferenciais", "Estilo"]);
    expect(vazios).toContain("Regras");
    expect(cheios[1].texto).toBe("• Entrega rápida\n• Projeto sob medida");
  });
});

describe("compatibilidade com navegador antigo nos arquivos novos", () => {
  it("sem lookbehind, \\p{}, grupo nomeado, aspect-ratio ou .at()", () => {
    for (const rel of [
      "src/components/mesa/AbaContexto.tsx",
      "src/components/mesa/ContextoAutomatico.tsx",
      "src/components/mesa/ContextoBibliotecaDeFontes.tsx",
      "src/components/mesa/ContextoCartaoMarca.tsx",
      "src/components/mesa/ContextoFotos.tsx",
      "src/components/mesa/ContextoGaleriaDeReferencias.tsx",
      "src/components/mesa/ContextoLogos.tsx",
      "src/components/mesa/ContextoMiniatura.tsx",
      "src/components/mesa/ContextoFontes.tsx",
      "src/components/mesa/ContextoReferencias.tsx",
      "src/components/mesa/contextoDoCliente.ts",
    ]) {
      const texto = ler(rel);
      expect(texto, rel).not.toContain("(?<=");
      expect(texto, rel).not.toContain("(?<!");
      expect(texto, rel).not.toContain("(?<");
      expect(texto, rel).not.toMatch(/\\p\{/);
      expect(texto, rel).not.toContain("aspect-[");
      expect(texto, rel).not.toContain(".at(");
      expect(texto, rel).not.toContain("—");
      expect(texto, rel).not.toContain("–");
    }
  });
});
