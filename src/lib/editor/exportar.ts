import { edlDoProjeto, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { slugDoPacote } from "../../../supabase/functions/mesa-videos/modulos/pacote-de-edicao";
import type { AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { duracaoDaTrilhaPrincipal } from "./agente";
import { tempoFino } from "./tempo";

/**
 * Exportar o vídeo editado (frente AG2, 29/09). O render final é na máquina da
 * agência (docs/video/EDITOR.md, "Render final", fase 1: `npx remotion render`
 * com a composição ComposicaoDoProjeto e os props { projeto, urls }). O painel não
 * renderiza: exportar = baixar o projeto como está na linha do tempo, o
 * edl.json e o passo a passo, num ZIP. Sem custo, mas sai da tela: sempre um
 * cartão com Confirmar, nunca sozinho.
 */

export const AGENTE_DO_EDITOR = "editor_video";
/** Operação do item do cartão de exportar (não é uma ação da função: roda na tela). */
export const OPERACAO_DE_EXPORTAR = "exportar";

export interface ArquivosDaExportacao {
  nome_do_zip: string;
  arquivos: Record<string, string>;
}

/** Os arquivos do ZIP (função pura: o teste confere sem baixar nada). */
export function arquivosDaExportacao(p: ProjetoDeEdicao, urls: Record<string, string>, agora: string): ArquivosDaExportacao {
  const slug = slugDoPacote(p.titulo || "video");
  const fontes = Object.keys(p.fontes).map((k) => {
    const f = p.fontes[k];
    return `- ${k}: ${f.nome}${urls[k] ? `\n  ${urls[k]}` : f.storage_path ? `\n  ${f.storage_bucket || "mesa"}/${f.storage_path}` : ""}`;
  });
  const leiaMe = [
    `# Exportar: ${p.titulo}`,
    "",
    `Gerado em ${agora.slice(0, 10)} pelo agente editor da Mesa Edição. ${p.formato}, ${p.largura}x${p.altura}, ${p.fps} fps, ${tempoFino(duracaoDaTrilhaPrincipal(p))}.`,
    "",
    "## Render (máquina da agência)",
    "",
    "1. Copie o `props.json` (projeto + links das mídias) para a raiz do projeto Remotion que tem a ComposicaoDoProjeto.",
    "2. Rode: `npx remotion render ComposicaoDoProjeto out/" + slug + ".mp4 --props=props.json`",
    "3. Os links das mídias valem por algumas horas. Passou disso: exporte de novo, ou baixe as mídias abaixo e troque os links em `urls`.",
    "",
    "O `edl.json` é a mesma montagem no formato dos projetos em Videos/ (ranges e overlays).",
    p.fps_informado ? "" : `FPS ${p.fps} provisório: confira no arquivo antes do render.`,
    "",
    "## Mídias",
    "",
    ...fontes,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  return {
    nome_do_zip: `${slug}-exportar.zip`,
    arquivos: {
      "projeto.json": JSON.stringify(p, null, 1),
      "props.json": JSON.stringify({ projeto: p, urls }, null, 1),
      "edl.json": JSON.stringify(edlDoProjeto(p, `Exportado pelo agente editor em ${agora.slice(0, 10)} (revisão ${p.revisao}).`), null, 1),
      "LEIA-ME.md": leiaMe,
    },
  };
}

/** Cartão da exportação: um item, sem custo, sem Desfazer (baixar não volta), só com Confirmar. */
export function acaoDeExportar(p: ProjetoDeEdicao, id = `exportar-${Date.now().toString(36)}`): AcaoDoAgente {
  return {
    tipo: "acao_agente",
    agente: AGENTE_DO_EDITOR,
    id,
    resumo: `Baixa o vídeo como estiver na linha do tempo na hora do Confirmar (projeto, edl.json e o passo a passo do render na máquina da agência). Sem custo.`,
    itens: [
      {
        ref: "x1",
        alvo_id: "exportar",
        titulo: `Exportar "${p.titulo}"`,
        detalhe: `${p.formato}, ${tempoFino(duracaoDaTrilhaPrincipal(p))}`,
        operacao: OPERACAO_DE_EXPORTAR,
        rotulo: "Exportar",
        para: null,
      },
    ],
    ignorados: [],
    recusados: [],
    sem_desfazer: true,
    custo_estimado_usd: 0,
  };
}

type ZipMinimo = { file: (nome: string, conteudo: string) => void; generateAsync: (o: { type: "blob" }) => Promise<Blob> };

/** Monta o ZIP e baixa no navegador. */
export async function baixarExportacao(p: ProjetoDeEdicao, urls: Record<string, string>, agora: string): Promise<string> {
  const x = arquivosDaExportacao(p, urls, agora);
  const modulo = (await import("jszip")) as unknown as { default?: new () => ZipMinimo } & (new () => ZipMinimo);
  const JSZip = modulo.default || modulo;
  const zip = new JSZip();
  Object.keys(x.arquivos).forEach((k) => zip.file(k, x.arquivos[k]));
  const blob: Blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = x.nome_do_zip;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return x.nome_do_zip;
}
