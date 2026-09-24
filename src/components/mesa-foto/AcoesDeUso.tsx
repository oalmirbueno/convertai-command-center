import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Download, FolderInput, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { acrescentarFotos, baixarZip, classeDaFoto, decidirFoto, ehReferenciaWeb, enviarFotos, invalidarFotos, type Destino, type FotoDoAcervo } from "./fotoApi";

/**
 * Ações de uso de um grupo de fotos, iguais no Acervo e no Usar: baixar em
 * ZIP (montado no navegador, com LEIA-ME e "gerada" no nome da foto
 * sintética), mandar para Arquivos ou para aprovação. Nada aqui gasta IA.
 */
export function useAcoesDeUso() {
  const { clientId, clientName } = useMesa();
  const avisarErro = useAvisarErro();
  const [baixando, setBaixando] = useState<{ feitos: number; total: number } | null>(null);
  const [enviando, setEnviando] = useState<Destino | null>(null);

  const baixar = async (fotos: FotoDoAcervo[]) => {
    if (!fotos.length || baixando) return;
    setBaixando({ feitos: 0, total: fotos.length });
    try {
      const n = await baixarZip(clientId, clientName, fotos, (feitos, total) => setBaixando({ feitos, total }));
      const geradas = fotos.filter((f) => classeDaFoto(f) === "gerada").length;
      toast.success(`${n} ${n === 1 ? "foto baixada" : "fotos baixadas"} no ZIP`, {
        description: geradas ? `${geradas} ${geradas === 1 ? "é gerada e está marcada" : "são geradas e estão marcadas"} no nome do arquivo.` : undefined,
      });
    } catch (e) {
      avisarErro(e, "ZIP não montado");
    } finally {
      setBaixando(null);
    }
  };

  const enviar = async (todas: FotoDoAcervo[], destino: Destino) => {
    if (!todas.length || enviando) return;
    // Referência da internet é só para fidelidade: nunca vai ao cliente nem para Arquivos.
    const daInternet = todas.filter((f) => ehReferenciaWeb(f));
    const fotos = todas.filter((f) => !ehReferenciaWeb(f));
    if (daInternet.length) {
      toast.warning(`${daInternet.length} ${daInternet.length === 1 ? "referência da internet ficou" : "referências da internet ficaram"} de fora`, {
        description: "Fotos oficiais baixadas da internet são de uso interno, para o produto sair fiel. Não vão ao cliente.",
        duration: 9000,
      });
    }
    if (!fotos.length) return;
    // A função recusa foto gerada sem aprovação da equipe (gerada_sem_aprovacao_interna): avisa antes.
    const semAprovacao = destino === "aprovacao" ? fotos.filter((f) => f.gerada && !f.aprovada) : [];
    if (semAprovacao.length) {
      toast.error("Aprove antes de mandar ao cliente", {
        description: `${semAprovacao.length === 1 ? "Esta foto é gerada e ainda não foi aprovada" : `${semAprovacao.length} fotos são geradas e ainda não foram aprovadas`} pela equipe: ${semAprovacao
          .slice(0, 3)
          .map((f) => f.nome)
          .join(", ")}.`,
        duration: 9000,
      });
      return;
    }
    setEnviando(destino);
    try {
      const r = await enviarFotos(clientId, fotos.map((f) => f.id), destino);
      const n = r.file_ids.length || fotos.length;
      toast.success(destino === "arquivos" ? `${n} ${n === 1 ? "foto enviada" : "fotos enviadas"} para Arquivos` : `${n} ${n === 1 ? "foto enviada" : "fotos enviadas"} para aprovação`, {
        description: destino === "aprovacao" ? "Aprovar a foto não aprova o anúncio ou a arte feita com ela." : "Na pasta de fotos do cliente.",
      });
      if (r.aviso) toast.warning("Atenção no envio", { description: r.aviso, duration: 9000 });
    } catch (e) {
      avisarErro(e, destino === "arquivos" ? "Fotos não enviadas para Arquivos" : "Fotos não enviadas para aprovação");
    } finally {
      setEnviando(null);
    }
  };

  return { baixar, enviar, baixando, enviando };
}

/**
 * Aprovar a foto tratada ou gerada (acervo_decidir). Foto gerada só vai para
 * a aprovação do cliente depois da aprovação da equipe. Original não precisa.
 */
export function AprovarFoto({ foto }: { foto: FotoDoAcervo }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [decidindo, setDecidindo] = useState(false);
  if (classeDaFoto(foto) === "original") return null;
  const decidir = async (decisao: "aprovar" | "rejeitar") => {
    setDecidindo(true);
    try {
      const nova = await decidirFoto(clientId, foto.id, decisao);
      if (nova) acrescentarFotos(queryClient, clientId, [nova]);
      invalidarFotos(queryClient, clientId);
      toast.success(decisao === "aprovar" ? "Foto aprovada pela equipe" : "Aprovação retirada", {
        description: decisao === "aprovar" ? "Agora ela pode ir para a aprovação do cliente e para as mesas." : "A foto continua no acervo, sem o selo de aprovada.",
      });
    } catch (e) {
      avisarErro(e, decisao === "aprovar" ? "Não aprovada" : "Aprovação não retirada");
    } finally {
      setDecidindo(false);
    }
  };
  if (foto.aprovada) {
    return (
      <span className="inline-flex flex-wrap items-center text-[11.5px]" data-aprovar-foto="">
        <span className="mb-1 mr-2 inline-flex items-center font-medium text-success">
          <Check className="mr-1 h-3.5 w-3.5" /> Aprovada pela equipe
        </span>
        <button type="button" className="mb-1 text-muted-foreground hover:text-foreground disabled:opacity-60" disabled={decidindo} onClick={() => void decidir("rejeitar")}>
          Tirar aprovação
        </button>
      </span>
    );
  }
  return (
    <Button type="button" size="sm" className="mb-1.5 mr-1.5 h-8 text-[12px]" disabled={decidindo} onClick={() => void decidir("aprovar")} data-aprovar-foto="">
      {decidindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
      Aprovar esta foto
    </Button>
  );
}

export function BotoesDeUso({ fotos, compacto = false }: { fotos: FotoDoAcervo[]; compacto?: boolean }) {
  const { baixar, enviar, baixando, enviando } = useAcoesDeUso();
  const vazio = fotos.length === 0;
  const tamanho = "mb-1.5 mr-1.5 h-8 text-[12px]";
  return (
    <div className="flex min-w-0 flex-wrap items-center">
      <Button type="button" size="sm" variant="outline" className={tamanho} disabled={vazio || !!baixando} onClick={() => void baixar(fotos)}>
        {baixando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
        {baixando ? `Baixando ${baixando.feitos} de ${baixando.total}` : compacto ? "ZIP" : "Baixar em ZIP"}
      </Button>
      <Button type="button" size="sm" variant="outline" className={tamanho} disabled={vazio || !!enviando} onClick={() => void enviar(fotos, "arquivos")}>
        {enviando === "arquivos" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FolderInput className="mr-1.5 h-3.5 w-3.5" />}
        {compacto ? "Arquivos" : "Enviar para Arquivos"}
      </Button>
      <Button type="button" size="sm" variant="outline" className={tamanho} disabled={vazio || !!enviando} onClick={() => void enviar(fotos, "aprovacao")}>
        {enviando === "aprovacao" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
        {compacto ? "Aprovação" : "Enviar para aprovação"}
      </Button>
    </div>
  );
}
