import { useState } from "react";
import { Check, Copy, Loader2, MessageCircle, Users } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { botao, juntar, superficie, texto } from "@/components/sistema";
import { appPublicUrl } from "@/lib/publicUrl";
import { chamarAgenteDoBriefing, textoDoErroDoBriefing } from "@/lib/briefing/api";
import { copiarTexto } from "./GerarLinkDoBriefing";
import { linkDoWhatsApp, type ModeloDeBriefing } from "../../../supabase/functions/_shared/briefing-modelos";
import { MAX_LEMBRETES, mensagemDeLembrete } from "../../../supabase/functions/_shared/briefing-editor";

/**
 * Lembrete ao cliente que não terminou o briefing (frente BRF2, 30/09/2026).
 * O painel avisa a equipe todo dia dos links parados ou vencendo; aqui fica a
 * mensagem pronta (com o andamento e a validade) para mandar pelo WhatsApp ou
 * pelo grupo. O painel não manda nada ao cliente: depois de mandar, a equipe
 * registra o lembrete (vira o histórico e segura o próximo aviso).
 */

export default function LembreteDoBriefing({
  aberto,
  onFechar,
  briefingId,
  token,
  cliente,
  telefone,
  modelo,
  expiraEm,
  respondidos,
  total,
  lembretes,
  onRegistrado,
}: {
  aberto: boolean;
  onFechar: () => void;
  briefingId: string;
  token: string;
  cliente: string;
  telefone?: string | null;
  modelo: ModeloDeBriefing;
  expiraEm: string | null;
  respondidos: number;
  total: number;
  lembretes: number;
  onRegistrado: () => void;
}) {
  const [copiado, setCopiado] = useState<"direto" | "grupo" | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const url = appPublicUrl(`/briefing/${token}`);
  const mensagem = mensagemDeLembrete({ cliente, modelo, url, expiraEm, respondidos, total });
  const doGrupo = mensagemDeLembrete({ cliente, modelo, url, expiraEm, respondidos, total, grupo: true });

  const copiar = async (qual: "direto" | "grupo") => {
    const ok = await copiarTexto(qual === "direto" ? mensagem : doGrupo);
    if (!ok) {
      toast.error("Não foi possível copiar. Selecione o texto e copie à mão.");
      return;
    }
    setCopiado(qual);
    window.setTimeout(() => setCopiado(null), 2000);
  };

  const registrar = async () => {
    setRegistrando(true);
    try {
      const r = await chamarAgenteDoBriefing<{ lembretes: number; aviso: string | null }>("registrar_lembrete", { briefing_id: briefingId });
      toast.success(`Lembrete ${r.lembretes} registrado.`);
      if (r.aviso) toast.info(r.aviso);
      onRegistrado();
      onFechar();
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e, "Não foi possível registrar o lembrete."));
    } finally {
      setRegistrando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader className="text-left">
          <DialogTitle className={texto.tituloSecao}>Lembrete do briefing</DialogTitle>
          <DialogDescription className={texto.auxiliar}>
            {respondidos} de {total} respondidas · {lembretes} de {MAX_LEMBRETES} lembretes
          </DialogDescription>
        </DialogHeader>
        <p className={juntar(superficie.poco, texto.corpo, "whitespace-pre-line px-3 py-2 [overflow-wrap:anywhere]")} data-mensagem-do-lembrete="">{mensagem}</p>
        <DialogFooter className="flex-wrap [&>*]:mt-2 sm:[&>*]:ml-2">
          <button type="button" onClick={() => void copiar("grupo")} className={botao.discreto}>
            {copiado === "grupo" ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {copiado === "grupo" ? "Copiado" : "Texto do grupo"}
          </button>
          <button type="button" onClick={() => void copiar("direto")} className={botao.secundario}>
            {copiado === "direto" ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {copiado === "direto" ? "Copiado" : "Copiar"}
          </button>
          <a href={linkDoWhatsApp(mensagem, telefone)} target="_blank" rel="noopener noreferrer" className={botao.secundario}>
            <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
            WhatsApp
          </a>
          <button type="button" onClick={() => void registrar()} disabled={registrando} className={botao.primario}>
            {registrando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Registrar que mandei
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
