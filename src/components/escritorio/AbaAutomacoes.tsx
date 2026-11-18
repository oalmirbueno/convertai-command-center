import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { toast } from "sonner";
import { tabela } from "@/components/finance/pecasDoFinanceiro";
import { Carregando, EstadoDeErro, EstadoVazio, botao, campo, etiqueta, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import { haQuanto } from "@/lib/gruposAoVivo";
import { mensagemDoErroDoEscritorio } from "@/lib/escritorio/acessos";
import { filtrarAutomacoes, type FiltroDeAutomacao } from "@/lib/escritorio/automacoes";
import type { AgenteDoEscritorio, Automacao } from "@/lib/escritorio/tipos";
import { CHAVES, mudarDonoDaAutomacao, useAutomacoes } from "./escritorioApi";

/**
 * Automações do Escritório: os fluxos (n8n e outros) com o que fazem, quem é
 * o dono, se estão ligados, a última execução e o último erro. O dono troca o
 * responsável aqui. Ligar e desligar ainda não é por esta tela: depende da
 * ponte com o n8n, que não existe nesta versão.
 */

const FILTROS: { valor: Exclude<FiltroDeAutomacao, "todas">; rotulo: string }[] = [
  { valor: "erro", rotulo: "Só com erro" },
  { valor: "nunca", rotulo: "Nunca rodou" },
];

const STATUS: Record<NonNullable<Automacao["ultimo_status"]>, { rotulo: string; classe: string }> = {
  ok: { rotulo: "Deu certo", classe: "bg-success-soft text-success" },
  erro: { rotulo: "Erro", classe: "bg-danger-soft text-destructive" },
  rodando: { rotulo: "Rodando", classe: "bg-info-soft text-info" },
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
  if (q.error) return <EstadoDeErro titulo="Não foi possível ler as automações." descricao={(q.error as Error).message} />;
  const todas = q.data ?? [];
  if (todas.length === 0) {
    return <EstadoVazio icone={<Workflow className="h-5 w-5" />} titulo="Nenhuma automação registrada ainda." descricao="Elas aparecem aqui quando o n8n começar a avisar o Escritório." />;
  }
  const visiveis = filtrarAutomacoes(todas, filtro);
  const donos = agentes.filter((a) => a.status === "active").sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR"));

  return (
    <div className="min-w-0 space-y-4" data-automacoes-do-escritorio="">
      <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="Filtrar automações">
        {FILTROS.map((f) => (
          <button key={f.valor} type="button" aria-pressed={filtro === f.valor} onClick={() => setFiltro(filtro === f.valor ? "todas" : f.valor)} className={juntar(filtro === f.valor ? botao.primario : botao.secundario, "mr-1.5 h-8")}>
            {f.rotulo}
          </button>
        ))}
        <span className={juntar(texto.auxiliar, "ml-1 tabular-nums")}>{visiveis.length} de {todas.length}</span>
      </div>

      {visiveis.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhuma automação neste filtro." />
      ) : (
        <div className={tabela.moldura}>
          <table className={juntar(tabela.tabela, "min-w-[980px]")} aria-label="Automações">
            <thead className={tabela.cabeca}>
              <tr>
                <th>Automação</th>
                <th>O que faz</th>
                <th>Dono</th>
                <th>Estado</th>
                <th>Última execução</th>
                <th>Último status</th>
                <th>Último erro</th>
              </tr>
            </thead>
            <tbody className={tabela.corpo}>
              {visiveis.map((a) => {
                const status = a.ultimo_status ? STATUS[a.ultimo_status] : null;
                const dono = agentes.find((x) => x.slug === a.dono_slug);
                return (
                  <tr key={a.id} data-automacao={a.ref}>
                    <td className="align-top">
                      <span className="block font-medium text-foreground">{a.nome}</span>
                      <span className={texto.auxiliar}>{a.plataforma}</span>
                    </td>
                    <td className="max-w-[280px] align-top text-muted-foreground">{a.o_que_faz || "Sem descrição"}</td>
                    <td className="align-top">
                      {admin ? (
                        <select className={juntar(campo, "h-8 w-auto max-w-[180px]")} value={a.dono_slug ?? ""} disabled={ocupado} aria-label={`Dono de ${a.nome}`} onChange={(e) => void trocarDono(a, e.target.value)}>
                          <option value="">Sem dono</option>
                          {a.dono_slug && !donos.some((x) => x.slug === a.dono_slug) && <option value={a.dono_slug}>{dono?.display_name ?? a.dono_slug}</option>}
                          {donos.map((x) => <option key={x.slug} value={x.slug}>{x.display_name}</option>)}
                        </select>
                      ) : (
                        dono?.display_name ?? a.dono_slug ?? "Sem dono"
                      )}
                    </td>
                    <td className="align-top">
                      <span className={juntar(etiqueta, a.ativo ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>{a.ativo ? "Ligada" : "Desligada"}</span>
                    </td>
                    <td className="whitespace-nowrap align-top tabular-nums">{a.ultima_execucao_em ? haQuanto(a.ultima_execucao_em, agora) : "nunca rodou"}</td>
                    <td className="align-top">{status ? <span className={juntar(etiqueta, status.classe)}>{status.rotulo}</span> : <span className="text-muted-foreground">Sem registro</span>}</td>
                    <td className="max-w-[280px] align-top">
                      {a.ultimo_erro ? (
                        <>
                          <span className="block text-foreground">{a.ultimo_erro}</span>
                          {a.ultimo_erro_em && <span className={texto.auxiliar}>{haQuanto(a.ultimo_erro_em, agora)}</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Nenhum</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
