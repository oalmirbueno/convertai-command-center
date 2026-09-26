import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Layers, Loader2, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { modoDoTipo, type EstruturaDoModelo } from "../../../supabase/functions/_shared/roteiro-modelo";
import { chamarRoteiros, CHAVES, useModelos, useRoteiros, type ModeloDeRoteiro } from "./roteirosApi";
import { AvisoDoBanco } from "./Comuns";

/**
 * Etapa 5: memória (MEMORIA-E-TEMPLATES.md, de forma simples). Todo roteiro
 * aprovado vira modelo do cliente sozinho (estrutura, ritmo, direção e as
 * falas como exemplo, só deste cliente). O modelo da agência é escolha
 * explícita, com prévia do que sai: sem fala, legenda, CTA, nome, contato,
 * número ou oferta do cliente de origem. Usar um modelo abre um roteiro novo
 * com ele como base (a IA não copia: segue o ritmo com o conteúdo novo).
 */
export default function EtapaModelos({ onUsarModelo }: { onUsarModelo: (id: string) => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const modelosQ = useModelos(clientId);
  const roteirosQ = useRoteiros(clientId);
  const modelos = modelosQ.data ? modelosQ.data.lista : [];
  const aprovados = (roteirosQ.data ? roteirosQ.data.lista : []).filter((r) => !!r.versao_aprovada && !r.arquivado_em);
  const [origem, setOrigem] = useState("");
  const [previa, setPrevia] = useState<{ estrutura: EstruturaDoModelo; removidos: string[] } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const verPrevia = async () => {
    if (!origem) return;
    setOcupado("previa");
    try {
      const r = await chamarRoteiros<{ estrutura: EstruturaDoModelo; removidos: string[] }>("modelo_previa", { roteiro_id: origem, escopo: "agencia" });
      setPrevia(r);
    } catch (e) {
      avisarErro(e, "Não foi possível montar a prévia");
    } finally {
      setOcupado(null);
    }
  };

  const salvarDaAgencia = async () => {
    setOcupado("salvar");
    try {
      await chamarRoteiros("modelo_salvar", { roteiro_id: origem, escopo: "agencia" });
      toast.success("Modelo da agência salvo", { description: "Sem dado do cliente de origem." });
      setPrevia(null);
      setOrigem("");
      void qc.invalidateQueries({ queryKey: CHAVES.modelos(clientId) });
    } catch (e) {
      avisarErro(e, "Não foi possível salvar o modelo");
    } finally {
      setOcupado(null);
    }
  };

  const revogar = async (m: ModeloDeRoteiro) => {
    setOcupado(m.id);
    try {
      await chamarRoteiros("modelo_revogar", { modelo_id: m.id });
      toast.success("Modelo retirado", { description: "Não aparece mais para usos novos." });
      void qc.invalidateQueries({ queryKey: CHAVES.modelos(clientId) });
    } catch (e) {
      avisarErro(e, "Não foi possível retirar o modelo");
    } finally {
      setOcupado(null);
    }
  };

  if (modelosQ.data && modelosQ.data.indisponivel) return <AvisoDoBanco />;

  const doCliente = modelos.filter((m) => m.escopo === "cliente");
  const daAgencia = modelos.filter((m) => m.escopo === "agencia");
  const cartao = (m: ModeloDeRoteiro) => (
    <li key={m.id} className="flex min-w-0 flex-wrap items-center rounded-xl border border-border p-3" data-modelo={m.id}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{m.nome}</p>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {modoDoTipo(m.tipo).rotulo} · {m.estrutura.blocos.length} blocos · {m.estrutura.duracao_alvo_s}s · {m.estrutura.blocos.map((b) => b.funcao).join(", ")}
        </p>
      </div>
      <div className="mt-1 flex items-center sm:mt-0">
        <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => onUsarModelo(m.id)}>Usar num roteiro novo</Button>
        <button type="button" className="ml-1 p-2 text-muted-foreground hover:text-destructive disabled:opacity-50" disabled={ocupado === m.id} onClick={() => void revogar(m)} aria-label={`Retirar o modelo ${m.nome}`}>
          {ocupado === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </li>
  );

  return (
    <div className="space-y-4" data-etapa-modelos="">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center text-[14px] font-semibold"><UserRound className="mr-1.5 h-4 w-4 text-primary" />Modelos deste cliente</h2>
        <p className="text-[11.5px] text-muted-foreground">Todo roteiro aprovado vira modelo daqui. Fica só com este cliente.</p>
        {modelosQ.isLoading && <p className="mt-2 text-[12px] text-muted-foreground">Carregando...</p>}
        {!modelosQ.isLoading && !doCliente.length && <p className="mt-2 text-[12.5px] text-muted-foreground">Nenhum ainda. Aprove um roteiro na Revisão.</p>}
        <ul className="mt-2 space-y-2">{doCliente.map(cartao)}</ul>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center text-[14px] font-semibold"><Building2 className="mr-1.5 h-4 w-4 text-primary" />Modelos da agência</h2>
        <p className="text-[11.5px] text-muted-foreground">Estrutura e ritmo que servem a qualquer cliente, sem dado privado.</p>
        {!daAgencia.length && <p className="mt-2 text-[12.5px] text-muted-foreground">Nenhum ainda.</p>}
        <ul className="mt-2 space-y-2">{daAgencia.map(cartao)}</ul>

        <div className="mt-4 rounded-xl bg-muted/50 p-3">
          <p className="flex items-center text-[12.5px] font-medium"><Layers className="mr-1.5 h-4 w-4" />Levar um roteiro aprovado para a agência</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            <select
              value={origem}
              onChange={(e) => {
                setOrigem(e.target.value);
                setPrevia(null);
              }}
              className="mb-1 mr-2 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-[12.5px]"
              aria-label="Roteiro aprovado de origem"
            >
              <option value="">{aprovados.length ? "Escolha o roteiro aprovado" : "Nenhum roteiro aprovado ainda"}</option>
              {aprovados.map((r) => (
                <option key={r.id} value={r.id}>{r.titulo}</option>
              ))}
            </select>
            <Button type="button" size="sm" variant="outline" className="mb-1 h-8 text-[12px]" disabled={!origem || !!ocupado} onClick={() => void verPrevia()}>
              {ocupado === "previa" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Ver prévia
            </Button>
          </div>
          {previa && (
            <div className="mt-3 rounded-lg border border-border bg-background p-3" data-previa-do-modelo="">
              <p className="flex items-center text-[12px] font-medium"><ShieldCheck className="mr-1.5 h-4 w-4 text-primary" />Sai do modelo: {previa.removidos.join(", ")}.</p>
              <ol className="mt-2 space-y-1 text-[12px]">
                {previa.estrutura.blocos.map((b, i) => (
                  <li key={i}>
                    <span className="font-medium">{i + 1}. {b.funcao}</span> ({b.segundos}s){b.orientacao ? `: ${b.orientacao}` : ""}
                  </li>
                ))}
              </ol>
              {previa.estrutura.mecanismos_de_gancho.length > 0 && <p className="mt-1 text-[11.5px] text-muted-foreground">Mecanismos de gancho: {previa.estrutura.mecanismos_de_gancho.join(", ")}</p>}
              <Button type="button" size="sm" className="mt-3 h-8 text-[12px]" disabled={!!ocupado} onClick={() => void salvarDaAgencia()}>
                {ocupado === "salvar" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Salvar como modelo da agência
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
