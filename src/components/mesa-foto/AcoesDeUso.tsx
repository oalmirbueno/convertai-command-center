import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Download, FolderInput, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { acrescentarFotos, baixarUmaAUma, baixarZip, classeDaFoto, decidirFoto, ehReferenciaWeb, enviarFotos, invalidarFotos, type Destino, type FotoDoAcervo } from "./fotoApi";
import { botao, juntar } from "@/components/sistema";

/**
 * Ações de uso de um grupo de fotos, iguais no Acervo e no Usar: baixar
 * (uma a uma, sem ZIP, no tamanho original: pedido do dono em 26/09, para
 * mandar ao cliente), baixar em ZIP (montado no navegador, com LEIA-ME e
 * "gerada" no nome da foto sintética), mandar para Arquivos ou para
 * aprovação. Nada aqui gasta IA.
 */
export function useAcoesDeUso() {
  const { clientId, clientName } = useMesa();
  const avisarErro = useAvisarErro();
  const [baixando, setBaixando] = useState<{ feitos: number; total: number } | null>(null);
  const [enviando, setEnviando] = useState<Destino | null>(null);

  /** Uma a uma, sem ZIP, no tamanho original (o arquivo como foi gerado ou enviado). */
  const baixar = async (fotos: FotoDoAcervo[]) => {
    if (!fotos.length || baixando) return;
    setBaixando({ feitos: 0, total: fotos.length });
    try {
      const n = await baixarUmaAUma(clientId, fotos, (feitos, total) => setBaixando({ feitos, total }));
      toast.success(n === 1 ? "Foto baixada no tamanho original" : `${n} fotos baixadas, uma a uma`, {
        description: n > 1 ? "Se o navegador perguntar, permita vários downloads deste site." : undefined,
      });
    } catch (e) {
      avisarErro(e, "Fotos não baixadas");
    } finally {
      setBaixando(null);
    }
  };

  const baixarEmZip = async (fotos: FotoDoAcervo[]) => {
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

  return { baixar, baixarEmZip, enviar, baixando, enviando };
}

/**
 * Aprovar a foto tratada ou gerada (acervo_decidir). Foto gerada só vai para
 * a aprovação do cliente depois da aprovação da equipe. Original não precisa.
 */
export function AprovarFoto({ foto, onMudou }: { foto: FotoDoAcervo; onMudou?: (f: FotoDoAcervo) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [decidindo, setDecidindo] = useState(false);
  if (classeDaFoto(foto) === "original") return null;
  // Otimista (pedido do dono, 26/09: "aprovar demora, fica carregando"): a tela muda na hora e volta se a função recusar.
  const decidir = async (decisao: "aprovar" | "rejeitar") => {
    const antes = foto;
    const agora = { ...foto, aprovada: decisao === "aprovar" };
    acrescentarFotos(queryClient, clientId, [agora]);
    if (onMudou) onMudou(agora);
    setDecidindo(true);
    try {
      const nova = await decidirFoto(clientId, foto.id, decisao);
      if (nova) {
        acrescentarFotos(queryClient, clientId, [nova]);
        if (onMudou) onMudou(nova);
      }
      invalidarFotos(queryClient, clientId);
      toast.success(decisao === "aprovar" ? "Foto aprovada pela equipe" : "Aprovação retirada", {
        description: decisao === "aprovar" ? "Salva no acervo deste cliente e disponível em Usar. Nada foi enviado ao cliente." : "A foto continua no acervo, sem o selo de aprovada.",
      });
    } catch (e) {
      acrescentarFotos(queryClient, clientId, [antes]);
      if (onMudou) onMudou(antes);
      avisarErro(e, decisao === "aprovar" ? "Não aprovada" : "Aprovação não retirada");
    } finally {
      setDecidindo(false);
    }
  };
  if (foto.aprovada) {
    return (
      <span className="inline-flex flex-wrap items-center text-[12px]" data-aprovar-foto="">
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
    // 28/09 (um primário por área): aprovar é secundário, com a cor do "aprovada".
    <button className={juntar(botao.icone, "mb-1.5 mr-1.5 text-success hover:bg-success/10 hover:text-success disabled:opacity-50")} type="button" disabled={decidindo} onClick={() => void decidir("aprovar")} data-aprovar-foto="" aria-label="Aprovar para o acervo" title="Aprovar para o acervo">
      {decidindo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

export function BotoesDeUso({ fotos, compacto = false, icones = false }: { fotos: FotoDoAcervo[]; compacto?: boolean; icones?: boolean }) {
  const { baixar, baixarEmZip, enviar, baixando, enviando } = useAcoesDeUso();
  const vazio = fotos.length === 0;
  // 28/09 (barra da seleção numa linha só): só o ícone, com o nome no leitor de tela e na dica.
  if (icones) {
    const icone = "h-8 w-8 shrink-0 p-0";
    return (
      <div className="flex shrink-0 items-center gap-0.5" data-botoes-de-uso="icones">
        <Button type="button" size="sm" variant="ghost" className={icone} disabled={vazio || !!baixando} onClick={() => void baixar(fotos)} aria-label="Baixar" title={baixando ? `Baixando ${baixando.feitos} de ${baixando.total}` : "Baixar uma a uma, no tamanho original"}>
          {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </Button>
        <Button type="button" size="sm" variant="ghost" className={icone} disabled={vazio || !!baixando} onClick={() => void baixarEmZip(fotos)} aria-label="ZIP" title="Baixar tudo num ZIP, com LEIA-ME">
          <Archive className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className={icone} disabled={vazio || !!enviando} onClick={() => void enviar(fotos, "arquivos")} aria-label="Arquivos" title="Enviar para Arquivos (pasta de fotos do cliente)">
          {enviando === "arquivos" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />}
        </Button>
        <Button type="button" size="sm" variant="ghost" className={icone} disabled={vazio || !!enviando} onClick={() => void enviar(fotos, "aprovacao")} aria-label="Aprovação" title="Enviar para a aprovação do cliente">
          {enviando === "aprovacao" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    );
  }
  // 16/10/2026 (dono: "deixa só o ícone"): fora da barra também só ícones, com o nome no title e no aria-label.
  const icone2 = juntar(botao.icone, "mb-1.5 mr-1.5");
  return (
    <div className="flex min-w-0 flex-wrap items-center" data-botoes-de-uso={compacto ? "compacto" : "inteiro"}>
      <button type="button" className={icone2} disabled={vazio || !!baixando} onClick={() => void baixar(fotos)} aria-label={baixando ? `Baixando ${baixando.feitos} de ${baixando.total}` : "Baixar (sem ZIP)"} title={baixando ? `Baixando ${baixando.feitos} de ${baixando.total}` : "Baixar uma a uma, sem ZIP, no tamanho original"}>
        {baixando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
      </button>
      <button type="button" className={icone2} disabled={vazio || !!baixando} onClick={() => void baixarEmZip(fotos)} aria-label="Baixar em ZIP" title="Baixar em ZIP: tudo num ZIP, com LEIA-ME">
        <Archive className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={icone2} disabled={vazio || !!enviando} onClick={() => void enviar(fotos, "arquivos")} aria-label="Enviar para Arquivos" title="Enviar para Arquivos (pasta de fotos do cliente)">
        {enviando === "arquivos" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FolderInput className="h-4 w-4" aria-hidden="true" />}
      </button>
      <button type="button" className={icone2} disabled={vazio || !!enviando} onClick={() => void enviar(fotos, "aprovacao")} aria-label="Enviar para aprovação" title="Enviar para a aprovação do cliente">
        {enviando === "aprovacao" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
