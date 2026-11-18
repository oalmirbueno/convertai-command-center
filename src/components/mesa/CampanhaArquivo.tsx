import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, CalendarRange, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OverflowMenu } from "@/components/ds";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import type { Campanha } from "./mesaV4Api";
import { arquivarCampanha, campanhaArquivada, MAX_DIAS_DA_CAMPANHA, salvarPeriodoDaCampanha, validarPeriodoDaCampanha } from "./arquivoDaCampanha";

/**
 * 16/11/2026: menu "…" da campanha com "Editar período" e "Arquivar campanha" (ou "Desarquivar"),
 * a janela do período (duas datas, conferidas antes de salvar) e a confirmação do arquivo.
 * Sem IA e sem custo. O status da campanha não muda: desarquivar volta ao que era.
 */

/** Janela do período: início e fim, com a mesma regra do servidor (fim >= início, até 62 dias). */
export function JanelaDoPeriodo({ campanha, aberta, onMudar }: { campanha: Campanha; aberta: boolean; onMudar: (v: boolean) => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const [inicio, setInicio] = useState(campanha.periodo_inicio || "");
  const [fim, setFim] = useState(campanha.periodo_fim || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberta) return;
    setInicio(campanha.periodo_inicio || "");
    setFim(campanha.periodo_fim || "");
    setErro(null);
  }, [aberta, campanha.periodo_inicio, campanha.periodo_fim]);

  const salvar = async () => {
    const p = validarPeriodoDaCampanha(inicio, fim);
    if (p.ok === false) {
      setErro(p.mensagem);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const r = await salvarPeriodoDaCampanha(qc, clientId, campanha.id, p.inicio, p.fim);
      if (r.avisos && r.avisos.length) toast.warning("Período salvo", { description: r.avisos.join(" ") });
      else toast.success("Período salvo");
      onMudar(false);
    } catch (e) {
      setErro(textoDoErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberta} onOpenChange={(v) => !salvando && onMudar(v)}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>Editar período</DialogTitle>
          <DialogDescription>De quando a quando a campanha roda. Até {MAX_DIAS_DA_CAMPANHA} dias.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <div className="min-w-0">
            <Label htmlFor={`periodo-inicio-${campanha.id}`}>Início</Label>
            <Input id={`periodo-inicio-${campanha.id}`} type="date" className="mt-1 w-full min-w-0" value={inicio} max={fim || undefined} onChange={(e) => setInicio(e.target.value)} required />
          </div>
          <div className="min-w-0">
            <Label htmlFor={`periodo-fim-${campanha.id}`}>Fim</Label>
            <Input id={`periodo-fim-${campanha.id}`} type="date" className="mt-1 w-full min-w-0" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} required />
          </div>
          {erro && (
            <p role="alert" className="text-[12px] text-destructive sm:col-span-2">
              {erro}
            </p>
          )}
          <DialogFooter className="gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onMudar(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Salvar período
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmação antes de arquivar (desarquivar não pede confirmação: só volta a campanha para a lista). */
export function ConfirmarArquivo({ campanha, aberta, onMudar, onFeito }: { campanha: Campanha; aberta: boolean; onMudar: (v: boolean) => void; onFeito?: () => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const [indo, setIndo] = useState(false);
  const confirmar = async () => {
    setIndo(true);
    try {
      await arquivarCampanha(qc, clientId, campanha.id, true);
      toast.success("Campanha arquivada", { description: "Ela está na aba Arquivadas." });
      onMudar(false);
      if (onFeito) onFeito();
    } catch (e) {
      toast.error("Campanha não arquivada", { description: textoDoErro(e) });
    } finally {
      setIndo(false);
    }
  };
  return (
    <AlertDialog open={aberta} onOpenChange={(v) => !indo && onMudar(v)}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Arquivar campanha?</AlertDialogTitle>
          <AlertDialogDescription>
            "{campanha.nome}" sai da lista e deixa de ser a campanha do mês. Nada é apagado: as peças, a série e o status continuam. Você pode desarquivar quando quiser.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={indo}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={indo}
            onClick={(e) => {
              e.preventDefault();
              void confirmar();
            }}
          >
            {indo && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Arquivar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Desarquivar com um clique (botão da aba Arquivadas e da faixa da campanha aberta). */
export function useDesarquivar() {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const [indo, setIndo] = useState<string | null>(null);
  const desarquivar = async (c: Campanha) => {
    setIndo(c.id);
    try {
      await arquivarCampanha(qc, clientId, c.id, false);
      toast.success("Campanha desarquivada", { description: "Ela voltou para a lista." });
    } catch (e) {
      toast.error("Campanha não desarquivada", { description: textoDoErro(e) });
    } finally {
      setIndo(null);
    }
  };
  return { desarquivar, indo };
}

/** Faixa no topo da campanha aberta quando ela está arquivada. */
export function FaixaDeArquivada({ campanha }: { campanha: Campanha }) {
  const { desarquivar, indo } = useDesarquivar();
  if (!campanhaArquivada(campanha)) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center rounded-lg border border-border bg-muted/60 px-3 py-2" data-campanha-arquivada="">
      <Archive className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="mr-2 min-w-0 flex-1 text-[13px] text-muted-foreground">Campanha arquivada. Ela não aparece na lista nem conta como a campanha do mês.</p>
      <Button type="button" size="sm" variant="outline" className="mt-1 shrink-0 sm:mt-0" onClick={() => void desarquivar(campanha)} disabled={indo === campanha.id}>
        {indo === campanha.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <ArchiveRestore className="mr-1.5 h-4 w-4" aria-hidden="true" />}
        Desarquivar
      </Button>
    </div>
  );
}

/** O "…" da campanha: Editar período e Arquivar (ou Desarquivar). */
export default function MenuDaCampanha({ campanha, onArquivada }: { campanha: Campanha; onArquivada?: () => void }) {
  const [periodo, setPeriodo] = useState(false);
  const [arquivar, setArquivar] = useState(false);
  const { desarquivar } = useDesarquivar();
  const arquivada = campanhaArquivada(campanha);
  return (
    <>
      <OverflowMenu
        label={`Mais ações de ${campanha.nome}`}
        items={[
          { label: "Editar período", icon: <CalendarRange className="h-4 w-4" />, onSelect: () => setPeriodo(true) },
          arquivada
            ? { label: "Desarquivar campanha", icon: <ArchiveRestore className="h-4 w-4" />, onSelect: () => void desarquivar(campanha), separatorBefore: true }
            : { label: "Arquivar campanha", icon: <Archive className="h-4 w-4" />, onSelect: () => setArquivar(true), danger: true },
        ]}
      />
      <JanelaDoPeriodo campanha={campanha} aberta={periodo} onMudar={setPeriodo} />
      <ConfirmarArquivo campanha={campanha} aberta={arquivar} onMudar={setArquivar} onFeito={onArquivada} />
    </>
  );
}
