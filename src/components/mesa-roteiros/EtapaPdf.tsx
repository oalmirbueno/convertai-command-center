import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { AvisoDeErro, useAvisarErro } from "@/components/mesa/Custo";
import { paginasDoPdf } from "../../../supabase/functions/_shared/pdf-roteiro";
import { type LinhaDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import { chamarRoteiros, CHAVES, useRoteiros } from "./roteirosApi";
import { AvisoDoBanco, SeloDoStatus } from "./Comuns";
import { baixarBytes, itemDoPdf, montarPdf, urlDoPdf } from "./pdfNoNavegador";

/**
 * Etapa 4: o PDF no padrão do documento de roteiro da agência (capa, fala por
 * vídeo, técnico, direção, publicação, captação e fontes). Baixar monta no
 * navegador, na hora. Compartilhar com o cliente monta de novo na função, só
 * com roteiros aprovados, e usa o caminho de Arquivos: revisão da agência e
 * depois aprovação do cliente. Exportar não aprova nem muda o roteiro.
 */
export default function EtapaPdf({ roteiroId }: { roteiroId: string | null }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const roteirosQ = useRoteiros(mesa.clientId);
  const vivos = useMemo(() => (roteirosQ.data ? roteirosQ.data.lista.filter((r) => !r.arquivado_em && r.versoes.length) : []), [roteirosQ.data]);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [usarAprovada, setUsarAprovada] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);

  // Começa pelo roteiro aberto; sem ele, pelos aprovados.
  useEffect(() => {
    if (escolhidos.length || !vivos.length) return;
    const inicial = roteiroId && vivos.some((r) => r.id === roteiroId) ? [roteiroId] : vivos.filter((r) => r.status !== "rascunho").slice(0, 6).map((r) => r.id);
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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]" data-etapa-pdf="">
      <aside className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-[14px] font-semibold">Roteiros no PDF</h2>
        <p className="text-[11.5px] text-muted-foreground">Um documento com capa, uma página de fala por vídeo, técnico, direção, publicação e captação.</p>
        {roteirosQ.isLoading && <p className="text-[12px] text-muted-foreground">Carregando...</p>}
        {!roteirosQ.isLoading && !vivos.length && <p className="text-[12px] text-muted-foreground">Nenhum roteiro ainda.</p>}
        <ul className="max-h-[340px] space-y-1 overflow-y-auto">
          {vivos.map((r) => (
            <li key={r.id}>
              <label className="flex min-w-0 cursor-pointer items-center rounded-lg px-1.5 py-1 hover:bg-muted">
                <input type="checkbox" className="mr-2" checked={escolhidos.indexOf(r.id) >= 0} onChange={() => alternar(r.id)} aria-label={`Incluir ${r.titulo}`} />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{r.titulo}</span>
                <SeloDoStatus status={r.status} />
              </label>
            </li>
          ))}
        </ul>
        <label className="flex items-start text-[12px]">
          <input type="checkbox" className="mr-2 mt-0.5" checked={usarAprovada} onChange={(e) => setUsarAprovada(e.target.checked)} />
          <span>Usar a versão aprovada quando houver (senão, a atual sai marcada como rascunho)</span>
        </label>
        <div className="flex flex-wrap">
          <Button type="button" size="sm" className="mb-1 mr-2 h-8 text-[12px]" disabled={!pdf} onClick={() => pdf && baixarBytes(pdf.bytes, pdf.nome)}>
            <Download className="mr-1 h-3.5 w-3.5" />Baixar
          </Button>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="mb-1 mr-2 inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] hover:bg-muted">
              <ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir
            </a>
          )}
          <Button type="button" size="sm" variant="outline" className="mb-1 h-8 text-[12px]" disabled={!podeCompartilhar || enviando} onClick={() => void compartilhar()}>
            {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}Compartilhar com o cliente
          </Button>
        </div>
        {!podeCompartilhar && linhas.length > 0 && <p className="text-[11.5px] text-muted-foreground">Só roteiro aprovado vai para o cliente. Falta aprovar: {semAprovacao.map((l) => l.titulo).join(", ")}.</p>}
        {erro ? <AvisoDeErro erro={erro} /> : null}
        {pdf && <p className="text-[11px] text-muted-foreground">{paginasDoPdf(pdf.bytes)} páginas · {Math.max(1, Math.round(pdf.bytes.length / 1024))} KB · {pdf.nome}</p>}
      </aside>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-muted/40" data-previa-do-pdf="">
        {url ? (
          <iframe title="Prévia do PDF do roteiro" src={url} className="h-[78vh] w-full bg-white" />
        ) : (
          <p className="p-8 text-center text-[12.5px] text-muted-foreground">Escolha ao menos um roteiro para ver o PDF.</p>
        )}
      </section>
    </div>
  );
}
