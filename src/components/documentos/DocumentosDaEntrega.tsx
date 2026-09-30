import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Eye, FilePlus2, MessageCircle, PenLine, Send, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import { useConfirm } from "@/components/shared/confirmDialog";
import Secao from "@/components/sistema/Secao";
import MenuMais from "@/components/sistema/MenuMais";
import { EstadoDeErro } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import {
  arquivarDocumento,
  liberarDocumento,
  listarDocumentos,
  pedidoDoDocumento,
  ROTULO_DO_STATUS_DO_DOCUMENTO,
  ROTULO_DO_TIPO_DE_ENTREGA,
  type DocumentoDaEntrega,
} from "@/lib/documentos/registrarEntrega";
import BotaoDocumentoDaEntrega from "./BotaoDocumentoDaEntrega";
import EditorDoDocumento from "./EditorDoDocumento";
import NovoDocumento from "./NovoDocumento";
import EnvioDoDocumento from "./EnvioDoDocumento";
import AgendaDeDocumentos from "./AgendaDeDocumentos";

const dataCurta = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const TOM: Record<DocumentoDaEntrega["status"], string> = {
  pendente: "bg-muted text-muted-foreground",
  gerado: "bg-muted text-foreground",
  em_aprovacao: "bg-warning/15 text-warning",
  no_portal: "bg-primary/15 text-primary",
};

/**
 * Documentos da entrega do cliente, em Arquivos (pasta Entregas): prévia do
 * PDF, avisos da conferência para a equipe e o envio ao cliente pelo fluxo de
 * aprovação que já existe, sempre com Confirmar.
 */
export default function DocumentosDaEntrega({ clientId, className }: { clientId: string; className?: string }) {
  const confirmar = useConfirm();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState<DocumentoDaEntrega | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const chave = ["documentos-da-entrega", clientId];
  const consulta = useQuery({ queryKey: chave, queryFn: () => listarDocumentos(clientId), enabled: !!clientId, staleTime: 30_000 });
  const docs = consulta.data || [];
  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chave });
  // Frente BRF2: rascunho editável, documento novo por modelo, envio com mensagem pronta e agenda mensal.
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<Parameters<typeof EditorDoDocumento>[0]["alvo"]>(null);
  const [novo, setNovo] = useState(false);
  const [envio, setEnvio] = useState<DocumentoDaEntrega | null>(null);
  const perfil = useQuery({
    queryKey: ["documentos-cliente", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("company_name, full_name, phone").eq("id", clientId).maybeSingle();
      const p = data as { company_name?: string | null; full_name?: string | null; phone?: string | null } | null;
      return { nome: (p && (p.company_name || p.full_name)) || "", telefone: (p && p.phone) || null };
    },
  });
  // O aviso do rascunho mensal abre direto o documento (?documento=<id>).
  const documentoDaUrl = params.get("documento");
  useEffect(() => {
    if (!documentoDaUrl) return;
    setEditor({ documentoId: documentoDaUrl, clientId });
    const p = new URLSearchParams(params);
    p.delete("documento");
    setParams(p, { replace: true });
  }, [documentoDaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const liberar = async (d: DocumentoDaEntrega, modo: "approval" | "client_shared", mensagem?: string): Promise<boolean> => {
    const ok = await confirmar({
      title: modo === "approval" ? "Enviar para a aprovação do cliente?" : "Disponibilizar no portal do cliente?",
      description: modo === "approval"
        ? `O cliente recebe o documento "${d.titulo || "da entrega"}" para aprovar no painel. Confira a prévia antes.`
        : `O documento "${d.titulo || "da entrega"}" aparece no portal do cliente, sem pedir aprovação. Confira a prévia antes.`,
      confirmLabel: "Confirmar",
    });
    if (!ok) return false;
    setOcupado(d.id);
    try {
      await liberarDocumento(d.id, modo, mensagem);
      toast.success(modo === "approval" ? "Enviado para a aprovação do cliente." : "Disponível no portal do cliente.");
      recarregar();
      return true;
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível mandar ao cliente."));
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const arquivar = async (d: DocumentoDaEntrega) => {
    const ok = await confirmar({ title: "Arquivar este documento?", description: "Sai da lista; o PDF continua em Arquivos.", confirmLabel: "Arquivar" });
    if (!ok) return;
    setOcupado(d.id);
    try {
      await arquivarDocumento(d.id, true);
      recarregar();
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível arquivar."));
    } finally {
      setOcupado(null);
    }
  };

  const arquivo = aberto && aberto.arquivo ? aberto.arquivo : null;

  return (
    <Secao
      className={className}
      titulo="Documentos da entrega"
      descricao={consulta.isLoading ? "Carregando" : docs.length ? `${docs.length} ${docs.length === 1 ? "documento" : "documentos"}` : "Nenhum ainda"}
      ajuda="O registro de cada entrega grande (mês de pautas, projeto concluído): o que foi feito, com as provas e os números reais, montado só com o que está no painel. Edite o rascunho (modelo, texto por seção, provas na ordem, números com fonte), gere o PDF e mande com a mensagem pronta. Gerar fica só para a equipe; mandar ao cliente pede Confirmar."
      acao={
        <button type="button" onClick={() => setNovo(true)} className={botao.barra}>
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          <span className="ml-1.5">Novo</span>
        </button>
      }
    >
      {consulta.isError ? (
        <EstadoDeErro titulo="Não foi possível ler os documentos." descricao={textoDoErro(consulta.error)} acao={<button type="button" className={botao.secundario} onClick={recarregar}>Tentar de novo</button>} />
      ) : docs.length ? (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Documentos da entrega">
          {docs.map((d) => (
            <li key={d.id} className={lista.linha}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {d.numero ? `Nº ${String(d.numero).padStart(4, "0")} · ` : ""}
                  {d.titulo || ROTULO_DO_TIPO_DE_ENTREGA[d.tipo]}
                </p>
                <p className={juntar(texto.auxiliar, "truncate")}>
                  {ROTULO_DO_TIPO_DE_ENTREGA[d.tipo]} · {dataCurta(d.gerado_em || d.criado_em)}
                  {d.avisos && d.avisos.length ? ` · ${d.avisos.length} ${d.avisos.length === 1 ? "aviso" : "avisos"}` : ""}
                </p>
              </div>
              <span className={juntar(etiqueta, "ml-2 hidden rounded-full px-2 py-0.5 sm:inline-flex", TOM[d.status])}>{ROTULO_DO_STATUS_DO_DOCUMENTO[d.status]}</span>
              {d.status === "pendente" || !d.file_id ? (
                <BotaoDocumentoDaEntrega pedido={pedidoDoDocumento(d)} rotulo="Gerar" variante="discreto" className="ml-1 h-8" onGerado={recarregar} />
              ) : (
                <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={`Ver ${d.titulo || "documento"}`} title="Ver" onClick={() => setAberto(d)}>
                  <Eye className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <MenuMais
                className="ml-1"
                rotulo={`Mais ações de ${d.titulo || "documento"}`}
                itens={[
                  { rotulo: d.tem_rascunho ? "Editar o rascunho" : "Abrir o rascunho", icone: <PenLine className="h-4 w-4" />, aoEscolher: () => setEditor({ documentoId: d.id, clientId: d.client_id }) },
                  d.file_id && d.status === "gerado" && { rotulo: "Mandar com mensagem", icone: <MessageCircle className="h-4 w-4" />, aoEscolher: () => setEnvio(d) },
                  d.file_id && d.status === "gerado" && { rotulo: "Enviar para aprovação", icone: <Send className="h-4 w-4" />, aoEscolher: () => void liberar(d, "approval") },
                  d.file_id && d.status === "gerado" && { rotulo: "Disponibilizar no portal", icone: <Share2 className="h-4 w-4" />, aoEscolher: () => void liberar(d, "client_shared") },
                  { rotulo: ocupado === d.id ? "Aguarde" : "Arquivar", icone: <Archive className="h-4 w-4" />, aoEscolher: () => void arquivar(d), perigo: true },
                ]}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={!!aberto} onOpenChange={(o) => { if (!o) setAberto(null); }}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col p-0">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left">
            <DialogTitle className={juntar(texto.tituloSecao, "min-w-0 truncate pr-8")}>{aberto ? aberto.titulo || "Documento da entrega" : ""}</DialogTitle>
            {aberto && <p className={texto.auxiliar}>{ROTULO_DO_STATUS_DO_DOCUMENTO[aberto.status]}{aberto.codigo ? ` · código ${aberto.codigo}` : ""}</p>}
          </DialogHeader>
          {aberto && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {arquivo ? (
                <FilePreviewContent
                  fileName={arquivo.file_name}
                  fileUrl={arquivo.file_url}
                  fileId={arquivo.id}
                  storageBucket={arquivo.storage_bucket}
                  storagePath={arquivo.storage_path}
                  mimeType={arquivo.mime_type}
                  extension={arquivo.extension}
                />
              ) : (
                <p className={texto.auxiliar}>O PDF não está mais em Arquivos. Gere de novo.</p>
              )}
              {aberto.avisos && aberto.avisos.length > 0 && (
                <div className="mt-4">
                  <p className={texto.rotulo}>Avisos da conferência (só a equipe vê)</p>
                  <ul className="mt-1 list-disc pl-5">
                    {aberto.avisos.map((a, i) => <li key={i} className="text-[12px] leading-5 text-muted-foreground">{a}</li>)}
                  </ul>
                </div>
              )}
              {aberto.status === "gerado" && aberto.file_id && (
                <div className="mt-4 flex flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2">
                  <button type="button" className={botao.primario} disabled={ocupado === aberto.id} onClick={() => void liberar(aberto, "approval").then((ok) => ok && setAberto(null))}>
                    <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Enviar para aprovação
                  </button>
                  <button type="button" className={botao.secundario} disabled={ocupado === aberto.id} onClick={() => void liberar(aberto, "client_shared").then((ok) => ok && setAberto(null))}>
                    <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Disponibilizar no portal
                  </button>
                  <BotaoDocumentoDaEntrega pedido={pedidoDoDocumento(aberto)} rotulo="Gerar de novo" variante="discreto" onGerado={() => { setAberto(null); recarregar(); }} />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AgendaDeDocumentos clientId={clientId} />
      <NovoDocumento
        aberto={novo}
        onFechar={() => setNovo(false)}
        clientId={clientId}
        onComecar={(p) => {
          setNovo(false);
          setEditor(p);
        }}
      />
      <EditorDoDocumento aberto={!!editor} alvo={editor} onFechar={() => { setEditor(null); recarregar(); }} />
      <EnvioDoDocumento documento={envio} cliente={perfil.data ? perfil.data.nome : ""} telefone={perfil.data ? perfil.data.telefone : null} onFechar={() => setEnvio(null)} onLiberar={liberar} />
    </Secao>
  );
}
