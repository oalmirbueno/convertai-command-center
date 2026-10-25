import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida, Carregando, botao, juntar, texto } from "@/components/sistema";
import {
  atendidoPeloMercurio,
  confirmarFato,
  decidirFato,
  historiaDoAgente,
  listarFatos,
  mercurioNoLead,
  rotuloDoCampoDoFato,
  type FatoDoLead,
  type Lead,
} from "@/lib/comercial";

/**
 * O agente no lead (25/10/2026): a chave "Mercúrio atende este lead", o que ele levantou com prova (gravado)
 * e o que espera a equipe (sugestão: Confirmar grava no campo do lead, da empresa ou da qualificação;
 * Descartar tira da lista) e a história do agente.
 */

const data = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
};

function LinhaDoFato({ fato, aoConfirmar, aoDescartar }: { fato: FatoDoLead; aoConfirmar?: () => Promise<void>; aoDescartar?: () => Promise<void> }) {
  const [rodando, setRodando] = useState(false);
  const fazer = async (f?: () => Promise<void>) => {
    if (!f) return;
    setRodando(true);
    try {
      await f();
    } finally {
      setRodando(false);
    }
  };
  return (
    <li className="flex min-w-0 items-start gap-2 border-t border-border py-2 first:border-t-0" data-fato={fato.id} data-situacao={fato.situacao}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5">
          <span className="text-muted-foreground">{rotuloDoCampoDoFato(fato.campo)}:</span> <span className="break-words font-medium text-foreground">{fato.valor}</span>
        </p>
        <p className="text-[11px] leading-4 text-muted-foreground" title={fato.evidencia}>
          {fato.detalhe || fato.evidencia}
          {fato.fonte_url && (
            <a href={fato.fonte_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center underline underline-offset-2">
              fonte <ExternalLink className="ml-0.5 h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </p>
      </div>
      {aoConfirmar && (
        <button type="button" disabled={rodando} onClick={() => void fazer(aoConfirmar)} className={juntar(botao.icone, "text-success hover:text-success")} aria-label={`Confirmar ${rotuloDoCampoDoFato(fato.campo)}: ${fato.valor}`} title="Confirmar e gravar">
          <Check className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {aoDescartar && (
        <button type="button" disabled={rodando} onClick={() => void fazer(aoDescartar)} className={botao.icone} aria-label={`Descartar ${rotuloDoCampoDoFato(fato.campo)}: ${fato.valor}`} title="Descartar">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export default function AgenteDoLead({ lead, aoMudar }: { lead: Lead; aoMudar: () => Promise<unknown> | void }) {
  const qc = useQueryClient();
  const chaveDosFatos = ["comercial-fatos", lead.id];
  const fatos = useQuery({ queryKey: chaveDosFatos, queryFn: () => listarFatos(lead.id, lead.organization_id) });
  const historia = useQuery({ queryKey: ["comercial-historia-agente", lead.id], queryFn: () => historiaDoAgente(lead.id) });
  const [atende, setAtende] = useState(atendidoPeloMercurio(lead));
  const [mudando, setMudando] = useState(false);
  const lista = fatos.data || [];
  const sugestoes = lista.filter((f) => f.situacao === "sugestao");
  const gravados = lista.filter((f) => f.situacao === "gravado");

  const trocar = async (v: boolean) => {
    setMudando(true);
    try {
      await mercurioNoLead(lead.id, v);
      setAtende(v);
      await aoMudar();
      toast.success(v ? "O Mercúrio passou a atender este lead." : "O lead voltou para a equipe.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível mudar.");
    } finally {
      setMudando(false);
    }
  };
  const recarregar = async () => {
    await qc.invalidateQueries({ queryKey: chaveDosFatos });
    await aoMudar();
  };

  return (
    <section className="min-w-0 space-y-4" aria-label="Agente do lead">
      <div className="flex min-w-0 items-center gap-2">
        <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <label className="flex min-w-0 flex-1 items-center text-[13px] font-medium">
          <input type="checkbox" className="mr-2" checked={atende} disabled={mudando} onChange={(e) => void trocar(e.target.checked)} aria-label="Mercúrio atende este lead" />
          Mercúrio atende este lead
        </label>
        {atende && lead.agente_desde && <span className={texto.auxiliar}>desde {data(lead.agente_desde)}</span>}
        <AjudaRecolhida rotulo="O que o Mercúrio faz aqui">
          Com a chave ligada, o Mercúrio conversa com este lead, registra a conversa e avisa na Caixa quando ele avançar ou fechar. Desligue para a equipe seguir sozinha.
        </AjudaRecolhida>
      </div>

      <section className="min-w-0" aria-label="Sugestões do agente">
        <h3 className={juntar(texto.tituloSecao, "mb-1 text-[14px]")}>Para confirmar {sugestoes.length > 0 ? `(${sugestoes.length})` : ""}</h3>
        {fatos.isLoading ? (
          <Carregando linhas={2} />
        ) : sugestoes.length === 0 ? (
          <p className={texto.auxiliar}>Nada esperando você.</p>
        ) : (
          <ul className="min-w-0">
            {sugestoes.map((f) => (
              <LinhaDoFato
                key={f.id}
                fato={f}
                aoConfirmar={async () => {
                  try {
                    await confirmarFato(f, lead.id);
                    toast.success("Confirmado e gravado.");
                    await recarregar();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Não foi possível confirmar.");
                  }
                }}
                aoDescartar={async () => {
                  try {
                    await decidirFato(f.id, "descartado");
                    await recarregar();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Não foi possível descartar.");
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {gravados.length > 0 && (
        <section className="min-w-0" aria-label="O que o agente gravou">
          <h3 className={juntar(texto.tituloSecao, "mb-1 text-[14px]")}>Gravado com prova</h3>
          <ul className="min-w-0">
            {gravados.map((f) => (
              <LinhaDoFato key={f.id} fato={f} />
            ))}
          </ul>
        </section>
      )}

      <section className="min-w-0" aria-label="História do agente">
        <h3 className={juntar(texto.tituloSecao, "mb-1 text-[14px]")}>O que o agente fez</h3>
        {(historia.data || []).length === 0 ? (
          <p className={texto.auxiliar}>Nada registrado pelo agente ainda.</p>
        ) : (
          <ul className="min-w-0 divide-y divide-border">
            {(historia.data || []).map((e) => (
              <li key={e.id} className="py-1.5 text-[13px] leading-5 text-muted-foreground">
                {e.note}
                <span className="ml-1.5 text-[12px] tabular-nums opacity-70">{data(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
