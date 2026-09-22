import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { nomeDoProvedor, textoDoErro, usd } from "@/lib/mesa/api";

/**
 * Chaves de IA por cliente e cotas (SPEC 2.1). Só admin abre esta gaveta.
 *
 * Segurança da chave: o campo é de senha, a chave vai direto para a RPC
 * (que a guarda no Vault) e o campo é limpo logo depois. A tela nunca lê a
 * chave de volta: do servidor só chegam o rótulo e os 4 últimos caracteres.
 */

const PROVEDORES = ["openai", "anthropic", "openrouter"] as const;

interface ChaveListada {
  id: string;
  provedor: string;
  rotulo: string | null;
  final_chave: string;
  cota_mensal_usd: number | null;
  gasto_mes_usd: number;
  ativa: boolean;
  criado_em: string;
}

interface ListaDeChaves {
  usar_chave_agencia: boolean;
  observacao: string | null;
  chaves: ChaveListada[];
}

const numeroOuNulo = (v: string): number | null => {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

function FormDeChave({
  clientId,
  provedor,
  trocando,
  onSalvo,
  onCancelar,
}: {
  clientId: string;
  provedor: string;
  trocando: boolean;
  onSalvo: () => void;
  onCancelar?: () => void;
}) {
  const [rotulo, setRotulo] = useState("");
  const [novaChave, setNovaChave] = useState("");
  const [cota, setCota] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    const cotaNum = numeroOuNulo(cota);
    if (Number.isNaN(cotaNum)) {
      toast.error("A cota precisa ser um número maior ou igual a zero, ou ficar vazia (sem teto).");
      return;
    }
    if (novaChave.trim().length < 8) {
      toast.error("Cole a chave completa do provedor.");
      return;
    }
    setSalvando(true);
    try {
      const { error } = await (supabase as any).rpc("ia_chave_salvar", {
        _client_id: clientId,
        _provedor: provedor,
        _chave: novaChave.trim(),
        _rotulo: rotulo.trim() || null,
        _cota_mensal_usd: cotaNum,
      });
      if (error) throw error;
      toast.success(`Chave de ${nomeDoProvedor(provedor)} salva`);
      setRotulo("");
      setCota("");
      onSalvo();
    } catch (e) {
      toast.error("Chave não salva", { description: textoDoErro(e) });
    } finally {
      // A chave some da tela em qualquer desfecho: nunca fica no campo.
      setNovaChave("");
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-dashed border-border p-3">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label className="text-[11.5px]">Rótulo</Label>
          <Input value={rotulo} onChange={(e) => setRotulo(e.target.value)} placeholder="Ex.: conta do cliente" className="h-9" />
        </div>
        <div className="min-w-0 space-y-1">
          <Label className="text-[11.5px]">Cota do mês (US$, vazio = sem teto)</Label>
          <Input value={cota} onChange={(e) => setCota(e.target.value)} inputMode="decimal" placeholder="50" className="h-9" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[11.5px]">{trocando ? "Nova chave" : "Chave"}</Label>
        <Input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={novaChave}
          onChange={(e) => setNovaChave(e.target.value)}
          placeholder="Cole aqui; ela vai para o cofre e some da tela"
          className="h-9 font-mono text-xs"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void salvar()} disabled={salvando || !novaChave.trim()}>
          {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {trocando ? "Trocar chave" : "Salvar chave"}
        </Button>
        {onCancelar && (
          <Button type="button" size="sm" variant="ghost" onClick={() => { setNovaChave(""); onCancelar(); }}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

function CotaDaChave({ chave, onSalvo }: { chave: ChaveListada; onSalvo: () => void }) {
  const [cota, setCota] = useState(chave.cota_mensal_usd === null ? "" : String(chave.cota_mensal_usd));
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const n = numeroOuNulo(cota);
    if (Number.isNaN(n)) {
      toast.error("A cota precisa ser um número maior ou igual a zero, ou ficar vazia (sem teto).");
      return;
    }
    setSalvando(true);
    try {
      const { error } = await (supabase as any).rpc("ia_chave_cota", { _chave_id: chave.id, _cota_mensal_usd: n });
      if (error) throw error;
      toast.success("Cota atualizada");
      onSalvo();
    } catch (e) {
      toast.error("Cota não salva", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <Label className="text-[11.5px]">Cota do mês (US$)</Label>
        <Input value={cota} onChange={(e) => setCota(e.target.value)} inputMode="decimal" placeholder="sem teto" className="h-9" />
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => void salvar()} disabled={salvando}>
        {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Salvar cota
      </Button>
    </div>
  );
}

export default function ChavesECotas({
  aberto,
  onOpenChange,
  clientId,
  clientName,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName: string;
}) {
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const [trocando, setTrocando] = useState<string | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);

  const lista = useQuery({
    queryKey: ["mesa", "chaves", clientId],
    enabled: aberto && !!clientId,
    queryFn: async (): Promise<ListaDeChaves> => {
      const { data, error } = await (supabase as any).rpc("ia_chaves_listar", { _client_id: clientId });
      if (error) throw error;
      const d = (data || {}) as any;
      return {
        usar_chave_agencia: d.usar_chave_agencia !== false,
        observacao: d.observacao ?? null,
        chaves: Array.isArray(d.chaves) ? d.chaves : [],
      };
    },
  });

  const recarregar = () => {
    setTrocando(null);
    void queryClient.invalidateQueries({ queryKey: ["mesa", "chaves", clientId] });
  };

  const mudarUsoDaAgencia = async (usar: boolean) => {
    setSalvandoConfig(true);
    try {
      const { error } = await (supabase as any).rpc("ia_cliente_config_salvar", {
        _client_id: clientId,
        _usar_chave_agencia: usar,
        _observacao: lista.data?.observacao ?? null,
      });
      if (error) throw error;
      toast.success(usar ? "Usa a chave da agência enquanto não houver própria" : "Sem chave própria, a IA fica bloqueada para este cliente");
      recarregar();
    } catch (e) {
      toast.error("Não foi possível salvar", { description: textoDoErro(e) });
    } finally {
      setSalvandoConfig(false);
    }
  };

  const desativar = async (chave: ChaveListada) => {
    const ok = await confirmar({
      title: `Desativar a chave de ${nomeDoProvedor(chave.provedor)}?`,
      description: "As próximas gerações deste cliente passam a usar a chave da agência (se permitido) ou ficam bloqueadas até cadastrar outra.",
      confirmLabel: "Desativar",
    });
    if (!ok) return;
    try {
      const { error } = await (supabase as any).rpc("ia_chave_desativar", { _chave_id: chave.id });
      if (error) throw error;
      toast.success("Chave desativada");
      recarregar();
    } catch (e) {
      toast.error("Não foi possível desativar", { description: textoDoErro(e) });
    }
  };

  const chaves = lista.data?.chaves || [];

  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Chaves de IA e cotas</SheetTitle>
          <SheetDescription>{clientName}: cada provedor pode ter a chave do próprio cliente, para o custo sair na conta certa.</SheetDescription>
        </SheetHeader>

        {lista.isLoading && <p className="mt-6 text-sm text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo chaves…</p>}
        {lista.isError && <p className="mt-6 rounded-lg bg-destructive/10 p-3 text-[12.5px] text-foreground">{textoDoErro(lista.error)}</p>}

        {lista.data && (
          <div className="mt-5 space-y-4">
            <label className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3.5">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">Usar chave da agência enquanto não houver própria</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                  Desligado, o cliente sem chave própria de um provedor fica sem IA daquele provedor.
                </span>
              </span>
              <Switch
                checked={lista.data.usar_chave_agencia}
                disabled={salvandoConfig}
                onCheckedChange={(v) => void mudarUsoDaAgencia(v)}
              />
            </label>

            {PROVEDORES.map((provedor) => {
              const ativa = chaves.find((c) => c.provedor === provedor && c.ativa) || null;
              const antigas = chaves.filter((c) => c.provedor === provedor && !c.ativa);
              const usoPct = ativa && ativa.cota_mensal_usd ? Math.min(100, Math.round((ativa.gasto_mes_usd / ativa.cota_mensal_usd) * 100)) : null;
              return (
                <section key={provedor} className="space-y-3 rounded-xl border border-border bg-card p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13.5px] font-semibold">{nomeDoProvedor(provedor)}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] ${ativa ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
                      {ativa ? "chave própria" : lista.data.usar_chave_agencia ? "usa a da agência" : "bloqueado"}
                    </span>
                  </div>

                  {ativa ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-[12px]">
                        <div className="min-w-0">
                          <p className="text-muted-foreground">Chave</p>
                          <p className="truncate font-mono">•••• {ativa.final_chave}</p>
                          {ativa.rotulo && <p className="truncate text-[11px] text-muted-foreground">{ativa.rotulo}</p>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-muted-foreground">Gasto do mês</p>
                          <p className="font-medium">{usd(ativa.gasto_mes_usd)}{ativa.cota_mensal_usd !== null ? ` de ${usd(ativa.cota_mensal_usd)}` : " (sem teto)"}</p>
                        </div>
                      </div>
                      {usoPct !== null && (
                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div className={`h-full ${usoPct >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${usoPct}%` }} />
                        </div>
                      )}
                      <CotaDaChave key={`${ativa.id}-${ativa.cota_mensal_usd}`} chave={ativa} onSalvo={recarregar} />
                      {trocando === provedor ? (
                        <FormDeChave clientId={clientId} provedor={provedor} trocando onSalvo={recarregar} onCancelar={() => setTrocando(null)} />
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => setTrocando(provedor)}>Trocar chave</Button>
                          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => void desativar(ativa)}>Desativar</Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <FormDeChave clientId={clientId} provedor={provedor} trocando={false} onSalvo={recarregar} />
                  )}

                  {antigas.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Desativadas: {antigas.map((c) => `•••• ${c.final_chave}`).join(", ")}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
