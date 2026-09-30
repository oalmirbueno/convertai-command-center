import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Package, PackageCheck, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import BotaoDocumentoDaEntrega from "@/components/documentos/BotaoDocumentoDaEntrega";
import { normalizarExecucao, rotuloDoPasso } from "../../../supabase/functions/_shared/completar-marca";
import { acaoDoAnexo, chamarAcaoDoAgente, type AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import Secao from "@/components/sistema/Secao";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { logosDoBrandbook, SLOTS_DE_LOGO, coresDoBrandbook } from "../../../supabase/functions/_shared/brandbook";
import { manifestoDoPacote } from "../../../supabase/functions/_shared/completar-marca";
import { chamarIdentidade, CHAVES, textoDaAprovacao, useBrandbooks, useSituacaoDoArquivo, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha, useProjetoDaMesa } from "./Comuns";
import { pacoteDaMarca, paginaWebDoBrandbook, pdfDoBrandbook, salvarArquivo } from "./exportarNoNavegador";
import { lerFilme, videoParaAprovacao, videosParaOPacote, videosProntos } from "./videosDaMarca";

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * O resultado da marca completa (IDV3): o pacote profissional para baixar
 * (logos em todas as versões, cores em HEX, RGB e CMYK, fontes, grafismos,
 * peças, mockups, vídeos, brandbook em PDF e página web, com o índice), o
 * envio para aprovação (brandbook e vídeos em Arquivos com a revisão da
 * agência) e, depois de aprovado, o kit da marca como sugestão com Confirmar.
 */
export default function ResultadoDaMarca() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, guardar, salvarParte } = useProjetoDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const versoes = useBrandbooks(projeto.id);
  const guideline = obj(projeto.dados.guideline);
  const bb = (versoes.data || []).filter((v) => v.id === guideline.brandbook_id)[0] || (versoes.data || [])[0] || null;
  const situacao = useSituacaoDoArquivo(bb ? bb.arquivo_pdf_id : null);
  const aprovado = !!(situacao.data && situacao.data.approval_status === "approved");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [sugestao, setSugestao] = useState<{ mensagemId: string; acao: AcaoDoAgente } | null>(null);
  const marcaId = projeto.marca_id || (marca && !marca.principal ? marca.id : null);
  const videos = arr(projeto.dados.videos) as Array<{ filme_id: string; nome: string }>;
  // Documento da entrega (frente DOC): o projeto com o resumo da rodada e o PDF do brandbook como prova.
  const execucao = normalizarExecucao(obj(projeto.dados.completar).execucao);
  const feitos = execucao ? execucao.passos.filter((p) => p.estado === "feito").map((p) => rotuloDoPasso(p.id).toLowerCase()) : [];
  const pedidoDoDocumento = bb
    ? {
        clientId: mesa.clientId,
        marcaId,
        tipo: "projeto" as const,
        referencia: projeto.id,
        titulo: projeto.titulo,
        resumo: `Identidade visual: brandbook versão ${bb.versao}${feitos.length ? `; completado: ${feitos.join(", ")}` : ""}${videos.length ? `; ${videos.length} vídeo(s) da marca` : ""}.`.slice(0, 900),
        provas: bb.arquivo_pdf_id ? [bb.arquivo_pdf_id] : [],
      }
    : null;

  const rodar = async (qual: string, fn: () => Promise<void>, erro: string) => {
    setOcupado(qual);
    try {
      await fn();
    } catch (e) {
      avisarErro(e, erro);
    } finally {
      setOcupado(null);
    }
  };

  const baixarPacote = () =>
    rodar(
      "pacote",
      async () => {
        if (!bb) return;
        const prontos: Array<{ url: string; arquivo: string; titulo: string }> = [];
        for (const v of videos) {
          const f = await lerFilme(v.filme_id).catch(() => null);
          if (f) prontos.push(...videosProntos(f.filme, f.links));
        }
        const doVideo = await videosParaOPacote(prontos);
        const extras: Array<{ caminho: string; dados: Blob | Uint8Array | string }> = doVideo.arquivos.map((a) => ({ caminho: a.caminho, dados: a.dados }));
        const mockups = arr(projeto.dados.mockups);
        for (let i = 0; i < mockups.length; i++) {
          const m = obj(mockups[i]);
          if (!m.imagem) continue;
          const { data } = await supabase.storage.from("mesa").download(String(m.imagem));
          if (data) extras.push({ caminho: `mockups/${String(i + 1).padStart(2, "0")}.${/\.png$/i.test(String(m.imagem)) ? "png" : "jpg"}`, dados: data });
        }
        const pdf = await pdfDoBrandbook(bb.dados, bb.modelo, bb.versao).catch(() => null);
        const web = await paginaWebDoBrandbook(bb.dados, bb.modelo, bb.versao, doVideo.arquivos.map((a) => ({ titulo: a.titulo, arquivo: a.caminho }))).catch(() => null);
        const leitura = obj(projeto.dados.leitura_da_logo);
        const manifesto = manifestoDoPacote({
          marca: bb.dados.marca.nome,
          logos: logosDoBrandbook(bb.dados).map(({ slot, logo }) => ({ rotulo: logo.rotulo || SLOTS_DE_LOGO.filter((s) => s.valor === slot)[0].rotulo, formato: /svg/i.test(logo.mime) ? "SVG e PNG" : "PNG" })),
          cores: coresDoBrandbook(bb.dados).length,
          fontes: bb.dados.tipografia.map((t) => `${t.familia} (${t.uso})`),
          grafismos: bb.dados.grafismos.length,
          pecas: bb.dados.aplicacoes.length,
          mockups: mockups.length,
          videos: doVideo.arquivos.map((a) => a.titulo).concat(doVideo.fora.map((t) => `${t}: grande demais para o .zip, baixe na Mesa Motion`)),
          pdf: !!pdf,
          paginaWeb: !!web,
          designer: arr(obj(leitura.versoes).designer).map((d) => ({ versao: String(obj(d).versao || ""), motivo: String(obj(d).motivo || "") })),
          perguntas: arr(obj(projeto.dados.completar).perguntas).map((p) => String(obj(p).texto || "")).filter(Boolean),
        });
        const r = await pacoteDaMarca({ clientId: mesa.clientId, marcaId, dados: bb.dados, modelo: bb.modelo, versao: bb.versao, pdf: pdf ? { bytes: pdf.bytes, nome: pdf.nome } : null, projeto: projeto.dados, paginaWeb: web ? web.html : null, extras, manifesto: manifesto.texto });
        salvarArquivo(r.blob, r.nome, "application/zip");
        const fora = r.fora.concat(doVideo.fora);
        if (fora.length) toast.warning(`Ficaram fora do pacote: ${fora.slice(0, 3).join(", ")}`);
        else toast.success("Pacote da marca baixado");
      },
      "O pacote não saiu",
    );

  const enviar = () =>
    rodar(
      "enviar",
      async () => {
        if (!bb) return;
        const r = await chamarIdentidade<{ file_id: string; revisao_solicitada: boolean; aviso: string | null; projeto?: ProjetoDeIdentidade }>("brandbook_compartilhar", { brandbook_id: bb.id });
        if (r.projeto) guardar(r.projeto);
        let nVideos = 0;
        for (const v of videos) {
          const f = await lerFilme(v.filme_id).catch(() => null);
          if (!f) continue;
          for (const x of videosProntos(f.filme, f.links)) {
            await videoParaAprovacao({ clientId: mesa.clientId, filmeId: f.filme.id, formato: x.formato, url: x.url, nome: f.filme.nome });
            nVideos += 1;
          }
        }
        void qc.invalidateQueries({ queryKey: CHAVES.brandbooks(projeto.id) });
        toast.success(`Brandbook${nVideos ? ` e ${nVideos} ${nVideos === 1 ? "vídeo" : "vídeos"}` : ""} em Arquivos`, { description: r.revisao_solicitada ? "Revisão da agência pedida; depois vai ao cliente." : r.aviso || undefined });
      },
      "O pacote não foi para aprovação",
    );

  const sugerirKit = () =>
    rodar(
      "kit",
      async () => {
        const r = await chamarIdentidade<{ mensagem_id: string; anexo: unknown }>("kit_sugerir", { projeto_id: projeto.id });
        const acao = acaoDoAnexo(r.anexo);
        if (acao) setSugestao({ mensagemId: r.mensagem_id, acao });
      },
      "A sugestão do kit não saiu",
    );

  return (
    <Secao
      titulo="Resultado da marca"
      divisoria
      descricao={bb ? `Brandbook v${bb.versao} · ${textoDaAprovacao(situacao.data)}` : "Monte o brandbook"}
      recolher={`mesa-identidade:${projeto.id}:resultado`}
      ajuda="O pacote leva as logos em todas as versões, as cores em HEX, RGB e CMYK, as fontes, os grafismos, as peças, os mockups, os vídeos prontos, o brandbook em PDF e a página web (abre sem o painel), com o LEIA-PRIMEIRO. Para aprovação vão o PDF e os vídeos, para Arquivos, com a revisão da agência. O kit da marca só muda depois da aprovação do cliente, com Confirmar e Desfazer."
    >
      <div className="-m-1 flex min-w-0 flex-wrap items-center" data-resultado-da-marca="">
        <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!bb || !!ocupado} onClick={() => void baixarPacote()} data-baixar-pacote="">
          {ocupado === "pacote" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Package className="mr-1.5 h-4 w-4" />} Baixar o pacote
        </button>
        <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!bb || !!ocupado} onClick={() => void enviar()} data-enviar-aprovacao="">
          {ocupado === "enviar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />} Enviar para aprovação
        </button>
        {!sugestao && (
          <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!aprovado || !!ocupado} title={aprovado ? undefined : "Depois da aprovação do cliente"} onClick={() => void sugerirKit()} data-levar-ao-kit="">
            {ocupado === "kit" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-1.5 h-4 w-4" />} Levar ao kit
          </button>
        )}
        <BotaoDocumentoDaEntrega pedido={pedidoDoDocumento} variante="discreto" className="m-1" />
        {bb && <Pastilha tom={aprovado ? "bom" : bb.arquivo_pdf_id ? "alerta" : "neutro"}>{textoDaAprovacao(situacao.data)}</Pastilha>}
      </div>
      {!bb && <p className={juntar(texto.auxiliar, "mt-2")}>O pacote e a aprovação saem do brandbook montado.</p>}
      {sugestao && (
        <div className="mt-3 min-w-0">
          <CartaoDeAcao
            acao={sugestao.acao}
            titulo="Levar ao kit da marca"
            observacao="Sem custo. O Desfazer volta o kit como estava."
            onPedido={(p) => chamarAcaoDoAgente("mesa-identidade", sugestao.mensagemId, sugestao.acao.id, p)}
            onFeito={() => {
              void qc.invalidateQueries({ queryKey: ["mesa", "kit", mesa.clientId] });
              void salvarParte("completar", { kit_em: new Date().toISOString() }).catch(() => undefined);
              mesa.atualizarCusto();
            }}
          />
        </div>
      )}
    </Secao>
  );
}
