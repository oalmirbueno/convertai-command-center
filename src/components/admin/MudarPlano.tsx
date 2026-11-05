import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario, botao, campo, juntar, texto } from "@/components/sistema";
import { useFinancePlans } from "@/hooks/useFinanceV2";
import { supabase } from "@/integrations/supabase/client";
import { dinheiro } from "@/lib/comercial";
import { notifyUser } from "@/lib/notifyHelpers";

/** Avulso que passa a pagar mensalidade vira híbrido; os outros ficam como estão. */
export const tipoDepoisDoPlano = (tipo: string | null | undefined) => (tipo === "one_off" ? "hybrid" : tipo || "recurring");

const hojeEmSaoPaulo = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Upgrade em um passo (05/11/2026; dono: "clico no cliente, mudo de plano, coloco o valor e já atualiza; não pode ser
 * burocrático"). O banco leva o valor novo para a próxima mensalidade em aberto e para o CRM (profiles_plano_mudou_trg).
 */
export default function MudarPlano({ client, onSalvo }: {
  client: { id: string; client_type?: string | null; plan_name?: string | null; plan_value?: number | string | null; plan_renewal_date?: string | null };
  onSalvo?: (plano: { nome: string; valor: number }) => void;
}) {
  const queryClient = useQueryClient();
  const { data: planos } = useFinancePlans();
  const atual = Number(client.plan_value) || 0;
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(client.plan_name || "");
  const [valor, setValor] = useState(atual ? String(atual) : "");
  const [salvando, setSalvando] = useState(false);
  const novo = Number(String(valor).replace(",", ".")) || 0;
  const ativos = (planos || []).filter((p) => p.isActive);

  const { data: proxima } = useQuery({
    queryKey: ["billing", "proxima-mensalidade", client.id],
    enabled: aberto,
    queryFn: async () => {
      const { data } = await supabase.from("billing").select("amount, due_date")
        .eq("client_id", client.id).eq("type", "renewal").eq("status", "pending").gte("due_date", hojeEmSaoPaulo())
        .order("due_date", { ascending: true }).limit(1).maybeSingle();
      return data as { amount: number; due_date: string } | null;
    },
  });

  const abrir = () => {
    setNome(client.plan_name || "");
    setValor(atual ? String(atual) : "");
    setAberto(true);
  };

  const salvar = async () => {
    if (novo <= 0) return void toast.error("Informe o valor do plano.");
    setSalvando(true);
    const nomeFinal = nome.trim() || "Mensalidade";
    const { error } = await supabase.from("profiles").update({
      plan_name: nomeFinal,
      plan_value: novo,
      plan_status: "active",
      client_type: tipoDepoisDoPlano(client.client_type) as "recurring" | "one_off" | "hybrid",
    }).eq("id", client.id);
    setSalvando(false);
    if (error) return void toast.error(`Não foi possível mudar o plano. ${error.message}`);
    await Promise.all(["clients", "billing", "comercial-leads"].map((chave) => queryClient.invalidateQueries({ queryKey: [chave] })));
    if (nomeFinal !== (client.plan_name || "")) void notifyUser(client.id, `Seu plano foi atualizado para "${nomeFinal}"`, "project", "/dashboard");
    toast.success(`Plano atualizado: ${dinheiro(novo)}/mês.`);
    onSalvo?.({ nome: nomeFinal, valor: novo });
    setAberto(false);
  };

  return (
    <>
      <div className="flex min-w-0 items-center justify-between border-b border-border px-4 py-2 sm:px-5" data-plano-na-ficha="">
        <p className={juntar(texto.auxiliar, "mr-3 min-w-0 truncate")}>
          {atual > 0 ? `${client.plan_name || "Mensalidade"} · ${dinheiro(atual)}/mês` : "Sem mensalidade"}
        </p>
        <button type="button" onClick={abrir} className={juntar(botao.secundario, "shrink-0")}>Mudar plano</button>
      </div>
      <Dialog open={aberto} onOpenChange={(a) => { if (!a && !salvando) setAberto(false); }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
          <DialogHeader><DialogTitle className="text-[15px]">Mudar plano</DialogTitle></DialogHeader>
          <div className="min-w-0 space-y-4">
            {ativos.length > 0 && (
              <CampoDeFormulario rotulo="Plano" apoio="Preenche o nome e o valor.">
                <select
                  value={ativos.find((p) => p.name === nome)?.id || ""}
                  onChange={(e) => {
                    const plano = ativos.find((p) => p.id === e.target.value);
                    if (!plano) return;
                    setNome(plano.name);
                    const versao = plano.currentVersion || plano.versions[0];
                    if (versao) setValor(String(versao.finalAmount || versao.amount));
                  }}
                  className={campo}
                >
                  <option value="">Escolher do catálogo</option>
                  {ativos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </CampoDeFormulario>
            )}
            <CampoDeFormulario rotulo="Nome do plano"><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Mensalidade" className={campo} /></CampoDeFormulario>
            <CampoDeFormulario
              rotulo="Valor por mês (R$)"
              obrigatorio
              apoio={proxima
                ? `Próxima cobrança, em ${proxima.due_date.split("-").reverse().join("/")}: ${dinheiro(Number(proxima.amount))} passa a ${dinheiro(novo)}.`
                : "Sem mensalidade em aberto: a próxima já nasce com este valor."}
            >
              <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className={juntar(campo, "tabular-nums")} />
            </CampoDeFormulario>
            <div className="flex items-center justify-end [&>*+*]:ml-2">
              <button type="button" onClick={() => setAberto(false)} disabled={salvando} className={botao.secundario}>Cancelar</button>
              <button type="button" onClick={() => void salvar()} disabled={salvando} className={botao.primario}>{salvando ? "Salvando..." : "Salvar plano"}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
