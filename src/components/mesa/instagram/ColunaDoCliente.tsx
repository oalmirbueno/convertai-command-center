import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, FolderOpen, Files, Building2 } from "lucide-react";
import { juntar, superficie, texto } from "@/components/sistema/estilos";
import { dataEHoraCurta } from "../PublicacaoDaPeca";
import type { ItemDaGradeNaAba, PainelDoInstagram } from "./instagramApi";

/**
 * Coluna compacta ao lado dos blocos: mini resumo da empresa (do contexto do
 * cliente), mini agenda (os próximos posts com data) e o acesso às pastas e
 * aos arquivos do cliente. Tudo leitura; cada link abre a área certa com o
 * cliente.
 */

function Caixa({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <section className={juntar(superficie.painel, "min-w-0 px-3 py-2.5")}>
      <p className="flex items-center text-[12.5px] font-semibold text-foreground">
        <span className="mr-1.5 text-muted-foreground" aria-hidden="true">
          {icone}
        </span>
        {titulo}
      </p>
      <div className="mt-1.5 min-w-0">{children}</div>
    </section>
  );
}

export function proximosPosts(itens: ItemDaGradeNaAba[], agora = new Date(), quantos = 6): ItemDaGradeNaAba[] {
  const hoje = agora.toISOString();
  return itens
    .filter((i) => !!i.data && (i.data as string) >= hoje)
    .sort((a, b) => ((a.data as string) < (b.data as string) ? -1 : 1))
    .slice(0, quantos);
}

export default function ColunaDoCliente({ clientId, painel }: { clientId: string; painel: PainelDoInstagram }) {
  const r = painel.resumo;
  const proximos = proximosPosts(painel.grade.itens);
  const semData = painel.grade.itens.filter((i) => !i.data).length;
  const q = `client=${encodeURIComponent(clientId)}`;
  return (
    <div className="min-w-0 space-y-3" data-coluna-do-cliente="">
      <Caixa icone={<Building2 className="h-3.5 w-3.5" />} titulo={r.nome || "Empresa"}>
        {r.negocio ? (
          <div className="space-y-1 text-[12.5px] leading-5 text-foreground">
            <p className="[overflow-wrap:anywhere]">{r.negocio.slice(0, 220)}</p>
            {r.publico && <p className="text-muted-foreground [overflow-wrap:anywhere]">Público: {r.publico.slice(0, 140)}</p>}
            {r.oferta && <p className="text-muted-foreground [overflow-wrap:anywhere]">Oferta: {r.oferta.slice(0, 140)}</p>}
          </div>
        ) : (
          <p className={juntar(texto.auxiliar, "leading-5")}>Sem contexto ainda. Monte em Contexto para a bio e o agente ficarem certeiros.</p>
        )}
        <Link to={`/mesa?${q}&aba=contexto`} className="mt-1.5 inline-flex items-center text-[12px] font-medium text-primary hover:underline">
          Contexto
          <ArrowUpRight className="ml-0.5 h-3 w-3" aria-hidden="true" />
        </Link>
      </Caixa>

      <Caixa icone={<CalendarDays className="h-3.5 w-3.5" />} titulo="Próximos posts">
        {proximos.length ? (
          <ul className="space-y-1">
            {proximos.map((p) => (
              <li key={p.id} className="flex min-w-0 items-center text-[12px] leading-4">
                <span className="mr-2 w-[74px] shrink-0 tabular-nums text-muted-foreground">{dataEHoraCurta(p.data as string)}</span>
                <span className="min-w-0 flex-1 truncate text-foreground" title={p.titulo}>
                  {p.titulo}
                </span>
                {!p.data_confirmada && <span className="ml-1 shrink-0 text-[10.5px] text-warning">proposta</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={texto.auxiliar}>Nenhum post com data.</p>
        )}
        {semData > 0 && <p className={juntar(texto.auxiliar, "mt-1")}>{semData} sem data.</p>}
        <Link to={`/calendario?${q}`} className="mt-1.5 inline-flex items-center text-[12px] font-medium text-primary hover:underline">
          Agenda
          <ArrowUpRight className="ml-0.5 h-3 w-3" aria-hidden="true" />
        </Link>
      </Caixa>

      <Caixa icone={<FolderOpen className="h-3.5 w-3.5" />} titulo="Pastas e arquivos">
        <div className="flex min-w-0 flex-col">
          <Link to={`/workspace?${q}`} className="inline-flex items-center py-0.5 text-[12.5px] text-foreground hover:text-primary">
            <FolderOpen className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Pastas do cliente (Workspace)
          </Link>
          <Link to={`/arquivos?${q}`} className="inline-flex items-center py-0.5 text-[12.5px] text-foreground hover:text-primary">
            <Files className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Arquivos e entregas
          </Link>
          <Link to={`/mesa-foto?${q}`} className="inline-flex items-center py-0.5 text-[12.5px] text-foreground hover:text-primary">
            <FolderOpen className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Acervo de fotos (Mesa Foto)
          </Link>
        </div>
      </Caixa>
    </div>
  );
}
