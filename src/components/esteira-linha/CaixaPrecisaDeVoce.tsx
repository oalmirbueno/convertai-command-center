import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import { botao, etiqueta, foco, juntar, texto } from "@/components/sistema";
import { ROTULO_DO_TIPO, type PedidoDoDono } from "@/lib/esteiraLinha/precisaDeVoce";
import {
  armazenamentoDoAparelho, contadorDoPrecisaDeVoce, gravarAvisos, lerAvisosGuardados,
} from "@/lib/esteiraLinha/preferenciasDaEsteira";

/**
 * Teto da lista aberta: passou disso, rola por dentro da caixa (pedido do
 * Almir, 14/11/2026, 21h55), e a grade continua à vista embaixo.
 */
export const CLASSES_DA_LISTA_DO_AVISO = "max-h-[200px] overflow-y-auto overscroll-contain sm:max-h-[260px]";

/** Aberta ou recolhida, lembrado neste aparelho. O padrão é recolhida. */
function useAvisoAberto() {
  const [aberta, setAberta] = useState(() => lerAvisosGuardados(armazenamentoDoAparelho()).precisaDeVoce);
  const alternar = () => {
    setAberta((atual) => {
      const nova = !atual;
      gravarAvisos(armazenamentoDoAparelho(), { v: 1, precisaDeVoce: nova });
      return nova;
    });
  };
  return [aberta, alternar] as const;
}

/**
 * "Precisa de você", no topo da Esteira: só o que a equipe não decide sozinha
 * (dinheiro e verba, cliente novo ou plano, decisão pedida por agente e peça
 * que o cliente rejeitou mais de uma vez). Cada item leva ao lugar onde se
 * resolve; a caixa não decide nada.
 *
 * Recolhida (14/11/2026, 21h53): nasce fechada, só com o contador ("3 itens
 * precisam de você"), e abre no clique. Sem pedido, não ocupa espaço; só a
 * leitura incompleta deixa uma linha discreta.
 */
export default function CaixaPrecisaDeVoce({ pedidos, carregando, incompleta }: { pedidos: PedidoDoDono[]; carregando: boolean; incompleta: boolean }) {
  const [aberta, alternar] = useAvisoAberto();
  if (carregando) return null;

  if (pedidos.length === 0) {
    if (!incompleta) return null;
    return (
      <p className={juntar(texto.auxiliar, "shrink-0")} data-precisa-de-voce="vazia" role="status">
        Precisa de você: parte da lista não pôde ser lida agora.
      </p>
    );
  }

  return (
    <section
      aria-labelledby="precisa-de-voce-titulo"
      className="ds-ink shrink-0 rounded-lg"
      data-precisa-de-voce={pedidos.length}
      data-aviso-recolhido={aberta ? undefined : "sim"}
    >
      <h2 id="precisa-de-voce-titulo" className="text-[13px] font-medium leading-5 text-foreground">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberta}
          aria-controls="precisa-de-voce-lista"
          className={juntar("toque-compacto flex min-h-[52px] w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left sm:px-5", foco)}
          data-alternar-aviso=""
        >
          <span className="inline-flex h-8 min-w-[32px] shrink-0 items-center justify-center rounded-full bg-accent-solid px-2 text-[13px] font-semibold tabular-nums text-on-accent" aria-hidden="true">{pedidos.length}</span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">
            <span className="sr-only">Precisa de você: </span>
            {contadorDoPrecisaDeVoce(pedidos.length)}
            {incompleta && <span className={juntar(texto.auxiliar, "ml-2 font-normal")}>(parte da lista não pôde ser lida)</span>}
          </span>
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"><ChevronDown className={juntar("h-4 w-4 transition-transform duration-200", aberta && "rotate-180")} aria-hidden="true" /></span>
        </button>
      </h2>
      {aberta && (
        <ul
          id="precisa-de-voce-lista"
          className={juntar("mx-2 mb-2 divide-y divide-border rounded-md bg-muted", CLASSES_DA_LISTA_DO_AVISO)}
          data-rolagem-do-aviso=""
        >
          {pedidos.map((p) => (
            <li key={p.chave} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5" data-pedido-do-dono={p.chave} data-tipo={p.tipo}>
              <div className="min-w-0 flex-1 basis-64">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className={juntar(etiqueta, "bg-foreground/10 text-foreground")}>{ROTULO_DO_TIPO[p.tipo]}</span>
                  {p.cliente && <span className="text-[12px] font-medium text-foreground">{p.cliente}</span>}
                </p>
                <p className="mt-1 break-words text-[13px] font-medium leading-5 text-foreground">{p.oQue}</p>
                {p.porQue && <p className={juntar(texto.auxiliar, "mt-0.5 break-words")}>{p.porQue}</p>}
              </div>
              <Link to={p.link} className={juntar(botao.primario, "h-8 shrink-0")} aria-label={`Resolver em ${p.onde}: ${p.oQue}`}>
                {p.onde}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
