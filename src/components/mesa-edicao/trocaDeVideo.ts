import type { ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { categoriaDoArquivo } from "../../../supabase/functions/mesa-videos/modulos/organizador-da-entrada";
import { motivoParaNaoMudar, type VersaoDeVideo } from "../../../supabase/functions/mesa-videos/modulos/memoria-de-video";
import { migrarProjeto, normalizarProjeto, projetoDosTakes, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Trocar o vídeo em edição (Mesa Edição, 19/10/2026; dono: "na edição escolher
 * outro vídeo para editar, no momento não permite").
 *
 * Causa: a etapa Editar abria sempre a última versão editável do cliente e só
 * criava versão sozinha quando não havia nenhuma; a montagem saía de TODOS os
 * vídeos da Entrada e o "Nova versão" refazia a mesma montagem. Depois da
 * primeira versão não havia jeito de dizer "edite este vídeo".
 *
 * Aqui: a lista do que dá para escolher (acervo do cliente e Mesa Vídeos), as
 * edições recentes (a última versão editável de cada vídeo) e a troca em si,
 * pelas ações que a função mesa-videos já tem:
 * - manter: versao_registrar com um vídeo novo (video_id novo); a edição antiga
 *   fica intacta nas versões e nas edições recentes.
 * - descartar: projeto_salvar na versão aberta com a montagem do vídeo novo; a
 *   edição antiga sai (o Desfazer devolve o projeto de antes).
 */

export type FonteDaTroca = "acervo" | "mesa_videos";
export type ModoDaTroca = "manter" | "descartar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DO_ACERVO = ["bruto", "tratado", "exportado", "cena_motion"];

/** A mesma chave da AreaDoEditor: a versão aberta no editor, por cliente. */
export const chaveDaVersaoAberta = (clientId: string) => `mesa-edicao:editor:versao:${clientId}`;

const recente = (a: { criado_em: string }, b: { criado_em: string }) => (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0);

/** Vídeos que dá para pôr no editor: do acervo do cliente (gravações, tratados, renders) ou gerados na Mesa Vídeos. */
export function videosParaTrocar(arquivos: ArquivoDeVideo[], fonte: FonteDaTroca): ArquivoDeVideo[] {
  return arquivos
    .filter((a) => a.estado !== "arquivado" && !!a.storage_path)
    .filter((a) => {
      const c = categoriaDoArquivo(a);
      return fonte === "mesa_videos" ? c === "gerado" : DO_ACERVO.indexOf(c) >= 0;
    })
    .slice()
    .sort(recente);
}

/** Sem duração lida o vídeo não entra na linha do tempo: a tela avisa em vez de abrir um editor vazio. */
export const podeEditar = (a: ArquivoDeVideo) => typeof a.duracao_s === "number" && a.duracao_s > 0;

export const versaoEditavel = (v: VersaoDeVideo) => !!v.projeto && !motivoParaNaoMudar(v, "decidir");

/** O nome da edição: o título do projeto (muda quando o vídeo é trocado por cima), senão o da versão. */
export function nomeDaEdicao(v: VersaoDeVideo): string {
  const p = v.projeto ? normalizarProjeto(v.projeto) : null;
  return (p && p.titulo) || v.titulo;
}

/** Edições recentes: a versão editável mais nova de cada vídeo, da mais nova para a mais antiga. */
export function edicoesRecentes(versoes: VersaoDeVideo[], limite = 8): VersaoDeVideo[] {
  const vistos: Record<string, true> = {};
  const saida: VersaoDeVideo[] = [];
  versoes
    .filter(versaoEditavel)
    .slice()
    .sort(recente)
    .forEach((v) => {
      const chave = v.video_id || v.id;
      if (vistos[chave]) return;
      vistos[chave] = true;
      saida.push(v);
    });
  return saida.slice(0, limite);
}

/** A versão aberta no editor: a escolhida (se ainda é editável), senão a mais nova. A mesma regra da AreaDoEditor. */
export function versaoAberta(versoes: VersaoDeVideo[], escolhida: string | null): VersaoDeVideo | null {
  const editaveis = versoes.filter(versaoEditavel).slice().sort(recente);
  return editaveis.find((v) => v.id === escolhida) || editaveis[0] || null;
}

/** Montagem de um vídeo só: o vídeo inteiro na trilha de vídeo, no formato da edição de antes. */
export function projetoDoVideo(arquivo: ArquivoDeVideo, base: { formato?: string | null; fps?: number | null; agora: string }): ProjetoDeEdicao {
  return projetoDosTakes({
    titulo: arquivo.nome || "Vídeo",
    formato: base.formato || null,
    fps: base.fps || null,
    takes: [arquivo],
    agora: base.agora,
  });
}

type Chamar = <T = unknown>(corpo: Record<string, unknown>) => Promise<T>;

export interface ResultadoDaTroca {
  /** A versão que o editor deve abrir. */
  versaoId: string;
  /** Só no descartar: devolve o projeto de antes à mesma versão. */
  desfazer: (() => Promise<void>) | null;
}

/**
 * Troca o vídeo em edição. Sem edição aberta, o modo não importa: nasce uma
 * edição nova. Nada aqui gasta (só grava a versão e o projeto).
 */
export async function trocarVideo(p: { clientId: string; arquivo: ArquivoDeVideo; atual: VersaoDeVideo | null; modo: ModoDaTroca; agora: string; chamar: Chamar }): Promise<ResultadoDaTroca> {
  const antigo = p.atual && p.atual.projeto ? migrarProjeto(p.atual.projeto).projeto : null;
  const projeto = projetoDoVideo(p.arquivo, { formato: antigo ? antigo.formato : null, fps: antigo && antigo.fps_informado ? antigo.fps : null, agora: p.agora });

  if (p.modo === "descartar" && p.atual && antigo) {
    const atual = p.atual;
    // Sem revisão lida: descartar é sobrescrever de propósito. O editor aberto, se salvar depois, cai no conflito e recarrega.
    const r = await p.chamar<{ versao?: VersaoDeVideo }>({ acao: "projeto_salvar", versao_id: atual.id, projeto, revisao_lida: null });
    const gravado = r && r.versao && r.versao.projeto ? normalizarProjeto(r.versao.projeto) : null;
    const revisaoNova = gravado ? gravado.revisao : null;
    return {
      versaoId: atual.id,
      desfazer: async () => {
        await p.chamar({ acao: "projeto_salvar", versao_id: atual.id, projeto: antigo, revisao_lida: revisaoNova });
      },
    };
  }

  const r = await p.chamar<{ versao?: VersaoDeVideo }>({
    acao: "versao_registrar",
    client_id: p.clientId,
    titulo: (p.arquivo.nome || "Vídeo").slice(0, 120),
    arquivo_id: UUID.test(p.arquivo.id) ? p.arquivo.id : null,
    nota: p.atual ? "Vídeo trocado na Mesa Edição (a edição anterior ficou nas versões)." : "Vídeo escolhido na Mesa Edição.",
    estado: "rascunho",
    projeto,
  });
  if (!r || !r.versao || !r.versao.id) throw new Error("A versão nova não voltou da função. Tente de novo.");
  return { versaoId: r.versao.id, desfazer: null };
}
