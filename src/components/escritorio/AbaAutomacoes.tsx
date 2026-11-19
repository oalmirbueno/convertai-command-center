import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Carregando, EstadoDeErro, EstadoVazio, botao, campo, juntar, lista, texto, useEstadoDaTela } from "@/components/sistema";
import { Card, Chip, PillTabs, type Tone } from "@/components/ds";
import { haQuanto } from "@/lib/gruposAoVivo";
import { mensagemDoErroDoEscritorio } from "@/lib/escritorio/acessos";
import { filtrarAutomacoes, type FiltroDeAutomacao } from "@/lib/escritorio/automacoes";
import type { AgenteDoEscritorio, Automacao } from "@/lib/escritorio/tipos";
import { CHAVES, mudarDonoDaAutomacao, useAutomacoes } from "./escritorioApi";

/**
 * Automações do Escritório: os fluxos (n8n e outros) com quem é o dono, se
 * estão ligados, a última execução e o último erro (19/11: lista num cartão,
 * estado em Chip, o que faz no title). O dono troca o responsável aqui. Ligar
 * e desligar ainda não é por esta tela: depende da ponte com o n8n.
 */

const STATUS: Record<NonNullable<Automacao["ultimo_status"]>, { rotulo: string; tom: Tone }> = {
  ok: { rotulo: "Deu certo", tom: "success" },
  erro: { rotulo: "Erro", tom: "danger" },
  rodando: { rotulo: "Rodando", tom: "info" },
};

export default function AbaAutomacoes({ agentes, admin, agora }: { agentes: AgenteDoEscritorio[]; admin: boolean; agora: number }) {
  const qc = useQueryClient();
  const q = useAutomacoes();
  const [filtro, setFiltro] = useEstadoDaTela<FiltroDeAutomacao>("escritorio:automacoes:filtro", "todas", { validar: (v) => v === "todas" || v === "erro" || v === "nunca" });
  const [ocupado, setOcupado] = useState(false);

  const trocarDono = async (a: Automacao, slug: string) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      await mudarDonoDaAutomacao(a.id, slug || null);
      toast.success(slug ? `${agentes.find((x) => x.slug === slug)?.display_name ?? slug} agora cuida de ${a.nome}.` : `${a.nome} ficou sem dono.`);
      await qc.invalidateQueries({ queryKey: CHAVES.automacoes });
    } catch (e) {
      toast.error(mensagemDoErroDoEscritorio(e, "Não foi possível trocar o dono."));
    } finally {
      setOcupado(false);
    }
  };

  if (q.isLoading) return <Carregando rotulo="Lendo as automações" linhas={6} />;
  if (q.error) return <EstadoDeErro titulo="Não foi possível ler as automações." descricao={(q.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />;
  const todas = q.data ?? [];
  if (todas.length === 0) {
    return <EstadoVazio icone={<Workflow className="h-5 w-5" />} titulo="Nenhuma automação registrada ainda." descricao="Elas aparecem aqui quando o n8n começar a avisar o Escritório." />;
  }
  const visiveis = filtrarAutomacoes(todas, filtro);
  const donos = agentes.filter((a) => a.status === "active").sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR"));

  return (
    <div className="min-w-0 space-y-4" data-automacoes-do-escritorio="">
      <PillTabs<FiltroDeAutomacao>
        label="Filtrar automações"
        variant="soft"
        value={filtro}
        onChange={setFiltro}
        tabs={[
          { value: "todas", label: "Todas", count: todas.length },
          { value: "erro", label: "Com erro", count: filtrarAutomacoes(todas, "erro").length },
          { value: "nunca", label: "Nunca rodou", count: filtrarAutomacoes(todas, "nunca").length },
        ]}
      />

      {visiveis.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhuma automação neste filtro." />
      ) : (
        <Card>
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Automações">
            {visiveis.map((a) => {
              const status = a.ultimo_status ? STATUS[a.ultimo_status] : null;
              const dono = agentes.find((x) => x.slug === a.dono_slug);
              return (
                <li key={a.id} data-automacao={a.ref} className={juntar(lista.linha, "flex-wrap items-start sm:flex-nowrap sm:items-center")}>
                  <span aria-hidden="true" className="mr-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Workflow className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1" title={a.o_que_faz || undefined}>
                    <span className="flex min-w-0 flex-wrap items-center [&>*]:mb-0.5">
                      <span className={juntar(texto.corpo, "mr-2 min-w-0 max-w-full truncate font-medium")}>{a.nome}</span>
                      <Chip tone={a.ativo ? "success" : "neutral"} dot>{a.ativo ? "Ligada" : "Desligada"}</Chip>
                      {status && <Chip className="ml-1.5" tone={status.tom}>{status.rotulo}</Chip>}
                    </span>
                    {a.ultimo_erro ? (
                      <span className={juntar(texto.auxiliar, "mt-0.5 flex min-w-0 items-center text-destructive")}>
                        <AlertTriangle className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate">{a.ultimo_erro}</span>
                        {a.ultimo_erro_em && <span className="ml-1.5 shrink-0 tabular-nums text-muted-foreground">{haQuanto(a.ultimo_erro_em, agora)}</span>}
                      </span>
                    ) : (
                      <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{a.plataforma} · {a.ultima_execucao_em ? `rodou ${haQuanto(a.ultima_execucao_em, agora)}` : "nunca rodou"}</span>
                    )}
                  </span>
                  <span className="mt-2 flex w-full shrink-0 items-center pl-12 sm:ml-3 sm:mt-0 sm:w-auto sm:pl-0">
                    {admin ? (
                      <select className={juntar(campo, "h-8 w-auto max-w-[180px]")} value={a.dono_slug ?? ""} disabled={ocupado} aria-label={`Dono de ${a.nome}`} onChange={(e) => void trocarDono(a, e.target.value)}>
                        <option value="">Sem dono</option>
                        {a.dono_slug && !donos.some((x) => x.slug === a.dono_slug) && <option value={a.dono_slug}>{dono?.display_name ?? a.dono_slug}</option>}
                        {donos.map((x) => <option key={x.slug} value={x.slug}>{x.display_name}</option>)}
                      </select>
                    ) : (
                      <Chip outline>{dono?.display_name ?? a.dono_slug ?? "Sem dono"}</Chip>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
