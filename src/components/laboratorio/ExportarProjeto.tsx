import { useMemo, useState } from "react";
import { Download, FileJson, FileText, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { JanelaCentral, botao, juntar, texto } from "@/components/sistema";
import { baixarDocumentoDoLab, documentarProjeto, docxDoProjeto, imprimirDocumentoDoLab, type EntradaDaExportacao } from "@/lib/laboratorio/exportar";
import { pdfDoProjeto } from "@/lib/laboratorio/exportarPdf";

export default function ExportarProjeto({ projeto, canvas, execucoes, clienteNome, disabled = false }: EntradaDaExportacao & { disabled?: boolean }) {
  const [aberta, setAberta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const documento = useMemo(() => aberta ? documentarProjeto({ projeto, canvas, execucoes, clienteNome }) : null, [aberta, projeto, canvas, execucoes, clienteNome]);
  const baixar = async (tipo: "pdf" | "docx" | "md" | "json") => {
    if (!documento || ocupado) return;
    setOcupado(true);
    try {
      const blob = tipo === "pdf" ? await pdfDoProjeto(documento) : tipo === "docx" ? await docxDoProjeto(documento) : new Blob([tipo === "json" ? documento.json : documento.markdown], { type: tipo === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" });
      baixarDocumentoDoLab(blob, `${documento.nome}.${tipo}`);
      toast.success("Documento pronto para baixar");
    } catch {
      toast.error("Não foi possível preparar o documento. Tente novamente.");
    } finally {
      setOcupado(false);
    }
  };
  const imprimir = () => {
    if (!documento) return;
    try { imprimirDocumentoDoLab(documento); }
    catch (erro) { toast.error(erro instanceof Error ? erro.message : "Não foi possível abrir a impressão."); }
  };
  return <>
    <button type="button" className={botao.icone} onClick={() => setAberta(true)} disabled={disabled} title="Exportar documentação do projeto" aria-label="Exportar documentação do projeto" data-exportar-projeto="">
      <Download className="h-4 w-4" aria-hidden="true" />
    </button>
    <JanelaCentral aberta={aberta} onFechar={() => setAberta(false)} titulo="Documentação do projeto" icone={<FileText className="h-4 w-4" />} largura="lg" ajuda="Leva o contexto, as configurações, os modelos, as ligações e os resultados disponíveis para continuar o trabalho. Não executa o funil nem publica nada. Arquivos são referências, sem credenciais ou links temporários. PDF e Word são documentos completos; Markdown e JSON ajudam outro agente a retomar a construção.">
      {documento ? <div className="space-y-4" data-documentacao-projeto="">
        <div className="flex flex-wrap items-center gap-2">
          <span className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>{documento.titulo}</span>
          <span className={texto.auxiliar}>{documento.totalNos} nós · {documento.totalExecucoes} execuções</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" className={juntar(botao.secundario, "justify-start")} onClick={() => void baixar("pdf")} disabled={ocupado}><Download className="mr-2 h-4 w-4" aria-hidden="true" />Baixar PDF</button>
          <button type="button" className={juntar(botao.secundario, "justify-start")} onClick={() => void baixar("docx")} disabled={ocupado}><FileText className="mr-2 h-4 w-4" aria-hidden="true" />Baixar Word (.docx)</button>
          <button type="button" className={juntar(botao.discreto, "justify-start")} onClick={() => void baixar("md")} disabled={ocupado}><FileText className="mr-2 h-4 w-4" aria-hidden="true" />Baixar Markdown</button>
          <button type="button" className={juntar(botao.discreto, "justify-start")} onClick={() => void baixar("json")} disabled={ocupado}><FileJson className="mr-2 h-4 w-4" aria-hidden="true" />Baixar base (.json)</button>
        </div>
        <button type="button" className={juntar(botao.discreto, "justify-start")} onClick={imprimir} disabled={ocupado}><Printer className="mr-2 h-4 w-4" aria-hidden="true" />Imprimir</button>
        {ocupado ? <p role="status" className={juntar(texto.corpo, "flex items-center")}><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Preparando documento</p> : null}
        <details className="rounded-lg bg-muted/40 p-3">
          <summary className={juntar(texto.corpo, "cursor-pointer font-medium")}>Prévia do conteúdo</summary>
          <pre className={juntar(texto.corpo, "mt-3 max-h-[45vh] overflow-auto whitespace-pre-wrap break-words")} tabIndex={0} aria-label="Prévia da documentação">{documento.markdown}</pre>
        </details>
      </div> : null}
    </JanelaCentral>
  </>;
}
