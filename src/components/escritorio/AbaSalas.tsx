import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DoorOpen, X } from "lucide-react";
import { toast } from "sonner";
import { Carregando, EstadoDeErro, EstadoVazio, Painel, botao, campo, espaco, etiqueta, juntar, texto } from "@/components/sistema";
import { mensagemDoErroDoEscritorio } from "@/lib/escritorio/acessos";
import { presencaPorSlug } from "@/lib/escritorio/presenca";
import { PAPEIS_NA_SALA, type AgenteDoEscritorio, type MembroDaSala, type PapelNaSala, type Presenca, type Sala } from "@/lib/escritorio/tipos";
import LinhaDoAgente from "./LinhaDoAgente";
import { CHAVES, entrarNaSala, mudarPapelNaSala, sairDaSala, useSalas } from "./escritorioApi";

/**
 * Salas do Escritório: cada sala com quem está nela (nome, plataforma e grau).
 * O dono põe e tira membro e muda o papel (dono da sala, membro ou observador).
 */

const rotuloDoPapel = (papel: string) => PAPEIS_NA_SALA.find((p) => p.valor === papel)?.rotulo ?? papel;

function CartaoDaSala({
  sala,
  membros,
  agentes,
  presenca,
  agora,
  admin,
  ocupado,
  rodar,
}: {
  sala: Sala;
  membros: MembroDaSala[];
  agentes: AgenteDoEscritorio[];
  presenca: Map<string, Presenca>;
  agora: number;
  admin: boolean;
  ocupado: boolean;
  rodar: (acao: () => Promise<void>, feito: string) => Promise<void>;
}) {
  const [novo, setNovo] = useState("");
  const dentro = new Set(membros.map((m) => m.operator_slug));
  const fora = agentes.filter((a) => a.status === "active" && !dentro.has(a.slug)).sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR"));
  const quantos = membros.length === 1 ? "1 membro" : `${membros.length} membros`;

  return (
    <Painel
      as="section"
      aria-label={sala.nome}
      titulo={sala.nome}
      descricao={[sala.area, quantos, sala.ativo ? null : "desligada"].filter(Boolean).join(" · ")}
      ajuda={sala.descricao || undefined}
      recolher={false}
      data-sala={sala.slug}
    >
      {membros.length === 0 ? (
        <EstadoVazio compacto titulo="Ninguém nesta sala ainda." />
      ) : (
        <ul className="min-w-0 divide-y divide-border/50" aria-label={`Membros de ${sala.nome}`}>
          {membros.map((m) => {
            const agente = agentes.find((a) => a.slug === m.operator_slug);
            return (
              <li key={m.operator_slug} className="flex min-w-0 items-center py-2.5">
                {agente ? (
                  <LinhaDoAgente agente={agente} presenca={presenca.get(agente.slug)} agora={agora} comEtiquetas className="mr-2 flex-1" />
                ) : (
                  <span className={juntar(texto.corpo, "mr-2 min-w-0 flex-1 truncate text-muted-foreground")} title="Este agente não está mais no cadastro">{m.operator_slug}</span>
                )}
                {admin ? (
                  <>
                    <select
                      className={juntar(campo, "h-8 w-auto shrink-0")}
                      value={m.papel}
                      disabled={ocupado}
                      aria-label={`Papel de ${agente?.display_name ?? m.operator_slug} em ${sala.nome}`}
                      onChange={(e) => void rodar(() => mudarPapelNaSala(sala.id, m.operator_slug, e.target.value as PapelNaSala), "Papel atualizado.")}
                    >
                      {PAPEIS_NA_SALA.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                    </select>
                    <button
                      type="button"
                      className={juntar(botao.icone, "ml-1")}
                      disabled={ocupado}
                      aria-label={`Tirar ${agente?.display_name ?? m.operator_slug} de ${sala.nome}`}
                      title="Tirar da sala"
                      onClick={() => void rodar(() => sairDaSala(sala.id, m.operator_slug), `${agente?.display_name ?? m.operator_slug} saiu de ${sala.nome}.`)}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{rotuloDoPapel(m.papel)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {admin && (
        <div className="mt-3 flex min-w-0 items-center border-t border-border pt-3">
          <select className={juntar(campo, "mr-2 min-w-0 flex-1")} value={novo} disabled={ocupado || fora.length === 0} aria-label={`Agente para entrar em ${sala.nome}`} onChange={(e) => setNovo(e.target.value)}>
            <option value="">{fora.length === 0 ? "Todos os agentes ativos já estão aqui" : "Escolha um agente"}</option>
            {fora.map((a) => <option key={a.slug} value={a.slug}>{a.display_name}</option>)}
          </select>
          <button
            type="button"
            className={botao.secundario}
            disabled={ocupado || !novo}
            onClick={() => {
              const agente = agentes.find((a) => a.slug === novo);
              void rodar(() => entrarNaSala(sala.id, novo), `${agente?.display_name ?? novo} entrou em ${sala.nome}.`).then(() => setNovo(""));
            }}
          >
            Adicionar
          </button>
        </div>
      )}
    </Painel>
  );
}

export default function AbaSalas({ agentes, presencas, agora, admin }: { agentes: AgenteDoEscritorio[]; presencas: Presenca[]; agora: number; admin: boolean }) {
  const qc = useQueryClient();
  const q = useSalas();
  const [ocupado, setOcupado] = useState(false);
  const presenca = useMemo(() => presencaPorSlug(presencas), [presencas]);

  const rodar = async (acao: () => Promise<void>, feito: string) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      await acao();
      toast.success(feito);
      await qc.invalidateQueries({ queryKey: CHAVES.salas });
    } catch (e) {
      toast.error(mensagemDoErroDoEscritorio(e, "Não foi possível salvar."));
    } finally {
      setOcupado(false);
    }
  };

  if (q.isLoading) return <Carregando rotulo="Lendo as salas" forma="grade" />;
  if (q.error) return <EstadoDeErro titulo="Não foi possível ler as salas." descricao={(q.error as Error).message} />;
  const salas = q.data?.salas ?? [];
  if (salas.length === 0) return <EstadoVazio icone={<DoorOpen className="h-5 w-5" />} titulo="Nenhuma sala criada ainda." />;

  return (
    <div className={juntar(espaco.grade, "items-start lg:grid-cols-2")} data-salas-do-escritorio="">
      {salas.map((sala) => (
        <CartaoDaSala
          key={sala.id}
          sala={sala}
          membros={(q.data?.membros ?? []).filter((m) => m.grupo_id === sala.id)}
          agentes={agentes}
          presenca={presenca}
          agora={agora}
          admin={admin}
          ocupado={ocupado}
          rodar={rodar}
        />
      ))}
    </div>
  );
}
