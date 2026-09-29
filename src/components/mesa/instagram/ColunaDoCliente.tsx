import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, CalendarClock, Facebook, Instagram, Lock } from "lucide-react";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import Secao from "@/components/sistema/Secao";
import { botao, etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import { ImagemDaMesa } from "../MesaContexto";
import { estadoNoCalendario, noFuso } from "../../../../supabase/functions/_shared/calendario-da-grade";
import DetalheDoPost, { bucketDoItem, TOM_DO_CALENDARIO } from "./DetalheDoPost";
import PainelDeMudancas from "./PainelDeMudancas";
import TelaAgenda from "./TelaAgenda";
import TelaArquivos from "./TelaArquivos";
import { numeroDoPerfil, type ItemDaGradeNaAba, type PainelDoInstagram } from "./instagramApi";
import { dataCurtaOuSem, type Planejamento } from "./usePlanejamento";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";

/**
 * Telas do cliente dentro da aba Redes (rodada 3, 28/09: "já abrir outra tela
 * com base naquilo, não um pop-up lateral"). Resumo, Próximos, Agenda e
 * Pastas e arquivos ocupam a área da aba, com cabeçalho próprio e Voltar para
 * a prévia; o estado fica no endereço (&vista=...), então o voltar do
 * navegador também funciona. O link para a área completa é secundário.
 */

export type ParteDoPainel = "resumo" | "proximos" | "agenda" | "arquivos";

export const PARTES_DO_PAINEL: Array<{ valor: ParteDoPainel; rotulo: string }> = [
  { valor: "resumo", rotulo: "Resumo" },
  { valor: "proximos", rotulo: "Próximos posts" },
  { valor: "agenda", rotulo: "Agenda" },
  { valor: "arquivos", rotulo: "Pastas e arquivos" },
];

export const ehParte = (v: unknown): v is ParteDoPainel => PARTES_DO_PAINEL.some((p) => p.valor === v);

export function proximosPosts(itens: ItemDaGradeNaAba[], agora = new Date(), quantos = 6): ItemDaGradeNaAba[] {
  const hoje = agora.toISOString();
  return itens
    .filter((i) => !!i.data && (i.data as string) >= hoje)
    .sort((a, b) => ((a.data as string) < (b.data as string) ? -1 : 1))
    .slice(0, quantos);
}

export { semanasDoMes } from "./TelaAgenda";

/**
 * Bloco do resumo: seção ABERTA (28/09, dono: "não encaixotar"), que recolhe
 * pela setinha do título. Os blocos ficam lado a lado com o ritmo de
 * espaco.colunas, sem caixa em volta.
 */
function Bloco({ titulo, children, acao, className = "" }: { titulo: string; children: ReactNode; acao?: ReactNode; className?: string }) {
  return (
    <Secao nivel={3} titulo={titulo} acao={acao} className={className}>
      {children}
    </Secao>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={texto.rotulo}>{rotulo}</p>
      <div className="mt-0.5 text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function TelaResumo({ painel, plano, onVista }: { painel: PainelDoInstagram; plano: Planejamento; onVista: (v: ParteDoPainel) => void }) {
  const r = painel.resumo;
  const p = painel.perfil;
  const proximos = plano.ordenados.filter((i) => !!i.data && Date.parse(i.data) > Date.now()).slice(0, 4);
  const semData = plano.ordenados.filter((i) => !i.data).length;
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-x-8 gap-y-7 lg:grid-cols-2 desk:grid-cols-3" data-tela-resumo="">
      <Bloco titulo="Empresa" className="lg:row-span-2">
        {r.negocio || r.oferta || r.publico ? (
          <div className="space-y-3">
            <Campo rotulo="Nome">{r.nome}</Campo>
            {r.negocio && <Campo rotulo="O que faz">{r.negocio}</Campo>}
            {r.publico && <Campo rotulo="Público">{r.publico}</Campo>}
            {r.oferta && <Campo rotulo="Oferta">{r.oferta}</Campo>}
            {r.tom_de_voz && <Campo rotulo="Tom de voz">{r.tom_de_voz}</Campo>}
            {r.diferenciais.length > 0 && (
              <Campo rotulo="Diferenciais">
                <ul className="list-disc pl-4">
                  {r.diferenciais.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </Campo>
            )}
          </div>
        ) : (
          <p className={juntar(texto.auxiliar, "flex items-center")}>
            Sem contexto ainda
            <AjudaRecolhida className="ml-1" rotulo="Por que montar o contexto">
              Monte o contexto na aba Contexto para a bio, os destaques e o agente ficarem certeiros.
            </AjudaRecolhida>
          </p>
        )}
      </Bloco>

      <Bloco titulo="Perfil agora">
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-foreground">{p.username ? `@${p.username}` : "Sem Instagram conectado"}</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["posts", p.posts],
              ["seguidores", p.seguidores],
              ["seguindo", p.seguindo],
            ].map(([rotulo, v]) => (
              <div key={String(rotulo)} className="rounded-md bg-muted/50 px-2 py-1.5">
                <p className="text-[15px] font-semibold tabular-nums">{numeroDoPerfil(v as number | null)}</p>
                <p className="text-[12px] text-muted-foreground">{rotulo}</p>
              </div>
            ))}
          </div>
          {p.bio && <p className="whitespace-pre-line text-[13px] leading-5 text-foreground">{p.bio}</p>}
          {p.site && <p className="truncate text-[13px] text-primary">{p.site.replace(/^https?:\/\//, "")}</p>}
        </div>
      </Bloco>

      <Bloco titulo="Contas conectadas">
        <ul className="space-y-1.5 text-[13px]">
          {painel.contas.map((c) => (
            <li key={c.id} className="flex items-center">
              <Instagram className="mr-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />@{c.username}
            </li>
          ))}
          {painel.paginas.map((pg) => (
            <li key={pg.id} className="flex items-center">
              <Facebook className="mr-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              {pg.nome}
            </li>
          ))}
          {!painel.contas.length && !painel.paginas.length && <li className={texto.auxiliar}>Nenhuma conta conectada.</li>}
        </ul>
      </Bloco>

      <Bloco titulo="Kit da marca">
        {painel.kit.paleta.length ? (
          <div className="flex flex-wrap">
            {painel.kit.paleta.map((c) => (
              <span key={c.hex} className="mb-1.5 mr-2 flex items-center text-[12px]" title={c.hex}>
                <span className="mr-1 h-5 w-5 rounded-full border border-border" style={{ backgroundColor: c.hex }} />
                {c.nome || c.hex}
              </span>
            ))}
          </div>
        ) : (
          <p className={texto.auxiliar}>Sem paleta no kit.</p>
        )}
        {painel.kit.estilo && <p className={juntar(texto.auxiliar, "mt-1 leading-5")}>{painel.kit.estilo}</p>}
      </Bloco>

      <Bloco
        titulo="O que vai ao ar"
        acao={
          <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => onVista("proximos")}>
            Ver todos
          </button>
        }
      >
        {proximos.length ? (
          <ul className="space-y-1.5">
            {proximos.map((i) => (
              <li key={i.id} className="flex min-w-0 items-center text-[13px]">
                <span className="mr-2 w-[74px] shrink-0 tabular-nums text-muted-foreground">{dataCurtaOuSem(i.data)}</span>
                <span className="min-w-0 flex-1 truncate">{i.titulo}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={texto.auxiliar}>Nada com data daqui para a frente.</p>
        )}
        {semData > 0 && <p className={juntar(texto.auxiliar, "mt-1.5")}>{semData} sem data.</p>}
      </Bloco>
    </div>
  );
}

function TelaProximos({ plano, podePublicar, onAbrir }: { plano: Planejamento; podePublicar: boolean; onAbrir: (i: ItemDaGradeNaAba) => void }) {
  const agora = Date.now();
  const grupos = useMemo(() => {
    const m: Array<{ chave: string; rotulo: string; itens: ItemDaGradeNaAba[] }> = [];
    for (const i of plano.ordenados) {
      if (i.data && Date.parse(i.data) < agora) continue;
      let chave = "sem";
      let rotulo = "Sem data";
      if (i.data) {
        const dia = noFuso(i.data).dia;
        chave = dia;
        rotulo = dia.split("-").reverse().join("/");
      }
      let g = m.find((x) => x.chave === chave);
      if (!g) {
        g = { chave, rotulo, itens: [] };
        m.push(g);
      }
      g.itens.push(i);
    }
    return m;
  }, [plano.ordenados, agora]);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]" data-tela-proximos="">
      <div className="min-w-0 space-y-4">
        {!grupos.length && <p className={texto.auxiliar}>Nenhum post para ir ao ar.</p>}
        {grupos.map((g) => (
          <section key={g.chave} className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>{g.rotulo}</p>
            <ul className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
              {g.itens.map((i) => {
                const estado = estadoNoCalendario(i);
                const trava = plano.travaDoItem(i);
                return (
                  <li key={i.id}>
                    <button type="button" onClick={() => onAbrir(i)} className={juntar(superficie.painel, "flex w-full min-w-0 items-center p-2 text-left hover:border-primary/50")}>
                      <span className="relative mr-3 block h-[84px] w-[64px] shrink-0 overflow-hidden rounded bg-muted">
                        <ImagemDaMesa caminho={i.imagem ? i.imagem.caminho : null} bucket={bucketDoItem(i)} alt={i.titulo} className="absolute inset-0 h-full w-full" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">{i.titulo}</span>
                        <span className="mt-0.5 block text-[12px] tabular-nums text-muted-foreground">
                          {dataCurtaOuSem(i.data)}
                          {plano.rascunho[i.id] ? " (proposta)" : i.data && !i.data_confirmada ? " (a confirmar)" : ""}
                        </span>
                        {i.legenda && <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{i.legenda}</span>}
                        <span className="mt-1 flex items-center">
                          <span className={juntar(etiqueta, TOM_DO_CALENDARIO[estado.tom])}>{estado.rotulo}</span>
                          {trava && <Lock className="ml-1.5 h-3 w-3 text-muted-foreground" aria-label={trava} />}
                        </span>
                      </span>
                      {i.peca && !trava && <CalendarClock className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <aside className="min-w-0">
        <div className={juntar(superficie.painel, "px-3 py-3")}>
          <p className="mb-2 text-[13px] font-semibold">Datas e agendamento</p>
          <PainelDeMudancas plano={plano} podePublicar={podePublicar} compacto />
        </div>
      </aside>
    </div>
  );
}

const LINK_DA_AREA: Record<ParteDoPainel, { rotulo: string; rota: (q: string) => string }> = {
  resumo: { rotulo: "Contexto completo", rota: (q) => `/mesa?${q}&aba=contexto` },
  proximos: { rotulo: "Agenda completa", rota: (q) => `/calendario?${q}` },
  agenda: { rotulo: "Agenda completa", rota: (q) => `/calendario?${q}` },
  arquivos: { rotulo: "Arquivos completos", rota: (q) => `/arquivos?${q}` },
};

export default function TelaDoCliente({
  clientId,
  vista,
  onVista,
  onVoltar,
  painel,
  plano,
  podePublicar,
  onMudou,
  onSimular,
}: {
  clientId: string;
  vista: ParteDoPainel;
  onVista: (v: ParteDoPainel) => void;
  onVoltar: () => void;
  painel: PainelDoInstagram;
  plano: Planejamento;
  podePublicar: boolean;
  onMudou: () => void;
  /** Pôr uma imagem dos arquivos na simulação e voltar para a prévia. */
  onSimular: (s: { bucket: string; caminho: string; nome: string }) => void;
}) {
  const [aberto, setAberto] = useState<ItemDaGradeNaAba | null>(null);
  const q = `client=${encodeURIComponent(clientId)}`;
  const link = LINK_DA_AREA[vista];
  const atual = PARTES_DO_PAINEL.find((p) => p.valor === vista) || PARTES_DO_PAINEL[0];
  return (
    <section className={juntar(superficie.painel, "flex min-w-0 flex-col lg:min-h-0 lg:flex-1")} aria-label={atual.rotulo} data-tela-do-cliente={vista}>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center border-b border-border px-3 py-2">
        <button type="button" className={juntar(botao.secundario, "mb-1 mr-3 h-8 px-2.5 text-[12.5px]")} onClick={onVoltar}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Voltar à prévia
        </button>
        <div role="tablist" aria-label="Telas do cliente" className="mb-1 mr-3 flex min-w-0 rounded-lg bg-muted p-1">
          {PARTES_DO_PAINEL.map((p) => (
            <button
              key={p.valor}
              type="button"
              role="tab"
              aria-selected={vista === p.valor}
              onClick={() => onVista(p.valor)}
              className={juntar("toque-compacto whitespace-nowrap rounded-md px-2.5 py-1 text-[12.5px] font-medium", vista === p.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        <Link to={link.rota(q)} className="mb-1 ml-auto inline-flex items-center text-[12px] text-muted-foreground hover:text-foreground">
          {link.rotulo}
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <RegiaoRolavel rotulo={atual.rotulo} memoria={`mesa:instagram:vista:${clientId}:${vista}`} sobre="cartao" className="px-3 py-3 sm:px-4">
        {vista === "resumo" && <TelaResumo painel={painel} plano={plano} onVista={onVista} />}
        {vista === "proximos" && <TelaProximos plano={plano} podePublicar={podePublicar} onAbrir={setAberto} />}
        {vista === "agenda" && <TelaAgenda plano={plano} perfil={painel.perfil} podePublicar={podePublicar} onAbrir={setAberto} />}
        {vista === "arquivos" && <TelaArquivos onSimular={onSimular} />}
      </RegiaoRolavel>
      <DetalheDoPost item={aberto} plano={plano} onFechar={() => setAberto(null)} podePublicar={podePublicar} onMudou={onMudou} />
    </section>
  );
}
