import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useConfirm } from "@/components/shared/confirmDialog";
import BarraDeAcoes from "@/components/sistema/BarraDeAcoes";
import { apagarEstadoDaTela, lerEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { ErroDaMesa } from "@/lib/mesa/api";
import { ROTULO_DO_STATUS } from "../../../supabase/functions/_shared/proposta-modelo";
import { tiraOLink } from "../../../supabase/functions/_shared/proposta-comercial";
import { aplicarNaLista, chamarProposta, relerTudo, type Proposta } from "./propostaApi";
import { useConfirmarTirarOLink, useIrParaEtapa } from "./navegacaoDaProposta";

/**
 * Edição da Mesa Proposta sem perder texto (frente UXS, 30/09).
 *
 * Antes, cada seção tinha o próprio Salvar e toda gravação subia a versão; as
 * outras seções se zeravam quando a versão mudava (notas sumiam depois de
 * salvar o Pagamento). Agora:
 *
 * - Cada seção compara com a BASE da edição (a foto de quando carregou ou foi
 *   salva por último), não com a proposta atual. Versão nova (agente, anexo,
 *   outra pessoa) só atualiza a seção limpa; a suja fica com o que a pessoa
 *   digitou.
 * - Um Salvar só, na barra fixa do pé da etapa ("Não salvo: Reunião,
 *   Investimento"), que manda num pedido só os campos das seções sujas (nunca
 *   um campo sem mudança). Salvar só as notas não tira a proposta do status
 *   enviada. Se o pedido tira o link do cliente, a barra avisa e o Confirmar
 *   pergunta antes. Descartar pergunta antes (apaga texto digitado).
 * - Notas, transcrição e o rascunho dos blocos ficam no navegador pela
 *   proposta (sem a versão na chave), com a assinatura do valor do banco na
 *   base. A linha "A proposta mudou" só aparece quando aquele campo mudou no
 *   banco, não a cada versão nova.
 */

// ------------------------------------------------------------------ rascunho com base

/** Assinatura curta de um valor (tamanho + hash djb2): guarda a base sem dobrar o que vai no navegador. */
export function assinatura(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v === undefined ? null : v) || "";
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

type Guardado<T> = { base: number; banco: string; valor: T };

/**
 * Um campo (ou um conjunto) editado no navegador contra a base.
 * - `valor`: o que a tela mostra (o digitado, ou o do banco quando não há edição).
 * - `sujo`: difere da base.
 * - `conflito`: sujo e o banco mudou desde a base (mostra "A proposta mudou").
 * - `manter`: a base vira o banco de agora (fica a edição); `esquecer`: fica o do banco.
 * `chaveAntiga` (com a versão) é lida uma vez, para não perder rascunho de antes.
 */
export function useRascunhoComBase<T>({
  chave,
  chaveAntiga,
  doBanco,
  versao,
  valido,
  canonico,
}: {
  chave: string;
  chaveAntiga?: string | null;
  doBanco: T;
  versao: number;
  valido: (v: unknown) => boolean;
  /** Forma comparável do valor (ex.: o conteúdo normalizado). */
  canonico?: (v: T) => unknown;
}) {
  const [guardado, setGuardado, esquecer] = useEstadoDaTela<Guardado<T> | null>(chave, null, {
    esperaMs: 300,
    validar: (v) => v === null || (!!v && typeof v === "object" && typeof (v as Guardado<T>).banco === "string" && valido((v as Guardado<T>).valor)),
  });
  const assinar = useCallback((v: T) => assinatura(canonico ? canonico(v) : v), [canonico]);
  const doBancoAssinado = useMemo(() => assinar(doBanco), [assinar, doBanco]);
  const guardadoAssinado = useMemo(() => (guardado ? assinar(guardado.valor) : null), [assinar, guardado]);

  // Uma vez: o rascunho da chave antiga (que tinha a versão dentro) passa para a nova.
  const migrou = useRef(false);
  useEffect(() => {
    if (migrou.current || !chaveAntiga) return;
    migrou.current = true;
    const antigo = lerEstadoDaTela<unknown>(chaveAntiga, null);
    apagarEstadoDaTela(chaveAntiga);
    if (antigo === null || guardado || !valido(antigo)) return;
    if (assinar(antigo as T) !== doBancoAssinado) setGuardado({ base: versao, banco: doBancoAssinado, valor: antigo as T });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sujo = !!guardado && guardadoAssinado !== guardado.banco;
  const conflito = sujo && !!guardado && guardado.banco !== doBancoAssinado;
  // Edição que voltou a ser igual à base não segura a tela: a seção limpa segue o banco.
  const mudar = (novo: T) =>
    setGuardado((g) => {
      const limpo = !g || assinar(g.valor) === g.banco;
      return { base: limpo || !g ? versao : g.base, banco: limpo || !g ? doBancoAssinado : g.banco, valor: novo };
    });
  const manter = () => setGuardado((g) => (g ? { base: versao, banco: doBancoAssinado, valor: g.valor } : g));
  return { valor: guardado && sujo ? guardado.valor : doBanco, sujo, conflito, mudar, manter, esquecer };
}

/** "A proposta mudou: manter a minha edição | ver a nova" (sem caixa, uma linha). */
export function AvisoDeMudanca({ onManter, onVerANova, className = "" }: { onManter: () => void; onVerANova: () => void; className?: string }) {
  return (
    <div className={juntar("flex min-w-0 flex-wrap items-center text-warning", texto.auxiliar, className)} role="status" data-aviso-de-mudanca="">
      <span className="mr-1">A proposta mudou:</span>
      <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px] text-foreground")} onClick={onManter}>
        manter a minha edição
      </button>
      <span aria-hidden="true" className="mx-0.5 text-muted-foreground">
        |
      </span>
      <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px] text-foreground")} onClick={onVerANova}>
        ver a nova
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ salvar único

/** Uma seção com alteração não salva, como a barra enxerga. */
export interface SecaoSuja {
  rotulo: string;
  /** Campos que o salvar vai levar (para o aviso do link). */
  chaves: string[];
  /** Só os campos que mudaram desde a base. */
  campos: () => Record<string, unknown>;
  /** Confere antes de salvar (marca o que falta e diz onde). false = não salva nada. */
  validar?: () => boolean;
  /** Depois do salvar: a base vira a resposta do servidor. */
  depois: (p: Proposta) => void;
  /** Volta ao que está no banco (e esquece o que ficou no navegador). */
  descartar: () => void;
  /** A proposta mudou e a pessoa fica com a edição: a base vira a atual. */
  manter?: () => void;
}

type Informar = (id: string, s: SecaoSuja | null) => void;
const ContextoDoSalvar = createContext<Informar | null>(null);
export const ProvedorDoSalvar = ContextoDoSalvar.Provider;

/** As seções sujas de uma etapa, na ordem pedida. */
export function useSecoesSujas(ordem: string[]): { sujas: SecaoSuja[]; informar: Informar } {
  const [mapa, setMapa] = useState<Record<string, SecaoSuja>>({});
  const informar = useCallback<Informar>((id, s) => {
    setMapa((antes) => {
      if (!s) {
        if (!antes[id]) return antes;
        const proximo = { ...antes };
        delete proximo[id];
        return proximo;
      }
      return { ...antes, [id]: s };
    });
  }, []);
  const chaveDaOrdem = ordem.join(",");
  const sujas = useMemo(() => {
    const ids = chaveDaOrdem.split(",");
    return Object.keys(mapa)
      .sort((a, b) => (ids.indexOf(a) < 0 ? 99 : ids.indexOf(a)) - (ids.indexOf(b) < 0 ? 99 : ids.indexOf(b)))
      .map((k) => mapa[k]);
  }, [mapa, chaveDaOrdem]);
  return { sujas, informar };
}

/** A seção avisa a barra quando fica suja (e quando os campos que mudaram trocam). */
export function useSecaoSuja(id: string, sujo: boolean, dados: SecaoSuja) {
  const informar = useContext(ContextoDoSalvar);
  const atual = useRef(dados);
  atual.current = dados;
  const chaves = sujo ? dados.chaves.slice().sort().join(",") : "";
  const rotulo = dados.rotulo;
  useEffect(() => {
    if (!informar) return;
    informar(
      id,
      sujo
        ? {
            rotulo,
            chaves: chaves ? chaves.split(",") : [],
            campos: () => atual.current.campos(),
            validar: () => (atual.current.validar ? atual.current.validar() : true),
            depois: (p) => atual.current.depois(p),
            descartar: () => atual.current.descartar(),
            manter: () => {
              if (atual.current.manter) atual.current.manter();
            },
          }
        : null,
    );
  }, [informar, id, sujo, chaves, rotulo]);
  useEffect(
    () => () => {
      if (informar) informar(id, null);
    },
    [informar, id],
  );
}

/**
 * Barra fixa no pé da etapa: o que não foi salvo, o aviso do link, Descartar
 * e o único Salvar. Some quando não há nada para salvar.
 */
export function BarraDoSalvar({ proposta, sujas, rotuloDoToast }: { proposta: Proposta; sujas: SecaoSuja[]; rotuloDoToast?: string }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const confirmar = useConfirm();
  const confirmarTirar = useConfirmarTirarOLink();
  const irPara = useIrParaEtapa();
  const [salvando, setSalvando] = useState(false);
  const [conflito, setConflito] = useState(false);
  if (!sujas.length && !conflito && !salvando) return null;

  const aceita = proposta.status === "aceita";
  const chaves = sujas.reduce<string[]>((l, s) => l.concat(s.chaves), []);
  const tiraOLinkAgora = tiraOLink(proposta.status, chaves);
  const rotulos = sujas.map((s) => s.rotulo);

  const salvar = async () => {
    for (const s of sujas) if (s.validar && !s.validar()) return;
    const pedido: Record<string, unknown> = {};
    for (const s of sujas) Object.assign(pedido, s.campos());
    const campos = Object.keys(pedido);
    if (!(await confirmarTirar(proposta.status, campos, "Salvar"))) return;
    const tirou = tiraOLink(proposta.status, campos);
    setSalvando(true);
    try {
      let p: Proposta = proposta;
      if (campos.length) {
        const d = await chamarProposta<{ proposta?: unknown }>("salvar", { proposta_id: proposta.id, versao_base: proposta.versao, ...pedido });
        p = aplicarNaLista(qc, mesa.clientId, d && d.proposta) || proposta;
      }
      for (const s of sujas) s.depois(p);
      setConflito(false);
      const feito = `${rotuloDoToast || rotulos.join(", ")}: salvo.`;
      if (tirou) toast.success(feito, { description: "A proposta voltou para rascunho. Envie de novo para o cliente ver.", action: { label: "Ir para o Envio", onClick: () => irPara("envio") } });
      else toast.success(feito);
    } catch (e) {
      // Outra pessoa (ou o agente) gravou no meio: a edição fica na tela e a barra pergunta.
      if (e instanceof ErroDaMesa && e.codigo === "versao_mudou") {
        setConflito(true);
        relerTudo(qc, mesa.clientId, proposta.id);
      } else avisarErro(e, "Não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  const descartar = async () => {
    const ok = await confirmar({ title: "Descartar o que não foi salvo?", description: `${rotulos.join(", ")}: o que foi digitado some.`, confirmLabel: "Descartar", destructive: true });
    if (!ok) return;
    for (const s of sujas) s.descartar();
    setConflito(false);
  };

  return (
    <BarraDeAcoes
      fixa
      inicio={
        <span className="flex min-w-0 flex-wrap items-center" data-barra-do-salvar="">
          {rotulos.length > 0 && <span className="mr-2 min-w-0 truncate">Não salvo: {rotulos.join(", ")}</span>}
          {aceita ? (
            <span className="text-warning">Aceita · não muda mais</span>
          ) : tiraOLinkAgora ? (
            <span className="text-warning">{ROTULO_DO_STATUS[proposta.status] || "Enviada"} · salvar tira o link</span>
          ) : null}
          {conflito && (
            <AvisoDeMudanca
              className="w-full"
              onManter={() => {
                for (const s of sujas) if (s.manter) s.manter();
                setConflito(false);
              }}
              onVerANova={() => {
                for (const s of sujas) s.descartar();
                setConflito(false);
              }}
            />
          )}
        </span>
      }
    >
      {sujas.length > 0 && (
        <button type="button" className={botao.discreto} onClick={() => void descartar()} disabled={salvando}>
          Descartar
        </button>
      )}
      <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || aceita || !sujas.length}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
    </BarraDeAcoes>
  );
}
