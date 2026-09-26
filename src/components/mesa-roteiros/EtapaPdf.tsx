import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { AvisoDeErro, useAvisarErro } from "@/components/mesa/Custo";
import BarraDeAcoes from "@/components/sistema/BarraDeAcoes";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, foco, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { paginasDoPdf } from "../../../supabase/functions/_shared/pdf-roteiro";
import { type LinhaDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import { chamarRoteiros, CHAVES, useRoteiros } from "./roteirosApi";
import { AvisoDoBanco, Cabecalho, SeloDoStatus } from "./Comuns";
import { baixarBytes, itemDoPdf, montarPdf, urlDoPdf } from "./pdfNoNavegador";

/**
 * Etapa 4: o PDF no padrão do documento de roteiro da agência (capa, fala por
 * vídeo, técnico, direção, publicação, captação e fontes). Baixar monta no
 * navegador, na hora. Compartilhar com o cliente monta de novo na função, só
 * com roteiros aprovados, e usa o caminho de Arquivos: revisão da agência e
 * depois aprovação do cliente. Exportar não aprova nem muda o roteiro.
 *
 * Sistema de design (26/09): a escolha dos roteiros e a opção de versão ficam
 * guardadas por cliente; abrir o PDF de um roteiro põe ele na escolha.
 */
export default function EtapaPdf({ roteiroId }: { roteiroId: string | null }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const roteirosQ = useRoteiros(mesa.clientId);
  const vivos = useMemo(() => (roteirosQ.data ? roteirosQ.data.lista.filter((r) => !r.arquivado_em && r.versoes.length) : []), [roteirosQ.data]);
  const [escolhidos, setEscolhidos] = useEstadoDaTela<string[]>(`mesa-roteiros:pdf:escolhidos:${mesa.clientId}`, [], {
    validar: (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
  });
  const [usarAprovada, setUsarAprovada] = useEstadoDaTela<boolean>(`mesa-roteiros:pdf:aprovada:${mesa.clientId}`, true, { validar: (v) => typeof v === "boolean" });
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);

  // Começa pelo roteiro aberto; sem ele, pelos aprovados. Escolha guardada que não
  // tem mais roteiro (arquivado, apagado) começa de novo.
  useEffect(() => {
    if (!vivos.length) return;
    const validos = escolhidos.filter((id) => vivos.some((r) => r.id === id));
    if (roteiroId && vivos.some((r) => r.id === roteiroId) && validos.indexOf(roteiroId) < 0) {
      setEscolhidos(validos.concat([roteiroId]).slice(-12));
      return;
    }
    if (validos.length) {
      if (validos.length !== escolhidos.length) setEscolhidos(validos);
      return;
    }
    const inicial = vivos.filter((r) => r.status !== "rascunho").slice(0, 6).map((r) => r.id);
    setEscolhidos(inicial.length ? inicial : [vivos[0].id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vivos.length, roteiroId]);

  const linhas = escolhidos.map((id) => vivos.filter((r) => r.id === id)[0]).filter((r): r is LinhaDoRoteiro => !!r);
  const itens = linhas.map((l) => itemDoPdf(l, usarAprovada)).filter((i): i is NonNullable<typeof i> => !!i);
  const pdf = useMemo(() => {
    if (!itens.length) return null;
    try {
      return montarPdf(mesa.clientName || "Cliente", itens);
    } catch {
      return null;
    }
    // O PDF muda quando muda a escolha, a versão ou o hash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesa.clientName, itens.map((i) => `${i.versao}:${i.hash}:${i.status}`).join(",")]);

  useEffect(() => {
    if (!pdf) {
      setUrl(null);
      return;
    }
    const u = urlDoPdf(pdf.bytes);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [pdf]);

  const semAprovacao = linhas.filter((l) => l.status === "rascunho" || !l.versao_aprovada);
  const podeCompartilhar = linhas.length > 0 && !semAprovacao.length;
  const alternar = (id: string) => setEscolhidos((l) => (l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : l.concat([id]).slice(0, 12)));

  const compartilhar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await chamarRoteiros<{ file_id: string; revisao_solicitada: boolean; aviso: string | null; ja_existia: boolean }>("pdf_compartilhar", { client_id: mesa.clientId, roteiro_ids: linhas.map((l) => l.id) });
      toast.success(r.ja_existia ? "Este PDF já estava em Arquivos" : "PDF enviado para Arquivos", {
        description: r.aviso || (r.revisao_solicitada ? "Foi para a revisão da agência; depois segue para a aprovação do cliente." : "Está em Documentos estratégicos."),
      });
      void qc.invalidateQueries({ queryKey: CHAVES.roteiros(mesa.clientId) });
    } catch (e) {
      setErro(e);
      avisarErro(e, "Não foi possível compartilhar");
    } finally {
      setEnviando(false);
    }
  };

  if (roteirosQ.data && roteirosQ.data.indisponivel) return <AvisoDoBanco />;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]" data-etapa-pdf="">
      <aside className="min-w-0 space-y-3">
        <Cabecalho
          titulo="Roteiros no PDF"
          ajuda="Um documento com capa, uma página de fala por vídeo, técnico, direção, publicação e captação. Exportar não aprova nem muda o roteiro."
          estado={`${linhas.length} de ${vivos.length} escolhidos`}
        />
        {roteirosQ.isLoading && <Carregando forma="lista" linhas={3} rotulo="Lendo os roteiros" />}
        {!roteirosQ.isLoading && !vivos.length && <EstadoVazio compacto titulo="Nenhum roteiro ainda." />}
        {vivos.length > 0 && (
          <ul className="divide-y divide-border border-y border-border xl:max-h-[340px] xl:overflow-y-auto xl:overscroll-contain">
            {vivos.map((r) => (
              <li key={r.id}>
                <label className="flex min-w-0 cursor-pointer items-center px-1 py-2 hover:bg-muted/50">
                  <input type="checkbox" className="mr-2 shrink-0" checked={escolhidos.indexOf(r.id) >= 0} onChange={() => alternar(r.id)} aria-label={`Incluir ${r.titulo}`} />
                  <span className="mr-2 min-w-0 flex-1 truncate text-[13px]">{r.titulo}</span>
                  <SeloDoStatus status={r.status} />
                </label>
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-start text-[12.5px]">
          <input type="checkbox" className="mr-2 mt-0.5 shrink-0" checked={usarAprovada} onChange={(e) => setUsarAprovada(e.target.checked)} />
          <span className="min-w-0">Usar a versão aprovada quando houver (senão, a atual sai como rascunho)</span>
        </label>
        <BarraDeAcoes inicio={pdf ? <span className="block truncate">{paginasDoPdf(pdf.bytes)} páginas · {Math.max(1, Math.round(pdf.bytes.length / 1024))} KB</span> : null}>
          <button type="button" className={botao.primario} disabled={!pdf} onClick={() => pdf && baixarBytes(pdf.bytes, pdf.nome)}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Baixar
          </button>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className={juntar(botao.secundario, foco)}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Abrir
            </a>
          )}
          <button type="button" className={botao.secundario} disabled={!podeCompartilhar || enviando} onClick={() => void compartilhar()}>
            {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
            Compartilhar com o cliente
          </button>
        </BarraDeAcoes>
        {!podeCompartilhar && linhas.length > 0 && (
          <p className={juntar(texto.auxiliar, "leading-5 [overflow-wrap:anywhere]")}>Só roteiro aprovado vai para o cliente. Falta aprovar: {semAprovacao.map((l) => l.titulo).join(", ")}.</p>
        )}
        {erro ? <AvisoDeErro erro={erro} /> : null}
        {pdf && <p className={juntar(texto.auxiliar, "truncate")}>{pdf.nome}</p>}
      </aside>
      <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-muted/40" data-previa-do-pdf="">
        {url ? (
          <iframe title="Prévia do PDF do roteiro" src={url} className="block h-[70vh] w-full bg-white lg:h-[78vh]" />
        ) : (
          <EstadoVazio icone={<FileText className="h-5 w-5" />} titulo="Escolha ao menos um roteiro para ver o PDF." />
        )}
      </section>
    </div>
  );
}
