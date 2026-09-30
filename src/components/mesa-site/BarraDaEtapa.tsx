import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useAvisarErro } from "@/components/mesa/Custo";
import BarraDeAcoes from "@/components/sistema/BarraDeAcoes";
import { RotuloLargo } from "@/components/sistema/BotaoComIcone";
import { botao } from "@/components/sistema/estilos";
import { ETAPAS_DO_SITE } from "../../../supabase/functions/_shared/site-metodo";

/**
 * Barra de ações da etapa (UXS 30/09): o próximo passo mora sempre no mesmo
 * lugar, no pé da região da etapa, e nunca some por recolher uma seção.
 * À esquerda o estado da etapa (ou o motivo do Seguir desligado); à direita
 * "Voltar" discreto, o "Salvar" da etapa (quando ela tem) e "Seguir: <próxima>".
 *
 * Leve: o estado da barra fica aqui, não no MesaSite (nada redesenha a casca,
 * as Etapas nem o diretor a cada tecla), e a etapa entra como `children`, que
 * não redesenha quando a barra muda. As funções (salvar antes de seguir,
 * salvar sem sair) vão por ref.
 */

export type EstadoDaBarra = {
  /** Uma linha curta à esquerda (estado da etapa). */
  estado?: string | null;
  /** Por que o Seguir está desligado (vai no lugar do estado). Sem motivo, o Seguir fica liberado. */
  motivo?: string | null;
  /** Gravando: desliga o Seguir e o Salvar. */
  ocupado?: boolean;
  /** Há uma ação principal pendente na etapa: o Seguir fica secundário (um primário por área). */
  pendente?: boolean;
  /** A etapa tem o "Salvar" (grava sem trocar de etapa). */
  salvar?: boolean;
  /** Nada a salvar: o Salvar fica desligado. */
  nadaASalvar?: boolean;
};

export type AcoesDaBarra = {
  /** Grava o pendente antes de seguir. false (ou erro) = fica na etapa. */
  antesDeSeguir?: () => Promise<boolean> | boolean;
  /** O Salvar da etapa. */
  aoSalvar?: () => Promise<unknown> | void;
};

type Registro = { mudar: (e: EstadoDaBarra) => void; acoes: MutableRefObject<AcoesDaBarra> };
const ContextoDaBarra = createContext<Registro | null>(null);

/**
 * A etapa diz o estado dela e, se precisar, o que fazer antes de seguir e o
 * Salvar. Fora da barra (teste de uma peça solta), não faz nada.
 */
export function useBarraDaEtapa(estado: EstadoDaBarra, acoes: AcoesDaBarra = {}): void {
  const registro = useContext(ContextoDaBarra);
  // As funções mudam a cada desenho: vão por ref (sem laço de efeito).
  useLayoutEffect(() => {
    if (registro) registro.acoes.current = acoes;
  });
  const { estado: linha, motivo, ocupado, pendente, salvar, nadaASalvar } = estado;
  useEffect(() => {
    if (registro) registro.mudar({ estado: linha || null, motivo: motivo || null, ocupado: !!ocupado, pendente: !!pendente, salvar: !!salvar, nadaASalvar: !!nadaASalvar });
  }, [registro, linha, motivo, ocupado, pendente, salvar, nadaASalvar]);
  useEffect(
    () => () => {
      if (!registro) return;
      registro.mudar({});
      registro.acoes.current = {};
    },
    [registro],
  );
}

export default function EtapaComBarra({ etapa, onIrPara, children }: { etapa: string; onIrPara: (etapa: string) => void; children: ReactNode }) {
  const avisarErro = useAvisarErro();
  const [estado, setEstado] = useState<EstadoDaBarra>({});
  const [indo, setIndo] = useState<"seguir" | "salvar" | null>(null);
  const acoes = useRef<AcoesDaBarra>({});
  const registro = useMemo<Registro>(() => ({ mudar: setEstado, acoes }), []);
  const i = ETAPAS_DO_SITE.findIndex((e) => e.valor === etapa);
  const anterior = i > 0 ? ETAPAS_DO_SITE[i - 1] : null;
  const proxima = i >= 0 && i < ETAPAS_DO_SITE.length - 1 ? ETAPAS_DO_SITE[i + 1] : null;
  const ocupado = !!estado.ocupado || !!indo;

  const seguir = async () => {
    if (!proxima || ocupado || estado.motivo) return;
    setIndo("seguir");
    try {
      const antes = acoes.current.antesDeSeguir;
      const ok = antes ? await antes() : true;
      if (ok !== false) onIrPara(proxima.valor);
    } catch (e) {
      avisarErro(e, "Não foi possível seguir");
    } finally {
      setIndo(null);
    }
  };

  const salvar = async () => {
    const f = acoes.current.aoSalvar;
    if (!f || ocupado) return;
    setIndo("salvar");
    try {
      await f();
    } catch (e) {
      avisarErro(e, "Não foi possível salvar");
    } finally {
      setIndo(null);
    }
  };

  const linha = estado.motivo || estado.estado;
  return (
    <ContextoDaBarra.Provider value={registro}>
      {children}
      <BarraDeAcoes className="shrink-0 border-t border-border pt-3" inicio={linha ? <span className="block truncate" data-estado-da-etapa="">{linha}</span> : null}>
        {anterior && (
          <button type="button" className={botao.discreto} onClick={() => onIrPara(anterior.valor)} aria-label={`Voltar: ${anterior.rotulo}`} title={`Voltar: ${anterior.rotulo}`} data-voltar-etapa={anterior.valor}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <RotuloLargo>Voltar</RotuloLargo>
          </button>
        )}
        {estado.salvar && (
          <button type="button" className={botao.secundario} disabled={ocupado || !!estado.nadaASalvar} onClick={() => void salvar()} data-salvar-etapa="">
            {indo === "salvar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Salvar
          </button>
        )}
        {proxima && (
          <button
            type="button"
            className={estado.pendente ? botao.secundario : botao.primario}
            disabled={ocupado || !!estado.motivo}
            onClick={() => void seguir()}
            aria-label={`Seguir: ${proxima.rotulo}`}
            title={estado.motivo || undefined}
            data-seguir-etapa={proxima.valor}
          >
            {indo === "seguir" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Seguir
            <RotuloLargo className="ml-0">: {proxima.rotulo}</RotuloLargo>
            <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </BarraDeAcoes>
    </ContextoDaBarra.Provider>
  );
}
