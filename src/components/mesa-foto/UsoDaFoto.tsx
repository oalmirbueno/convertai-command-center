import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, MoreHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MenuDeContexto, type ItemDeMenu } from "@/components/ui/menu-de-contexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAcoesDeUso } from "./AcoesDeUso";
import {
  acrescentarFotos,
  classeDaFoto,
  decidirFoto,
  decidirVersao,
  ehReferenciaWeb,
  guardarEnsaio,
  invalidarFotos,
  type Ensaio,
  type FotoDoAcervo,
  type Tomada,
  type VersaoDaTomada,
} from "./fotoApi";

/**
 * Usar de verdade (pedido do dono, 25/09: "eu tenho que usar o gerado e ele
 * não dá opção para usar lá"): toda foto pronta tem as saídas diretas num
 * menu só, "Usar": Mesa (Estúdio), Mesa Ads, Baixar, Mandar para aprovação e
 * Arquivos. A foto gerada ainda sem decisão aprova e segue no mesmo clique
 * ("Aprovar e usar na Mesa"): aprovar é o que põe a foto no acervo único
 * (cliente_imagens, origem mesa_foto, aprovada, gerada), que é de onde o
 * Estúdio das duas mesas lê. Referência da internet nunca sai (uso interno).
 *
 * Aqui também fica a decisão rápida (aprovar ou rejeitar com motivo), usada
 * dentro do resultado de Variações e Campanha: revisar sem trocar de tela.
 */

// ------------------------------------------------------------------ levar para as mesas

/** Guarda as fotos escolhidas para o Estúdio da outra mesa (sessão do navegador). */
export const chaveDasFotosParaUsar = (clientId: string) => `mesa-foto:para-usar:${clientId}`;

export function guardarFotosParaUsar(clientId: string, ids: string[]) {
  try {
    window.sessionStorage.setItem(chaveDasFotosParaUsar(clientId), JSON.stringify({ ids: ids.slice(0, 20), em: Date.now() }));
  } catch {
    /* sem armazenamento: a foto segue no acervo do mesmo jeito */
  }
}

/**
 * Endereço do Estúdio da mesa de destino com as fotos no endereço (&fotos=):
 * o Estúdio da Mesa e o da Mesa Ads (EstudioFotos) mostram "Fotos que vieram
 * da Mesa Foto" a partir dele.
 */
export function enderecoParaUsar(destino: "mesa" | "ads", clientId: string, ids: string[]): string {
  const fotos = ids.slice(0, 20).join(",");
  return destino === "mesa" ? `/mesa?client=${clientId}&aba=estudio&fotos=${fotos}` : `/mesa-ads?client=${clientId}&etapa=estudio&fotos=${fotos}`;
}

/** Foto que precisa da aprovação da equipe antes de ir para as mesas ou para o cliente. */
export const precisaAprovar = (f: Pick<FotoDoAcervo, "gerada" | "aprovada" | "derivada_de" | "modo">) => classeDaFoto(f) === "gerada" && !f.aprovada;

export function useLevarParaAsMesas() {
  const { clientId } = useMesa();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (destino: "mesa" | "ads", fotos: FotoDoAcervo[]) => {
    const validas = fotos.filter((f) => !ehReferenciaWeb(f));
    if (!validas.length) {
      toast.warning("Referência da internet não vai para as mesas", { description: "É uso interno, só para o produto sair fiel." });
      return;
    }
    const ids = validas.map((f) => f.id);
    guardarFotosParaUsar(clientId, ids);
    // O Estúdio lê o acervo pela chave dele: relê já, com a foto aprovada agora.
    invalidarFotos(queryClient, clientId);
    toast.success(destino === "mesa" ? "Abrindo o Estúdio da Mesa" : "Abrindo o Estúdio da Mesa Ads", {
      description: `${ids.length === 1 ? "A foto aparece" : `As ${ids.length} fotos aparecem`} em "Fotos que vieram da Mesa Foto", na ferramenta Fotos da lâmina.`,
      duration: 9000,
    });
    navigate(enderecoParaUsar(destino, clientId, ids));
  };
}

// ------------------------------------------------------------------ menu "Usar"

type Saida = "mesa" | "ads" | "baixar" | "aprovacao" | "arquivos";

/**
 * O menu "Usar" de uma foto. `foto` é a foto do acervo; `pendente` é a versão
 * gerada que ainda não foi decidida (aprovar primeiro põe no acervo).
 */
export function MenuDeUso({
  foto,
  pendente,
  rotulo = "Usar",
  className = "",
  variante = "default",
  icone = false,
  extras = [],
}: {
  foto?: FotoDoAcervo | null;
  pendente?: { ensaio: Ensaio; tomada: Tomada; versao: VersaoDaTomada } | null;
  rotulo?: ReactNode;
  className?: string;
  variante?: "default" | "outline" | "ghost";
  /** Botão só com o ícone (grade compacta do acervo). */
  icone?: boolean;
  /** Itens da tela que vêm antes das saídas (ver grande, preparar, ler). */
  extras?: ItemDeMenu[];
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const levar = useLevarParaAsMesas();
  const { baixar, enviar, baixando, enviando } = useAcoesDeUso();
  const [aberto, setAberto] = useState<{ x: number; y: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const daInternet = !!foto && ehReferenciaWeb(foto);
  const semAprovar = pendente ? true : !!foto && precisaAprovar(foto);

  /** A foto do acervo pronta para sair (aprova antes quando a saída pede). */
  const obter = async (aprovar: boolean): Promise<FotoDoAcervo | null> => {
    if (pendente) {
      if (!aprovar) return null;
      const r = await decidirVersao({ ensaioId: pendente.ensaio.id, tomadaId: pendente.tomada.id, versao: pendente.versao.versao, decisao: "aprovar" });
      if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
      if (r.imagem) acrescentarFotos(queryClient, clientId, [r.imagem]);
      invalidarFotos(queryClient, clientId);
      return r.imagem;
    }
    if (!foto) return null;
    if (aprovar && precisaAprovar(foto)) {
      const nova = await decidirFoto(clientId, foto.id, "aprovar");
      const aprovada = nova || { ...foto, aprovada: true };
      acrescentarFotos(queryClient, clientId, [aprovada]);
      invalidarFotos(queryClient, clientId);
      return aprovada;
    }
    return foto;
  };

  const sair = async (saida: Saida) => {
    if (ocupado) return;
    // Baixar e Arquivos não pedem aprovação; Mesa, Mesa Ads e cliente pedem (foto gerada).
    const aprovar = saida === "mesa" || saida === "ads" || saida === "aprovacao";
    if (pendente && !aprovar) {
      toast.info("Aprove primeiro", { description: "A foto gerada entra no acervo quando a equipe aprova." });
      return;
    }
    setOcupado(true);
    try {
      const f = await obter(aprovar);
      if (!f) throw new Error("A foto aprovada não voltou da função. Tente de novo.");
      if (pendente || (foto && f.aprovada && !foto.aprovada)) toast.success("Foto aprovada pela equipe", { description: "Ela entrou no acervo do cliente como gerada e aprovada." });
      if (saida === "mesa" || saida === "ads") levar(saida, [f]);
      else if (saida === "baixar") await baixar([f]);
      else await enviar([f], saida);
    } catch (e) {
      avisarErro(e, "A foto não saiu");
    } finally {
      setOcupado(false);
    }
  };

  const prefixo = semAprovar ? "Aprovar e " : "";
  const saidas: ItemDeMenu[] = daInternet
    ? [{ rotulo: "Referência da internet: uso interno" }, { separador: true }, { rotulo: "Baixar", acao: () => void sair("baixar") }]
    : [
        { rotulo: `${prefixo}${semAprovar ? "usar" : "Usar"} na Mesa (Estúdio)`, acao: () => void sair("mesa") },
        { rotulo: `${prefixo}${semAprovar ? "usar" : "Usar"} na Mesa Ads`, acao: () => void sair("ads") },
        { separador: true },
        ...(pendente ? [] : [{ rotulo: "Baixar", acao: () => void sair("baixar") }]),
        { rotulo: `${prefixo}${semAprovar ? "mandar" : "Mandar"} para aprovação`, acao: () => void sair("aprovacao") },
        ...(pendente ? [] : [{ rotulo: "Enviar para Arquivos", acao: () => void sair("arquivos") }]),
      ];
  const itens: ItemDeMenu[] = extras.length ? extras.concat([{ separador: true }], saidas) : saidas;
  const abrir = (e: { currentTarget: EventTarget }) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAberto({ x: Math.max(8, r.right - 224), y: r.bottom + 4 });
  };

  const carregando = ocupado || !!baixando || !!enviando;
  const chave = foto ? foto.id : pendente ? `${pendente.tomada.id}:${pendente.versao.versao}` : "";
  if (icone) {
    return (
      <>
        <button
          type="button"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground disabled:opacity-60 ${className}`}
          aria-haspopup="menu"
          aria-expanded={!!aberto}
          aria-label={`Ações de ${foto ? foto.nome : pendente ? pendente.tomada.nome : "foto"}`}
          disabled={carregando}
          data-menu-de-uso={chave}
          onClick={abrir}
        >
          {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
        </button>
        {aberto && <MenuDeContexto x={aberto.x} y={aberto.y} itens={itens} aoFechar={() => setAberto(null)} />}
      </>
    );
  }
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variante}
        className={`h-8 px-2.5 text-[12px] ${className}`}
        aria-haspopup="menu"
        aria-expanded={!!aberto}
        disabled={carregando}
        data-menu-de-uso={chave}
        onClick={abrir}
      >
        {carregando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
        {rotulo}
        <ChevronDown className="ml-1 h-3.5 w-3.5" />
      </Button>
      {aberto && <MenuDeContexto x={aberto.x} y={aberto.y} itens={itens} aoFechar={() => setAberto(null)} />}
    </>
  );
}

// ------------------------------------------------------------------ decisão rápida

export const MOTIVOS_RAPIDOS = ["Produto diferente", "Texto ou rótulo errado", "Proporção errada", "Rosto mudou", "Mãos estranhas", "Ingrediente inventado", "Luz ou cor fora"];

/**
 * Aprovar ou rejeitar (com motivo) a última versão de uma tomada, ali mesmo
 * no resultado. Aprovar trava a versão e põe a foto no acervo; rejeitar
 * guarda o motivo para a próxima variação. Sem laço: nada refaz sozinho.
 */
export function DecisaoRapida({ ensaio, tomada, versao, compacta = false }: { ensaio: Ensaio; tomada: Tomada; versao: VersaoDaTomada; compacta?: boolean }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [decidindo, setDecidindo] = useState(false);
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const decidir = async (decisao: "aprovar" | "rejeitar", m?: string) => {
    setDecidindo(true);
    try {
      const r = await decidirVersao({ ensaioId: ensaio.id, tomadaId: tomada.id, versao: versao.versao, decisao, motivo: m });
      if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
      if (r.imagem) acrescentarFotos(queryClient, clientId, [r.imagem]);
      invalidarFotos(queryClient, clientId);
      setRejeitando(false);
      toast.success(decisao === "aprovar" ? "Foto aprovada" : "Foto rejeitada", {
        description: decisao === "aprovar" ? "Já está no acervo: use na Mesa, na Mesa Ads, baixe ou mande ao cliente." : "O motivo fica guardado para a próxima variação.",
      });
    } catch (e) {
      avisarErro(e, decisao === "aprovar" ? "Não aprovada" : "Não rejeitada");
    } finally {
      setDecidindo(false);
    }
  };

  if (rejeitando) {
    return (
      <div className="w-full min-w-0 space-y-1.5 rounded-lg border border-destructive/30 bg-card p-2" data-rejeitar="">
        <div className="flex min-w-0 flex-wrap">
          {MOTIVOS_RAPIDOS.map((x) => (
            <button key={x} type="button" onClick={() => setMotivo(x)} className={`mb-1 mr-1 rounded-full border px-2 py-0.5 text-[11px] ${motivo === x ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}>
              {x}
            </button>
          ))}
        </div>
        <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="O que está errado" aria-label="Motivo da rejeição" className="h-8 text-[12px]" />
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" className="mr-1 h-7 text-[11.5px]" onClick={() => setRejeitando(false)}>
            Cancelar
          </Button>
          <Button type="button" size="sm" variant="destructive" className="h-7 text-[11.5px]" disabled={!motivo.trim() || decidindo} onClick={() => void decidir("rejeitar", motivo)}>
            Rejeitar com motivo
          </Button>
        </div>
      </div>
    );
  }
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center" data-decisao-rapida="">
      <Button type="button" size="sm" className={`mb-1 mr-1 h-8 text-[12px] ${compacta ? "px-2" : "px-2.5"}`} disabled={decidindo} onClick={() => void decidir("aprovar")}>
        {decidindo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />} Aprovar
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="mb-1 mr-1 h-8 px-2 text-[12px] text-destructive hover:text-destructive"
        disabled={decidindo}
        onClick={() => setRejeitando(true)}
        aria-label={`Rejeitar ${tomada.nome}`}
      >
        <X className="mr-0.5 h-3.5 w-3.5" /> {compacta ? "" : "Rejeitar"}
      </Button>
    </span>
  );
}
