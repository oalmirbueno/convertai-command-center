import { Link } from "react-router-dom";
import { BriefcaseBusiness, CalendarRange, Camera, Clapperboard, Film, Globe, Megaphone, Package, Palette, Scissors, ScrollText, type LucideIcon } from "lucide-react";
import { propsDePreCarga } from "@/lib/mesa/preCarga";

/**
 * Lista das mesas (MESAS) e o endereço de cada uma (enderecoDaMesa): quem
 * mostra a troca de mesas hoje é o SeletorDeMesa da casca padrão
 * (src/components/sistema/SeletorDeMesa.tsx, 26/09). Mesa nova entra em MESAS
 * e aparece lá sozinha. O componente abaixo (a fileira antiga) ficou sem uso.
 *
 * Troca rápida entre as três mesas do mesmo cliente: Mesa (orgânico),
 * Mesa Ads (tráfego pago), Mesa Foto (estúdio fotográfico) e Mesa Vídeos. A mesa aberta
 * aparece marcada e sem link. Some no celular, onde a barra é curta.
 * Mouse em cima (ou foco) já baixa a outra mesa: o clique abre na hora.
 */

export type QualMesa = "mesa" | "ads" | "foto" | "videos" | "publicidade" | "roteiros" | "edicao" | "identidade" | "proposta" | "site" | "motion";

export interface MesaDoSeletor {
  valor: QualMesa;
  /** Nome na lista do seletor. */
  rotulo: string;
  /** Nome curto no botão do seletor (quando diferente do rótulo). */
  curto?: string;
  titulo: string;
  caminho: string;
  /** Uma linha do que a mesa faz (lista do seletor). */
  descricao?: string;
  /** Ícone da mesa (lucide). */
  icone?: LucideIcon;
}

/**
 * LISTA ÚNICA DAS MESAS. Mesa nova = uma linha aqui (e a rota em App.tsx, a
 * pré-carga em src/lib/mesa/preCarga.ts e os clientes em clientesDaMesa.ts).
 * O seletor de mesa, o atalho de número e a pré-carga ao passar o mouse vêm
 * daqui. A Mesa Edição (/mesa-edicao, frente E2) entrou logo depois da Mesa
 * Vídeos: gerar com IA de um lado, subir, organizar e editar do outro.
 */
export const MESAS: MesaDoSeletor[] = [
  { valor: "mesa", rotulo: "Mesa", titulo: "Abrir a Mesa do cliente (conteúdo orgânico)", caminho: "/mesa", descricao: "Conteúdo orgânico: contexto, mês, campanhas e estúdio", icone: CalendarRange },
  { valor: "ads", rotulo: "Mesa Ads", titulo: "Abrir a Mesa Ads (criativos de anúncio)", caminho: "/mesa-ads", descricao: "Criativos de anúncio e a conta ao vivo", icone: Megaphone },
  { valor: "foto", rotulo: "Mesa Foto", titulo: "Abrir a Mesa Foto (estúdio fotográfico)", caminho: "/mesa-foto", descricao: "Estúdio fotográfico do produto", icone: Camera },
  { valor: "videos", rotulo: "Mesa Vídeos", titulo: "Abrir a Mesa Vídeos (gerar cenas e vídeos com IA)", caminho: "/mesa-videos", descricao: "Gerar cenas e vídeos com modelos de IA", icone: Clapperboard },
  { valor: "edicao", rotulo: "Edição", titulo: "Abrir a Mesa Edição (vídeos de fora, organizar e editar)", caminho: "/mesa-edicao", descricao: "Subir vídeos de fora, organizar e editar", icone: Scissors },
  { valor: "publicidade", rotulo: "Publicidade", titulo: "Abrir a Mesa Publicidade (campanhas de produto)", caminho: "/mesa-publicidade", descricao: "Campanhas de produto com direção de arte", icone: Package },
  { valor: "roteiros", rotulo: "Roteiros", titulo: "Abrir a Mesa Roteiros (roteiros de vídeo para gravar)", caminho: "/mesa-roteiros", descricao: "Roteiros de vídeo para gravar", icone: ScrollText },
  { valor: "identidade", rotulo: "Identidade", titulo: "Abrir a Mesa Identidade (identidade visual, naming e brandbook)", caminho: "/mesa-identidade", descricao: "Identidade visual, naming e brandbook", icone: Palette },
  // Frente PRO (30/09): proposta comercial do cliente (só admin e gestor abrem a rota).
  { valor: "proposta", rotulo: "Proposta", titulo: "Abrir a Mesa Proposta (proposta comercial com link e aceite)", caminho: "/mesa-proposta", descricao: "Proposta comercial com link e aceite", icone: BriefcaseBusiness },
  // Frente SIT (30/09): criador de sites com o motor de código.
  { valor: "site", rotulo: "Site", titulo: "Abrir a Mesa Site (site do cliente com prévia e domínio)", caminho: "/mesa-site", descricao: "Site do cliente com prévia ao vivo e domínio", icone: Globe },
  { valor: "motion", rotulo: "Motion", titulo: "Abrir a Mesa Motion (apresentação em motion e filme da marca)", caminho: "/mesa-motion", descricao: "Apresentação em motion e filme cinematográfico da marca", icone: Film },
];

/** Endereço da mesa do cliente; com marca (cliente com Acerbi e CME), a marca vai junto. */
export const enderecoDaMesa = (mesa: QualMesa, clientId: string, marcaId?: string | null) => {
  const m = MESAS.find((x) => x.valor === mesa) || MESAS[0];
  if (!clientId) return m.caminho;
  return marcaId ? `${m.caminho}?client=${clientId}&marca=${marcaId}` : `${m.caminho}?client=${clientId}`;
};

export default function TrocaDeMesas({
  atual,
  clientId,
  marcaId = null,
  className = "",
}: {
  atual: QualMesa;
  clientId: string;
  marcaId?: string | null;
  className?: string;
}) {
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
              to={enderecoDaMesa(m.valor, clientId, marcaId)}
              {...propsDePreCarga(enderecoDaMesa(m.valor, clientId, marcaId))}
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
