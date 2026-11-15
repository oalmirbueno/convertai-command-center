import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { botao, etiqueta, juntar, texto } from "@/components/sistema";
import { ROTULO_DO_TIPO, type PedidoDoDono } from "@/lib/esteiraLinha/precisaDeVoce";

/** Quantos pedidos ficam à vista antes do "Ver todos": a caixa não pode empurrar a grade para fora da tela. */
const A_VISTA = 4;

/**
 * "Precisa de você", no topo da Esteira: só o que a equipe não decide sozinha
 * (dinheiro e verba, cliente novo ou plano, decisão pedida por agente e peça
 * que o cliente rejeitou mais de uma vez). Cada item leva ao lugar onde se
 * resolve; a caixa não decide nada. Sem pedido, vira uma linha discreta.
 */
export default function CaixaPrecisaDeVoce({ pedidos, carregando, incompleta }: { pedidos: PedidoDoDono[]; carregando: boolean; incompleta: boolean }) {
  const [aberta, setAberta] = useState(false);
  if (carregando) return null;

  if (pedidos.length === 0) {
    return (
      <p className={juntar(texto.auxiliar)} data-precisa-de-voce="vazia" role="status">
        {incompleta ? "Precisa de você: parte da lista não pôde ser lida agora." : "Nada esperando você."}
      </p>
    );
  }

  const visiveis = aberta ? pedidos : pedidos.slice(0, A_VISTA);
  const escondidos = pedidos.length - visiveis.length;
  return (
    <section aria-labelledby="precisa-de-voce-titulo" className="rounded-md border border-warning/40 bg-warning/5 p-3" data-precisa-de-voce={pedidos.length}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="precisa-de-voce-titulo" className="text-[14px] font-medium leading-5 text-foreground">
          Precisa de você
          <span className={juntar(etiqueta, "ml-2 bg-warning/15 text-warning")}>{pedidos.length}</span>
        </h2>
        <p className={texto.auxiliar}>
          Só o que depende da sua decisão.{incompleta && " Parte da lista não pôde ser lida agora."}
        </p>
      </div>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-background">
        {visiveis.map((p) => (
          <li key={p.chave} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-3 py-2" data-pedido-do-dono={p.chave} data-tipo={p.tipo}>
            <div className="min-w-0 flex-1 basis-64">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{ROTULO_DO_TIPO[p.tipo]}</span>
                {p.cliente && <span className="text-[12px] font-medium text-foreground">{p.cliente}</span>}
              </p>
              <p className="mt-1 break-words text-[13px] font-medium leading-5 text-foreground">{p.oQue}</p>
              {p.porQue && <p className={juntar(texto.auxiliar, "mt-0.5 break-words")}>{p.porQue}</p>}
            </div>
            <Link to={p.link} className={juntar(botao.secundario, "h-8 shrink-0")} aria-label={`Resolver em ${p.onde}: ${p.oQue}`}>
              {p.onde}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      {(escondidos > 0 || aberta) && pedidos.length > A_VISTA && (
        <button type="button" className={juntar(botao.discreto, "mt-2 h-8")} onClick={() => setAberta((a) => !a)} aria-expanded={aberta}>
          {aberta ? "Mostrar menos" : `Ver todos (mais ${escondidos})`}
        </button>
      )}
    </section>
  );
}
