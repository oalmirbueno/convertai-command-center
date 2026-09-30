import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Link2Off, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { copiarTexto } from "@/components/mesa/ContextoPaleta";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, foco, juntar, lista, texto } from "@/components/sistema/estilos";
import { LIMITES_DO_NAMING, type CandidatoDeNome, type ResumoDoVoto } from "../../../supabase/functions/mesa-identidade/modulos/naming";
import { chamarIdentidade, type RodadaDeNomes } from "./identidadeApi";
import { Pastilha } from "./Comuns";

type Votos = {
  votos: Array<{ candidato_id: string; origem: "equipe" | "cliente"; nota: number; votante: string; comentario: string | null; atualizado_em: string }>;
  resumo: Record<string, ResumoDoVoto>;
  votacao: { caminho: string; aberta_em: string | null; fechada_em: string | null } | null;
  /** UXS 30/09: as notas de quem está olhando (o servidor filtra pela pessoa; a chave dela não vem). */
  minhas?: Record<string, number>;
  aviso?: string;
};

function Estrelas({ valor, onEscolher, rotulo, gravando = false }: { valor: number; onEscolher: (n: number) => void; rotulo: string; gravando?: boolean }) {
  return (
    <span className="inline-flex items-center" role="radiogroup" aria-label={rotulo} aria-busy={gravando || undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={valor === n} aria-label={`${n} de 5`} disabled={gravando} onClick={() => onEscolher(n)} className={juntar("toque-compacto inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-60", foco)}>
          <Star className={juntar("h-4 w-4", n <= valor ? "fill-primary text-primary" : "text-muted-foreground")} />
        </button>
      ))}
      {gravando && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Gravando o voto" />}
    </span>
  );
}

const media = (v: number | null) => (v === null ? "sem voto" : v.toFixed(1));

/**
 * Votação dos nomes (IDV2): a equipe vota aqui (1 a 5 por finalista) e o
 * cliente vota por um link (sem login), que mostra só nome, justificativa e
 * pronúncia. O link não é enviado pelo painel: a equipe copia e manda. Fechar
 * a votação tira o link do ar para novos votos.
 *
 * UXS 30/09: as estrelas mostram o voto que a pessoa já deu e cada estrela
 * grava na hora (a linha espera a resposta; se falhar, volta ao que está no
 * banco). Saiu o "Registrar meu voto".
 */
export default function VotacaoDosNomes({ rodada }: { rodada: RodadaDeNomes }) {
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const chave = ["mesa-identidade", "votos", rodada.id];
  const votos = useQuery({ queryKey: chave, queryFn: () => chamarIdentidade<Votos>("naming_votos", { rodada_id: rodada.id }), staleTime: 30_000 });
  const finalistas: CandidatoDeNome[] = rodada.candidatos.filter((c) => c.finalista);
  /** Nota escolhida agora, enquanto grava (por finalista). */
  const [otimistas, setOtimistas] = useState<Record<string, number>>({});
  const [gravando, setGravando] = useState<Record<string, boolean>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const v = votos.data;
  const minhas = (v && v.minhas) || {};
  const notaDe = (id: string) => (otimistas[id] !== undefined ? otimistas[id] : minhas[id] || 0);

  const votar = async (candidatoId: string, nota: number) => {
    if (gravando[candidatoId]) return;
    setOtimistas((o) => ({ ...o, [candidatoId]: nota }));
    setGravando((g) => ({ ...g, [candidatoId]: true }));
    try {
      await chamarIdentidade("naming_votar", { rodada_id: rodada.id, votos: [{ candidato_id: candidatoId, nota }] });
      await qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      avisarErro(e, "O voto não foi gravado");
    } finally {
      // Sem a nota otimista, a estrela mostra a do banco (a nova, ou a de antes quando falhou).
      setOtimistas((o) => {
        const n = { ...o };
        delete n[candidatoId];
        return n;
      });
      setGravando((g) => ({ ...g, [candidatoId]: false }));
    }
  };
  const link = v && v.votacao ? `${window.location.origin}${v.votacao.caminho}` : null;
  const aberta = !!(v && v.votacao && !v.votacao.fechada_em);

  const rodar = async (qual: string, fn: () => Promise<void>) => {
    setOcupado(qual);
    try {
      await fn();
    } catch (e) {
      avisarErro(e, "Não foi possível concluir");
    } finally {
      setOcupado(null);
    }
  };

  if (finalistas.length < LIMITES_DO_NAMING.finalistasMin) return null;

  return (
    <Secao
      titulo="Votação"
      divisoria
      descricao={v ? `${v.votos.filter((x) => x.origem === "equipe").length} votos da equipe · ${v.votos.filter((x) => x.origem === "cliente").length} do cliente` : undefined}
      recolher={`mesa-identidade:nomes:${rodada.id}:votacao`}
      ajuda="A equipe dá de 1 a 5 a cada finalista. O cliente vota pelo link (sem login), que mostra só o nome, a justificativa e a pronúncia. O painel não envia o link: copie e mande no grupo. Fechar a votação para de aceitar votos."
      acao={
        <>
          {!aberta ? (
            <button type="button" className={juntar(botao.secundario, "m-1 h-8")} disabled={!!ocupado} onClick={() => void rodar("abrir", async () => {
              const r = await chamarIdentidade<{ caminho: string }>("naming_votacao_abrir", { rodada_id: rodada.id });
              await copiarTexto(`${window.location.origin}${r.caminho}`);
              toast.success("Votação aberta e link copiado", { description: "Mande o link no grupo do cliente." });
              void qc.invalidateQueries({ queryKey: chave });
            })}>
              {ocupado === "abrir" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />} {v && v.votacao ? "Reabrir a votação do cliente" : "Abrir votação do cliente"}
            </button>
          ) : (
            <>
              <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={() => link && void copiarTexto(link).then((ok) => (ok ? toast.success("Link copiado") : toast.error("Não deu para copiar")))}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar link
              </button>
              <button type="button" className={juntar(botao.discreto, "m-1 h-8")} disabled={!!ocupado} onClick={() => void rodar("fechar", async () => {
                await chamarIdentidade("naming_votacao_fechar", { rodada_id: rodada.id });
                toast.success("Votação fechada");
                void qc.invalidateQueries({ queryKey: chave });
              })}>
                <Link2Off className="mr-1.5 h-3.5 w-3.5" /> Fechar
              </button>
            </>
          )}
        </>
      }
    >
      {v && v.aviso && <p className={juntar(texto.auxiliar, "mb-2 text-warning")}>{v.aviso}</p>}
      {votos.isError && <p className={juntar(texto.auxiliar, "mb-2 text-warning")}>Não foi possível ler os votos.</p>}
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Votos por finalista">
        {finalistas.map((c) => {
          const r = v && v.resumo[c.id];
          const comentarios = v ? v.votos.filter((x) => x.candidato_id === c.id && x.comentario) : [];
          return (
            <li key={c.id} className={juntar(lista.linha, "flex-wrap items-start")} data-voto-do-nome={c.id}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.nome}</span>
                <span className={juntar(texto.auxiliar, "block")}>
                  Equipe {media(r ? r.equipe : null)}
                  {r && r.n_equipe ? ` (${r.n_equipe})` : ""} · Cliente {media(r ? r.cliente : null)}
                  {r && r.n_cliente ? ` (${r.n_cliente})` : ""}
                </span>
                {comentarios.slice(0, 3).map((x, i) => (
                  <span key={i} className={juntar(texto.auxiliar, "block truncate")} title={x.comentario || ""}>
                    {x.votante}: {x.comentario}
                  </span>
                ))}
              </span>
              <Estrelas valor={notaDe(c.id)} rotulo={`Seu voto em ${c.nome}`} gravando={!!gravando[c.id]} onEscolher={(n) => void votar(c.id, n)} />
            </li>
          );
        })}
      </ul>
      {aberta && (
        <div className="mt-2 flex min-w-0 items-center justify-end">
          <Pastilha tom="bom">link aberto</Pastilha>
        </div>
      )}
    </Secao>
  );
}
