import { useState } from "react";
import { Check, Copy, MessageCircle, Send, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { botao, campoTexto, juntar, texto } from "@/components/sistema";
import { appPublicUrl } from "@/lib/publicUrl";
import { type DocumentoDaEntrega } from "@/lib/documentos/registrarEntrega";
import { copiarTexto } from "@/components/briefing/GerarLinkDoBriefing";
import { linkDoWhatsApp } from "../../../supabase/functions/_shared/briefing-modelos";
import { mensagemDoDocumento } from "../../../supabase/functions/_shared/documento-modelos";

/**
 * Mandar o documento ao cliente (frente BRF2, 30/09/2026): a mensagem pronta
 * (editável) para o WhatsApp ou o grupo, e o envio pelo fluxo de aprovação que
 * já existe (para aprovar ou só no portal), sempre com Confirmar. O painel
 * não manda a mensagem: a equipe manda e a mensagem fica registrada.
 */

export default function EnvioDoDocumento({
  documento,
  cliente,
  telefone,
  onFechar,
  onLiberar,
}: {
  documento: DocumentoDaEntrega | null;
  cliente: string;
  telefone?: string | null;
  onFechar: () => void;
  /** O fluxo de liberação da lista (Confirmar e aprovação que já existem). */
  onLiberar: (d: DocumentoDaEntrega, modo: "approval" | "client_shared", mensagem: string) => Promise<boolean>;
}) {
  const [aprovar, setAprovar] = useState(true);
  const [grupo, setGrupo] = useState(false);
  const [editada, setEditada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  if (!documento) return null;
  const pronta = mensagemDoDocumento({
    cliente,
    titulo: documento.titulo || "Registro da entrega",
    numero: documento.numero,
    itens: 0,
    provas: 0,
    url: appPublicUrl("/documentos"),
    grupo,
    aprovar,
  });
  const mensagem = editada ?? pronta;

  return (
    <Dialog open={!!documento} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader className="text-left">
          <DialogTitle className={texto.tituloSecao}>Mandar ao cliente</DialogTitle>
          <DialogDescription className={texto.auxiliar}>{documento.titulo || "Documento da entrega"}</DialogDescription>
        </DialogHeader>
        <div className="-m-1 flex flex-wrap">
          <label className="m-1 inline-flex items-center text-[13px] text-foreground">
            <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={aprovar} onChange={(e) => { setAprovar(e.target.checked); setEditada(null); }} />
            Pedir aprovação
          </label>
          <label className="m-1 inline-flex items-center text-[13px] text-foreground">
            <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={grupo} onChange={(e) => { setGrupo(e.target.checked); setEditada(null); }} />
            Texto para o grupo
          </label>
        </div>
        <textarea className={juntar(campoTexto, "min-h-[160px]")} value={mensagem} onChange={(e) => setEditada(e.target.value)} aria-label="Mensagem para o cliente" data-mensagem-do-documento="" />
        <DialogFooter className="flex-wrap [&>*]:mt-2 sm:[&>*]:ml-2">
          <button
            type="button"
            className={botao.discreto}
            onClick={() => void copiarTexto(mensagem).then((ok) => {
              if (!ok) return toast.error("Não foi possível copiar.");
              setCopiado(true);
              window.setTimeout(() => setCopiado(false), 2000);
            })}
          >
            {copiado ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : grupo ? <Users className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {copiado ? "Copiado" : "Copiar"}
          </button>
          {!grupo && (
            <a href={linkDoWhatsApp(mensagem, telefone)} target="_blank" rel="noopener noreferrer" className={botao.secundario}>
              <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
              WhatsApp
            </a>
          )}
          {documento.status === "gerado" && (
            <button type="button" className={botao.primario} onClick={() => void onLiberar(documento, aprovar ? "approval" : "client_shared", mensagem).then((ok) => ok && onFechar())}>
              {aprovar ? <Send className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {aprovar ? "Enviar para aprovação" : "Disponibilizar no portal"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
