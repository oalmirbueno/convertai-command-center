import { Link } from "react-router-dom";

/**
 * Troca rápida entre as três mesas do mesmo cliente: Mesa (orgânico),
 * Mesa Ads (tráfego pago) e Mesa Foto (estúdio fotográfico). A mesa aberta
 * aparece marcada e sem link. Some no celular, onde a barra é curta.
 */

export type QualMesa = "mesa" | "ads" | "foto";

export const MESAS: { valor: QualMesa; rotulo: string; titulo: string; caminho: string }[] = [
  { valor: "mesa", rotulo: "Mesa", titulo: "Abrir a Mesa do cliente (conteúdo orgânico)", caminho: "/mesa" },
  { valor: "ads", rotulo: "Mesa Ads", titulo: "Abrir a Mesa Ads (criativos de anúncio)", caminho: "/mesa-ads" },
  { valor: "foto", rotulo: "Mesa Foto", titulo: "Abrir a Mesa Foto (estúdio fotográfico)", caminho: "/mesa-foto" },
];

export const enderecoDaMesa = (mesa: QualMesa, clientId: string) => {
  const m = MESAS.find((x) => x.valor === mesa) || MESAS[0];
  return clientId ? `${m.caminho}?client=${clientId}` : m.caminho;
};

export default function TrocaDeMesas({ atual, clientId, className = "" }: { atual: QualMesa; clientId: string; className?: string }) {
  return (
    <nav aria-label="Trocar de mesa" className={`mr-1 hidden shrink-0 items-center xl:flex ${className}`}>
      {MESAS.map((m, i) => (
        <span key={m.valor} className="flex items-center">
          {i > 0 && (
            <span aria-hidden="true" className="px-0.5 text-[11px] text-muted-foreground/60">
              ·
            </span>
          )}
          {m.valor === atual ? (
            <span aria-current="page" className="inline-flex h-8 items-center rounded-lg px-1.5 text-[12px] font-medium text-foreground">
              {m.rotulo}
            </span>
          ) : (
            <Link
              to={enderecoDaMesa(m.valor, clientId)}
              title={m.titulo}
              className="inline-flex h-8 items-center rounded-lg px-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {m.rotulo}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
