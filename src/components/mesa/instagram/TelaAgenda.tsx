import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import { ImagemDaMesa } from "../MesaContexto";
import { estadoNoCalendario, noFuso, semanaDe } from "../../../../supabase/functions/_shared/calendario-da-grade";
import { bucketDoItem, TOM_DO_CALENDARIO } from "./DetalheDoPost";
import PainelDeMudancas from "./PainelDeMudancas";
import type { ItemDaGradeNaAba, PerfilDaAba } from "./instagramApi";
import type { Planejamento } from "./usePlanejamento";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";

/**
 * Agenda de verdade (rodada 3, 28/09): mês ou semana, com a miniatura, o
 * título curto e o estado de cada post no dia. Arrastar um post para outro
 * dia muda a data dele no rascunho (a grade simulada muda junto); clicar abre
 * o post inteiro. Publicados e agendados na Meta aparecem com cadeado. Ao
 * lado, o antes e depois, a troca automática e o Confirmar.
 */

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Semanas do mês (segunda a domingo), com null nos dias de fora. */
export function semanasDoMes(ano: number, mes: number): Array<Array<string | null>> {
  const primeiro = new Date(ano, mes, 1);
  const dias = new Date(ano, mes + 1, 0).getDate();
  const recuo = (primeiro.getDay() + 6) % 7;
  const celulas: Array<string | null> = [];
  for (let i = 0; i < recuo; i++) celulas.push(null);
  for (let d = 1; d <= dias; d++) celulas.push(`${ano}-${dois(mes + 1)}-${dois(d)}`);
  while (celulas.length % 7) celulas.push(null);
  const semanas: Array<Array<string | null>> = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  return semanas;
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

type PublicadoNoDia = { id: string; imagem: string | null; legenda: string; link: string | null };

function hojeNoFuso(): string {
  return noFuso(new Date().toISOString()).dia;
}

function PostNoDia({ item, plano, grande, onAbrir, onArrastar }: { item: ItemDaGradeNaAba; plano: Planejamento; grande: boolean; onAbrir: () => void; onArrastar: (id: string | null) => void }) {
  const trava = plano.travaDoItem(item);
  const estado = estadoNoCalendario(item);
  const proposta = !!plano.rascunho[item.id];
  const hora = item.data ? noFuso(item.data).hora : "";
  return (
    <li
      draggable={!trava}
      onDragStart={(e) => {
        try {
          e.dataTransfer.setData("text/plain", item.id);
          e.dataTransfer.effectAllowed = "move";
        } catch {
          /* sem dataTransfer: fica o id guardado */
        }
        onArrastar(item.id);
      }}
      onDragEnd={() => onArrastar(null)}
      className="min-w-0"
      data-post-no-dia={item.id}
    >
      <button
        type="button"
        onClick={onAbrir}
        title={trava || item.titulo}
        className={juntar("flex w-full min-w-0 items-center rounded-md border bg-card p-1 text-left hover:border-primary/60", proposta ? "border-primary" : "border-border", trava ? "" : "cursor-grab")}
      >
        <span className={juntar("relative block shrink-0 overflow-hidden rounded bg-muted", grande ? "h-[60px] w-[46px]" : "h-9 w-7")}>
          <ImagemDaMesa caminho={item.imagem ? item.imagem.caminho : null} bucket={bucketDoItem(item)} alt={item.titulo} className="absolute inset-0 h-full w-full" />
        </span>
        <span className="ml-1.5 min-w-0 flex-1">
          <span className="block truncate text-[11.5px] font-medium leading-4 text-foreground">{item.titulo}</span>
          <span className="flex min-w-0 items-center">
            <span className="mr-1 text-[10.5px] tabular-nums text-muted-foreground">{hora}</span>
            <span className={juntar(etiqueta, "h-4 truncate px-1 text-[10px]", TOM_DO_CALENDARIO[estado.tom])}>{estado.rotulo}</span>
            {trava && <Lock className="ml-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
          </span>
          {grande && item.legenda && <span className="block truncate text-[11px] leading-4 text-muted-foreground">{item.legenda}</span>}
        </span>
      </button>
    </li>
  );
}

export default function TelaAgenda({ plano, perfil, podePublicar, onAbrir }: { plano: Planejamento; perfil: PerfilDaAba; podePublicar: boolean; onAbrir: (i: ItemDaGradeNaAba) => void }) {
  const hoje = hojeNoFuso();
  const [modo, setModo] = useState<"mes" | "semana">("mes");
  const [ancora, setAncora] = useState(hoje);
  const [arrastado, setArrastado] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);

  const porDia = useMemo(() => {
    const m: Record<string, { planejados: ItemDaGradeNaAba[]; publicados: PublicadoNoDia[] }> = {};
    const garantir = (k: string) => (m[k] = m[k] || { planejados: [], publicados: [] });
    for (const i of plano.ordenados) if (i.data) garantir(noFuso(i.data).dia).planejados.push(i);
    for (const p of perfil.midias) if (p.data) garantir(noFuso(p.data).dia).publicados.push({ id: p.id, imagem: p.imagem, legenda: p.legenda, link: p.permalink });
    return m;
  }, [plano.ordenados, perfil.midias]);
  const semData = plano.ordenados.filter((i) => !i.data);

  const [a, mm] = ancora.split("-").map(Number);
  const semanas = modo === "mes" ? semanasDoMes(a, mm - 1) : [semanaDe(ancora)];
  const andar = (n: number) => {
    const [ano, mes, dia] = ancora.split("-").map(Number);
    const d = modo === "mes" ? new Date(Date.UTC(ano, mes - 1 + n, 1)) : new Date(Date.UTC(ano, mes - 1, dia + 7 * n));
    setAncora(d.toISOString().slice(0, 10));
  };
  const titulo =
    modo === "mes"
      ? `${MESES[mm - 1]} de ${a}`
      : (() => {
          const s = semanaDe(ancora);
          return `${s[0].slice(8)}/${s[0].slice(5, 7)} a ${s[6].slice(8)}/${s[6].slice(5, 7)}`;
        })();
  const soltar = (dia: string) => {
    if (arrastado) plano.paraDia(arrastado, dia);
    setArrastado(null);
    setAlvo(null);
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]" data-tela-agenda="">
      <div className="min-w-0">
        <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between">
          <div className="flex items-center">
            <button type="button" className={botao.icone} onClick={() => andar(-1)} aria-label={modo === "mes" ? "Mês anterior" : "Semana anterior"}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="mx-2 min-w-[150px] text-center text-[15px] font-semibold text-foreground">{titulo}</p>
            <button type="button" className={botao.icone} onClick={() => andar(1)} aria-label={modo === "mes" ? "Próximo mês" : "Próxima semana"}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" className={juntar(botao.discreto, "ml-1 h-8 px-2 text-[12px]")} onClick={() => setAncora(hoje)}>
              Hoje
            </button>
          </div>
          <SeletorCompacto
            rotulo="Ver por"
            valor={modo}
            onEscolher={(v) => setModo(v === "semana" ? "semana" : "mes")}
            opcoes={[
              { valor: "mes", rotulo: "Mês" },
              { valor: "semana", rotulo: "Semana" },
            ]}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] table-fixed border-separate" style={{ borderSpacing: 4 }}>
            <thead>
              <tr>
                {DIAS.map((d) => (
                  <th key={d} className="pb-1 text-left text-[11.5px] font-medium text-muted-foreground">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {semanas.map((s, i) => (
                <tr key={i}>
                  {s.map((k, j) => {
                    const info = k ? porDia[k] : null;
                    const passado = !!k && k < hoje;
                    return (
                      <td
                        key={j}
                        className={juntar(
                          "align-top rounded-md border p-1",
                          modo === "semana" ? "h-[380px]" : "h-[132px]",
                          !k ? "border-transparent" : alvo === k ? "border-primary bg-primary/5" : k === hoje ? "border-primary/60" : "border-border",
                          passado ? "bg-muted/30" : "",
                        )}
                        onDragOver={(e) => {
                          if (!k || passado) return;
                          e.preventDefault();
                          if (alvo !== k) setAlvo(k);
                        }}
                        onDragLeave={() => alvo === k && setAlvo(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (k && !passado) soltar(k);
                        }}
                        data-dia={k || undefined}
                      >
                        {k && (
                          <div className="flex h-full min-w-0 flex-col">
                            <span className={juntar("mb-1 text-[11.5px] tabular-nums", k === hoje ? "font-semibold text-primary" : "text-muted-foreground")}>{Number(k.slice(8))}</span>
                            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                              {info &&
                                info.planejados.map((item) => (
                                  <PostNoDia key={item.id} item={item} plano={plano} grande={modo === "semana"} onAbrir={() => onAbrir(item)} onArrastar={setArrastado} />
                                ))}
                              {info &&
                                info.publicados.map((p) => (
                                  <li key={p.id} className="min-w-0">
                                    <a href={p.link || "#"} target="_blank" rel="noreferrer" title={`Publicado: ${p.legenda}`} className="flex min-w-0 items-center rounded-md border border-dashed border-border p-1 opacity-80">
                                      <span className={juntar("relative block shrink-0 overflow-hidden rounded bg-muted", modo === "semana" ? "h-[60px] w-[46px]" : "h-9 w-7")}>
                                        {p.imagem && <img src={p.imagem} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />}
                                      </span>
                                      <span className="ml-1.5 min-w-0 flex-1">
                                        <span className="block truncate text-[11px] leading-4 text-muted-foreground">{p.legenda || "Post"}</span>
                                        <span className={juntar(etiqueta, "h-4 px-1 text-[10px]", TOM_DO_CALENDARIO.trava)}>Publicado</span>
                                      </span>
                                    </a>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={juntar(texto.auxiliar, "mt-1 flex items-center")}>
          Arraste para mudar o dia
          <AjudaRecolhida className="ml-1" rotulo="Como mudar a data">
            Arraste um post para outro dia (a hora fica a mesma). Com cadeado: já agendado na Meta ou publicado.
          </AjudaRecolhida>
        </p>
      </div>

      <aside className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 2xl:block 2xl:space-y-3">
        <div className={juntar(superficie.painel, "px-3 py-3")}>
          <p className="mb-2 text-[13px] font-semibold">Datas e agendamento</p>
          <PainelDeMudancas plano={plano} podePublicar={podePublicar} compacto />
        </div>
        {semData.length > 0 && (
          <div className={juntar(superficie.painel, "px-3 py-3")}>
            <p className="text-[13px] font-semibold">Sem data ({semData.length})</p>
            <p className={juntar(texto.auxiliar, "mb-2")}>Arraste para um dia do calendário.</p>
            <ul className="space-y-1">
              {semData.map((i) => (
                <PostNoDia key={i.id} item={i} plano={plano} grande onAbrir={() => onAbrir(i)} onArrastar={setArrastado} />
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
