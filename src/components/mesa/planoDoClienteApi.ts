import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { readFileContext } from "@/lib/fileContext";
// Só o endereço do worker (uma linha); o leitor de PDF baixa quando um PDF é importado.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

/**
 * Agente do cliente (frente C, 26/09): o que a tela pede à função
 * "agente-contexto" para o plano, o caminho, o pacote para LLM externo e a
 * identidade visual. O plano em si é conversado no agente de contexto (modo
 * "plano"); aqui ficam as leituras e os botões sem conversa.
 */

export type ModoDoAgente = "marca" | "plano";

export interface EtapaDoCaminho {
  titulo: string;
  porque?: string | null;
  quando?: string | null;
}

export interface ItemDaStack {
  ferramenta: string;
  para_que?: string | null;
  custo?: string | null;
  fonte?: string | null;
  porque?: string | null;
}

export interface CaminhoDoCliente {
  resumo?: string | null;
  etapas?: EtapaDoCaminho[] | null;
  stack?: ItemDaStack[] | null;
  cuidados?: string[] | null;
  atualizado_em?: string | null;
}

export interface LeituraDoPlano {
  fase: { fase: string; nome: string; motivo: string } | null;
  nicho: string | null;
  posicionamento: string | null;
  estagio: string | null;
  caminho: CaminhoDoCliente | null;
  identidade: { briefing: string | null; lacunas: string[]; gerado_em: string | null; brand_book: { arquivos?: { nome: string; caminho: string }[]; importado_em?: string } | null } | null;
  projetos: { nome: string; status: string; prazo: string | null; marcos: number; tarefas_abertas: number }[];
  tarefas: { id: string; titulo: string; prazo: string | null }[];
}

export type TipoDePacote = "google_meu_negocio" | "site" | "identidade_visual" | "conteudo" | "tarefa" | "livre";

export const TIPOS_DE_PACOTE: { valor: TipoDePacote; rotulo: string }[] = [
  { valor: "google_meu_negocio", rotulo: "Google Meu Negócio" },
  { valor: "site", rotulo: "Site" },
  { valor: "identidade_visual", rotulo: "Identidade visual" },
  { valor: "conteudo", rotulo: "Plano de conteúdo" },
  { valor: "tarefa", rotulo: "Tarefa do plano" },
  { valor: "livre", rotulo: "Pedido livre" },
];

export interface PacoteExterno {
  markdown: string;
  json: Record<string, unknown>;
  nome_arquivo: string;
  removidos: number;
  avisos: string[];
}

export const chaveDoPlano = (clientId: string) => ["mesa", "plano-do-cliente", clientId];

function normalizarPlano(d: any): LeituraDoPlano {
  return {
    fase: d && d.fase ? d.fase : null,
    nicho: (d && d.nicho) || null,
    posicionamento: (d && d.posicionamento) || null,
    estagio: (d && d.estagio) || null,
    caminho: d && d.caminho && typeof d.caminho === "object" ? d.caminho : null,
    identidade: d && d.identidade ? { briefing: d.identidade.briefing || null, lacunas: Array.isArray(d.identidade.lacunas) ? d.identidade.lacunas : [], gerado_em: d.identidade.gerado_em || null, brand_book: d.identidade.brand_book || null } : null,
    projetos: Array.isArray(d && d.projetos) ? d.projetos : [],
    tarefas: Array.isArray(d && d.tarefas) ? d.tarefas : [],
  };
}

/** Fase, nicho, caminho, identidade e projetos do cliente (sem IA). */
export function usePlanoDoCliente(clientId: string, ligado = true) {
  return useQuery({
    queryKey: chaveDoPlano(clientId),
    enabled: !!clientId && ligado,
    staleTime: 60_000,
    queryFn: async () => normalizarPlano(await chamarFuncao("agente-contexto", { acao: "ler_plano", client_id: clientId })),
  });
}

export async function salvarCaminho(clientId: string, caminho: CaminhoDoCliente | null): Promise<CaminhoDoCliente | null> {
  const r = await chamarFuncao<{ caminho: CaminhoDoCliente | null }>("agente-contexto", { acao: "salvar_caminho", client_id: clientId, caminho });
  return r ? r.caminho : null;
}

export async function montarPacote(
  clientId: string,
  pedido: { tipo: TipoDePacote; titulo?: string; descricao?: string; task_id?: string; com_ia?: boolean },
): Promise<{ pacote: PacoteExterno; custo_usd: number | null; saldo_usd: number | null }> {
  return chamarFuncao("agente-contexto", { acao: "pacote_externo", client_id: clientId, ...pedido });
}

export async function prepararIdentidade(clientId: string): Promise<{ briefing: string; lacunas: string[]; pacote: PacoteExterno }> {
  return chamarFuncao("agente-contexto", { acao: "preparar_identidade", client_id: clientId });
}

export interface RespostaComProposta {
  resposta: string;
  acao: unknown;
  mensagem_id: string | null;
  custo_usd?: number | null;
  saldo_usd?: number | null;
}

export async function organizarPorTipo(clientId: string): Promise<RespostaComProposta> {
  return chamarFuncao("agente-contexto", { acao: "organizar_por_tipo", client_id: clientId });
}

// ------------------------------------------------------------------ baixar e copiar

/** Baixa um texto como arquivo (Markdown ou JSON), sem biblioteca. */
export function baixarTexto(nome: string, conteudo: string, tipo: string) {
  const blob = new Blob([conteudo], { type: `${tipo};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copia para a área de transferência (com o jeito antigo quando o navegador não tem a API nova). */
export async function copiarTexto(conteudo: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(conteudo);
      return true;
    }
  } catch {
    // cai no jeito antigo
  }
  try {
    const area = document.createElement("textarea");
    area.value = conteudo;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ brand book

const MAX_PAGINAS_RENDERIZADAS = 4;
const LARGURA_DA_PAGINA = 1100;
export const TIPOS_DO_BRAND_BOOK = "application/pdf,image/png,image/jpeg,image/webp";

/** Nome seguro para o Storage (sem acento, espaço nem barra). */
export function nomeSeguro(nome: string): string {
  const limpo = String(nome || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (limpo || "arquivo").slice(-80);
}

let pdfjsPronto: Promise<any> | null = null;
function carregarPdfjs(): Promise<any> {
  if (!pdfjsPronto) {
    pdfjsPronto = import("pdfjs-dist").then((pdfjs: any) => {
      if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
      return pdfjs;
    });
    pdfjsPronto.catch(() => {
      pdfjsPronto = null;
    });
  }
  return pdfjsPronto;
}

/** As primeiras páginas do PDF em JPEG (cores e logos que o texto não mostra). Falhou, devolve o que deu. */
async function paginasDoPdf(arquivo: File): Promise<Blob[]> {
  const saida: Blob[] = [];
  try {
    const pdfjs = await carregarPdfjs();
    const doc = await pdfjs.getDocument({ data: await arquivo.arrayBuffer() }).promise;
    const total = Math.min(doc.numPages, MAX_PAGINAS_RENDERIZADAS);
    for (let i = 1; i <= total; i++) {
      const pagina = await doc.getPage(i);
      const base = pagina.getViewport({ scale: 1 });
      const viewport = pagina.getViewport({ scale: Math.min(2, LARGURA_DA_PAGINA / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pagina.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
      if (blob) saida.push(blob);
    }
  } catch {
    // Sem as páginas, a leitura usa só o texto do PDF.
  }
  return saida;
}

/**
 * Guarda os arquivos do brand book em mesa/<cliente>/marca/brandbook/, com o
 * texto e as primeiras páginas do PDF, e pede a leitura. Volta a proposta de
 * kit (cartão de ação) e a mensagem na conversa do agente.
 */
export async function importarBrandBook(clientId: string, arquivos: File[], aoAvancar?: (etapa: string) => void): Promise<RespostaComProposta> {
  const pasta = `${clientId}/marca/brandbook/`;
  const marca = Date.now();
  const enviados: { caminho: string; nome: string; mime: string }[] = [];
  const paginas: { caminho: string; nome: string }[] = [];
  const textos: string[] = [];
  for (let i = 0; i < arquivos.length && i < 12; i++) {
    const f = arquivos[i];
    const caminho = `${pasta}${marca}-${i + 1}-${nomeSeguro(f.name)}`;
    aoAvancar && aoAvancar(`Guardando ${f.name}...`);
    const envio = await supabase.storage.from("mesa").upload(caminho, f, { contentType: f.type || "application/octet-stream", upsert: false });
    if (envio.error) throw envio.error;
    enviados.push({ caminho, nome: f.name, mime: f.type || "" });
    const ehPdf = /pdf$/i.test(f.type || "") || /\.pdf$/i.test(f.name);
    if (ehPdf) {
      aoAvancar && aoAvancar(`Lendo o texto de ${f.name}...`);
      try {
        const ctx = await readFileContext(f);
        if (ctx.text) textos.push(`[${f.name}]\n${ctx.text}`);
      } catch {
        // segue só com as páginas
      }
      aoAvancar && aoAvancar(`Separando as primeiras páginas de ${f.name}...`);
      const imagens = await paginasDoPdf(f);
      for (let p = 0; p < imagens.length; p++) {
        const cp = `${pasta}${marca}-${i + 1}-pagina-${p + 1}.jpg`;
        const up = await supabase.storage.from("mesa").upload(cp, imagens[p], { contentType: "image/jpeg", upsert: false });
        if (!up.error) paginas.push({ caminho: cp, nome: `${f.name} página ${p + 1}` });
      }
    }
  }
  aoAvancar && aoAvancar("O agente está lendo o brand book...");
  return chamarFuncao("agente-contexto", {
    acao: "importar_brand_book",
    client_id: clientId,
    arquivos: enviados,
    paginas,
    texto: textos.join("\n\n").slice(0, 40_000),
  });
}
