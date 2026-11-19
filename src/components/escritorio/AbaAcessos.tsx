import { useMemo } from "react";
import { KeyRound } from "lucide-react";
import { Carregando, EstadoDeErro, EstadoVazio, botao, juntar, lista, texto } from "@/components/sistema";
import { Card, Chip } from "@/components/ds";
import { haQuanto } from "@/lib/gruposAoVivo";
import { bloqueiosAbertos, credenciaisPorAgente } from "@/lib/escritorio/acessos";
import { presencaPorSlug, ultimaAtividade } from "@/lib/escritorio/presenca";
import type { AgenteDoEscritorio, Presenca } from "@/lib/escritorio/tipos";
import LinhaDoAgente from "./LinhaDoAgente";
import { estadoDoAgente } from "./FichaDoAgente";
import { useAcessos } from "./escritorioApi";

/**
 * Acessos do Escritório (19/11/2026): uma linha por agente com a plataforma,
 * o grau, o estado, quantas credenciais assinam por ele e a última atividade.
 * Clicar abre a ficha no centro, onde o dono muda o grau, bloqueia,
 * desbloqueia e liga credencial (o segredo da chave nunca aparece).
 */
export default function AbaAcessos({ agentes, presencas, agora, aoAbrir }: { agentes: AgenteDoEscritorio[]; presencas: Presenca[]; agora: number; aoAbrir: (slug: string) => void }) {
  const q = useAcessos();
  const presenca = useMemo(() => presencaPorSlug(presencas), [presencas]);
  const credenciais = useMemo(() => credenciaisPorAgente(q.data?.vinculos ?? [], q.data?.chaves ?? []), [q.data]);
  const bloqueios = useMemo(() => bloqueiosAbertos(q.data?.bloqueios ?? []), [q.data]);

  if (q.isLoading) return <Carregando rotulo="Lendo os acessos" linhas={8} />;
  if (q.error) return <EstadoDeErro titulo="Não foi possível ler os acessos." descricao={(q.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />;
  if (agentes.length === 0) return <EstadoVazio titulo="Nenhum agente no cadastro." />;

  return (
    <Card data-acessos-do-escritorio="">
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Acessos dos agentes">
        {agentes.map((a) => {
          const p = presenca.get(a.slug);
          const bloqueio = bloqueios.get(a.slug);
          const estado = estadoDoAgente(a.status);
          const doAgente = credenciais.get(a.slug) ?? [];
          const ultima = ultimaAtividade(a.last_run_at, p?.batimento_em);
          return (
            <li key={a.id} data-acesso={a.slug}>
              <button type="button" onClick={() => aoAbrir(a.slug)} className={juntar(lista.linha, "w-full text-left")} title={`Abrir a ficha de ${a.display_name}`}>
                <LinhaDoAgente agente={a} presenca={p} agora={agora} comEtiquetas className="mr-3 flex-1" />
                <span className="flex shrink-0 flex-col items-end sm:flex-row sm:items-center">
                  <span className="flex items-center">
                    {bloqueio ? <Chip tone="danger">Bloqueado</Chip> : <Chip tone={estado.tom} dot>{estado.rotulo}</Chip>}
                    <Chip className="ml-1.5" icon={<KeyRound className="h-3 w-3" />} title={doAgente.length === 1 ? "1 credencial" : `${doAgente.length} credenciais`}>{doAgente.length}</Chip>
                  </span>
                  <span className={juntar(texto.auxiliar, "mt-1 whitespace-nowrap tabular-nums sm:ml-3 sm:mt-0 sm:w-24 sm:text-right")}>{ultima ? haQuanto(ultima, agora) : "sem atividade"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
