import { Link, useInRouterContext } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { pedacosComLinks, type DestinoDoAgente } from "@/lib/agentes/mapaDoPainel";
import { clienteDaRota } from "@/lib/lancador";

/** O cliente do endereço atual (?client= ou /clientes/<id>), sem depender do roteador. */
function clienteDoEndereco(): string | null {
  if (typeof window === "undefined" || !window.location) return null;
  return clienteDaRota(window.location.pathname, window.location.search);
}

/**
 * Texto do agente com as rotas do mapa do painel viradas em link (com o
 * cliente da tela). O agente responde "Isso é na Mesa Ads (/mesa-ads). Abro
 * para você?" e a pessoa clica. Rota fora do mapa fica como texto. Sem
 * `clientId`, vale o cliente do endereço (?client=), como no lançador. Fora
 * do roteador (testes, prévias), o link vira âncora comum.
 */
export default function TextoDoAgente({ texto, clientId, className = "" }: { texto: string; clientId?: string | null; className?: string }) {
  const noRoteador = useInRouterContext();
  const cliente = clientId !== undefined ? clientId : clienteDoEndereco();
  const pedacos = pedacosComLinks(texto, cliente);
  const classeDoLink = "font-medium text-primary underline-offset-2 hover:underline";
  return (
    <p className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${className}`}>
      {pedacos.map((p, i) =>
        p.tipo === "link" ? (
          noRoteador ? (
            <Link key={i} to={p.link} className={classeDoLink} title={`Abrir ${p.nome}`}>
              {p.nome}
            </Link>
          ) : (
            <a key={i} href={p.link} className={classeDoLink} title={`Abrir ${p.nome}`}>
              {p.nome}
            </a>
          )
        ) : (
          <span key={i}>{p.texto}</span>
        ),
      )}
    </p>
  );
}

/** Botão curto "Abrir <área>" para o destino que o agente devolveu. */
export function BotaoDaArea({ destino, onAbrir, className = "" }: { destino: DestinoDoAgente; onAbrir: (link: string) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onAbrir(destino.link)}
      data-abrir-area={destino.area}
      className={`inline-flex max-w-full items-center rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10 ${className}`}
    >
      <span className="truncate">Abrir {destino.nome}</span>
      <ArrowUpRight className="ml-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </button>
  );
}
