import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CampoDeFormulario, GrupoDeCampos, Secao, campo as estiloDoCampo, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { lerAgendas, salvarAgenda } from "@/lib/documentos/registrarEntrega";
import { DEFINICOES_DE_DOCUMENTO, MODELOS_DE_DOCUMENTO, type ModeloDeDocumento, rotuloDoMesDeReferencia } from "../../../supabase/functions/documentos/modulos/documento-modelos";

/**
 * Documento mensal automático (frente BRF2, 30/09/2026): no dia marcado, o
 * painel monta o rascunho do documento do mês anterior só com o que
 * aconteceu (sem IA e sem custo) e avisa a equipe. Gerar o PDF e mandar ao
 * cliente continuam com Confirmar. Uma agenda por cliente (e marca).
 *
 * Frente UXS: é configuração sem custo, então grava ao mudar (interruptor,
 * dia ou modelo), numa gravação só por rodada de mudanças (espera curta), com
 * um aviso "Salvo" de id fixo e Desfazer. Enquanto a agenda não chegou (ou
 * não abriu), os controles ficam travados: nada grava o padrão por cima de
 * uma agenda que existe.
 */

const DIAS = [1, 2, 3, 5, 7, 10, 15];
/** Espera depois da última mudança antes de gravar (junta interruptor, dia e modelo). */
const ESPERA_MS = 800;

type Agenda = { ligada: boolean; dia: number; modelo: ModeloDeDocumento };
const PADRAO: Agenda = { ligada: false, dia: 3, modelo: "mensal" };
const igual = (a: Agenda, b: Agenda) => a.ligada === b.ligada && a.dia === b.dia && a.modelo === b.modelo;

export default function AgendaDeDocumentos({ clientId, marcaId = null }: { clientId: string; marcaId?: string | null }) {
  const qc = useQueryClient();
  const chave = ["documentos-agenda", clientId];
  const consulta = useQuery({ queryKey: chave, queryFn: () => lerAgendas(clientId), enabled: !!clientId, staleTime: 60_000 });
  const atual = (consulta.data || []).find((a) => (a.marca_id || null) === (marcaId || null)) || null;
  const [valor, setValor] = useState<Agenda>(PADRAO);
  const [salvando, setSalvando] = useState(false);
  const ultimo = useRef<Agenda>(valor);
  ultimo.current = valor;
  // A rodada de mudanças em espera: o estado de antes (para o Desfazer) e o relógio.
  const rodada = useRef<{ antes: Agenda; relogio: number } | null>(null);
  const aviso = `documentos-agenda-${clientId}`;

  // O que está no servidor manda, menos no meio de uma rodada da pessoa. Sem agenda, o padrão.
  useEffect(() => {
    if (rodada.current) return;
    setValor(atual ? { ligada: atual.ligada, dia: atual.dia, modelo: atual.modelo } : PADRAO);
  }, [atual?.id, atual?.ligada, atual?.dia, atual?.modelo]); // eslint-disable-line react-hooks/exhaustive-deps

  const gravar = async (novo: Agenda, antes: Agenda, desfazendo = false): Promise<void> => {
    setSalvando(true);
    try {
      await salvarAgenda({ clientId, marcaId, ...novo });
      void qc.invalidateQueries({ queryKey: chave });
      // Um fato, um aviso: o mesmo id troca o aviso anterior em vez de empilhar.
      toast.success(desfazendo ? "Agenda voltou como estava." : novo.ligada ? `Salvo: todo dia ${novo.dia}, o rascunho do mês anterior fica pronto e a equipe é avisada.` : "Salvo: agenda desligada.", {
        id: aviso,
        action: desfazendo
          ? undefined
          : {
              label: "Desfazer",
              onClick: () => {
                setValor(antes);
                void gravar(antes, novo, true);
              },
            },
      });
    } catch (e) {
      // Não gravou: a tela volta ao que estava e o motivo aparece.
      setValor(antes);
      toast.error(textoDoErro(e, "Não foi possível salvar a agenda."), { id: aviso });
    } finally {
      setSalvando(false);
    }
  };

  const mudar = (parte: Partial<Agenda>) => {
    const antes = rodada.current ? rodada.current.antes : ultimo.current;
    if (rodada.current) window.clearTimeout(rodada.current.relogio);
    const novo = { ...ultimo.current, ...parte };
    ultimo.current = novo;
    setValor(novo);
    const relogio = window.setTimeout(() => {
      const r = rodada.current;
      rodada.current = null;
      if (r && !igual(ultimo.current, r.antes)) void gravar(ultimo.current, r.antes);
    }, ESPERA_MS);
    rodada.current = { antes, relogio };
  };

  // Recolher a seção ou sair da tela no meio da espera: grava na hora, nada se perde.
  useEffect(
    () => () => {
      const r = rodada.current;
      if (!r) return;
      window.clearTimeout(r.relogio);
      rodada.current = null;
      if (!igual(ultimo.current, r.antes)) void gravar(ultimo.current, r.antes);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const travado = consulta.isLoading || consulta.isError;
  const descricao = consulta.isLoading ? "Carregando" : consulta.isError ? "não abriu" : valor.ligada ? `todo dia ${valor.dia}${salvando ? " · salvando" : ""}` : salvando ? "salvando" : "desligado";

  return (
    <Secao
      titulo="Documento mensal automático"
      nivel={3}
      descricao={descricao}
      ajuda="No dia marcado, o painel monta o rascunho do documento do mês anterior só com o que aconteceu (sem IA e sem custo) e avisa a equipe. A equipe revisa, gera o PDF e manda ao cliente, sempre com Confirmar. Mudar aqui grava sozinho, com Desfazer no aviso."
      recolher={`documentos:agenda:${clientId}`}
      recolhidaDeInicio
      divisoria
    >
      {consulta.isError ? (
        <p className={juntar(texto.auxiliar, "text-destructive")}>{textoDoErro(consulta.error, "A agenda não abriu.")}</p>
      ) : (
        <div className="min-w-0 space-y-3">
          <label className="flex min-w-0 items-center text-[13px] text-foreground">
            <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={valor.ligada} disabled={travado} onChange={(e) => mudar({ ligada: e.target.checked })} />
            Montar o rascunho todo mês
          </label>
          <GrupoDeCampos colunas={2}>
            <CampoDeFormulario rotulo="Dia do mês">
              <select className={estiloDoCampo} value={valor.dia} onChange={(e) => mudar({ dia: Number(e.target.value) })} disabled={travado || !valor.ligada} aria-label="Dia do mês">
                {DIAS.map((d) => <option key={d} value={d}>Dia {d}</option>)}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Modelo">
              <select className={estiloDoCampo} value={valor.modelo} onChange={(e) => mudar({ modelo: e.target.value as ModeloDeDocumento })} disabled={travado || !valor.ligada} aria-label="Modelo do documento mensal">
                {MODELOS_DE_DOCUMENTO.map((m) => <option key={m} value={m}>{DEFINICOES_DE_DOCUMENTO[m].nome}</option>)}
              </select>
            </CampoDeFormulario>
          </GrupoDeCampos>
          {atual && (atual.ultimo_mes || atual.ultimo_erro) && (
            <p className={juntar(texto.auxiliar, atual.ultimo_erro && "text-amber-700 dark:text-amber-300")}>
              {atual.ultimo_mes ? `Último mês preparado: ${rotuloDoMesDeReferencia(atual.ultimo_mes)}.` : ""} {atual.ultimo_erro || ""}
            </p>
          )}
        </div>
      )}
    </Secao>
  );
}
