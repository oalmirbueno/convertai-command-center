import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Secao from "@/components/sistema/Secao";
import { botao, espaco, etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { copiarTexto } from "../instagram/instagramApi";
import { noFuso } from "../instagram/calendario-da-grade";
import PreviaDoStory, { SeloDoCaminho } from "./PreviaDoStory";
import { baixarStory } from "./baixarStories";
import type { MarcaDosStories } from "./marcaDosStories";
import { chamarStories, diaCurto, hojeLocal, normalizarStory, roteiroDoAdesivo, SITUACOES, somarDias, type Story } from "./storiesApi";

/**
 * Bloco Agenda: a semana de stories em colunas por dia, cada story no horário
 * com a situação (rascunho, arte pronta, agendado, postar pelo app,
 * publicado, falhou). Os que vão pelo app têm a arte para baixar, o roteiro
 * do adesivo para copiar e o "Postei" (marcar_postado).
 */

/** Segunda-feira da semana de um dia (AAAA-MM-DD). */
export function segundaDaSemana(dia: string): string {
  const p = dia.split("-").map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return somarDias(dia, -((d.getDay() + 6) % 7));
}

/** Os stories de cada dia da semana, por horário. */
export function storiesDaSemana(stories: Story[], segunda: string): Array<{ dia: string; stories: Story[] }> {
  const dias = [0, 1, 2, 3, 4, 5, 6].map((i) => somarDias(segunda, i));
  return dias.map((dia) => ({
    dia,
    stories: stories
      .filter((s) => !!s.horario && noFuso(s.horario).dia === dia)
      .sort((a, b) => Date.parse(String(a.horario)) - Date.parse(String(b.horario))),
  }));
}

function ItemDaAgenda({ clientId, s, marca, onMudou, onAbrir }: { clientId: string; s: Story; marca: MarcaDosStories; onMudou: (s: Story) => void; onAbrir: (s: Story) => void }) {
  const [ocupado, setOcupado] = useState<"postei" | "baixar" | null>(null);
  const sit = SITUACOES[s.situacao];
  const app = s.caminho === "pelo_app";
  const postei = async () => {
    setOcupado("postei");
    try {
      const r = await chamarStories<{ story: unknown }>("marcar_postado", clientId, { id: s.id });
      onMudou(normalizarStory(r && r.story ? r.story : { ...s, situacao: "publicado" }));
    } catch (e) {
      toast.error("Não deu para marcar", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };
  const baixar = async () => {
    setOcupado("baixar");
    try {
      await baixarStory(s, marca);
    } catch (e) {
      toast.error("Não deu para baixar a arte", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };
  return (
    <li className={juntar(superficie.painel, "min-w-0 p-2")} data-story-na-agenda={s.id}>
      <div className="flex min-w-0">
        <button type="button" className="mr-2 block shrink-0 rounded-md" onClick={() => onAbrir(s)} aria-label={`Abrir o story das ${s.horario ? noFuso(s.horario).hora : ""}`}>
          <PreviaDoStory story={s} largura={44} paleta={marca.paleta} familia={marca.familia} foto={marca.foto(s.fundo.imagem_id)} semSelo />
        </button>
        <div className="min-w-0 flex-1">
          <p className={juntar(texto.corpo, "font-medium tabular-nums")}>{s.horario ? noFuso(s.horario).hora : ""}</p>
          <p className={juntar(texto.auxiliar, "truncate")} title={s.texto_na_tela}>
            {s.titulo || s.texto_na_tela || "Story"}
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center [&>*]:mb-0.5 [&>*]:mr-1">
            <span className={juntar(etiqueta, sit.tom)} title={s.motivo || undefined} data-situacao={s.situacao}>
              {sit.rotulo}
            </span>
            <SeloDoCaminho adesivo={s.adesivo} />
          </div>
        </div>
      </div>
      {app && s.situacao !== "publicado" ? (
        <div className="mt-1.5 flex min-w-0 items-center border-t border-border pt-1.5">
          <button type="button" className={botao.icone} onClick={() => void baixar()} disabled={!!ocupado} aria-label="Baixar arte" title="Baixar arte">
            {ocupado === "baixar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          <button type="button" className={botao.icone} onClick={() => void copiarTexto(roteiroDoAdesivo(s)).then((ok) => (ok ? toast.success("Roteiro do adesivo copiado") : toast.error("Não deu para copiar")))} aria-label="Copiar o roteiro do adesivo" title="Copiar o roteiro do adesivo">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span className="flex-1" />
          {s.situacao === "postar_pelo_app" ? (
            <button type="button" className={juntar(botao.secundario, "h-8 px-2.5")} onClick={() => void postei()} disabled={!!ocupado}>
              {ocupado === "postei" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
              Postei
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function BlocoAgenda({ clientId, stories, marca, onMudou, onAbrir }: { clientId: string; stories: Story[]; marca: MarcaDosStories; onMudou: (s: Story) => void; onAbrir: (s: Story) => void }) {
  const hoje = hojeLocal();
  const [segunda, setSegunda] = useState(() => segundaDaSemana(hoje));
  const semana = useMemo(() => storiesDaSemana(stories, segunda), [stories, segunda]);
  const total = semana.reduce((n, d) => n + d.stories.length, 0);
  const paraPostar = semana.reduce((n, d) => n + d.stories.filter((s) => s.situacao === "postar_pelo_app").length, 0);
  const semHorario = stories.filter((s) => !s.horario).length;

  return (
    <Secao
      data-bloco-dos-stories="agenda"
      recolher={`mesa:stories:agenda:${clientId}`}
      titulo={`Semana de ${diaCurto(segunda)} a ${diaCurto(somarDias(segunda, 6))}`}
      descricao={`${total} stories${paraPostar ? ` · ${paraPostar} para postar pelo app` : ""}${semHorario ? ` · ${semHorario} sem horário` : ""}`}
      ajuda="Automático: o painel publica no horário. Pelo app: a equipe recebe o aviso Postar agora pelo app, baixa a arte, põe o adesivo do roteiro e marca Postei."
      acao={
        <div className="flex items-center">
          <button type="button" className={botao.icone} onClick={() => setSegunda(somarDias(segunda, -7))} aria-label="Semana anterior" title="Semana anterior">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={juntar(botao.discreto, "h-8 px-2")} onClick={() => setSegunda(segundaDaSemana(hoje))} disabled={segunda === segundaDaSemana(hoje)}>
            Hoje
          </button>
          <button type="button" className={botao.icone} onClick={() => setSegunda(somarDias(segunda, 7))} aria-label="Próxima semana" title="Próxima semana">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      }
    >
      <div className={juntar(espaco.grade, "sm:grid-cols-2 lg:grid-cols-4 min-[1700px]:grid-cols-7")} aria-label="Dias da semana">
        {semana.map((d) => (
          <section key={d.dia} className="min-w-0 border-t border-border pt-2" aria-label={diaCurto(d.dia)} data-dia={d.dia}>
            <p className={juntar(texto.rotulo, "flex items-center", d.dia === hoje ? "text-primary" : "")}>
              {diaCurto(d.dia)}
              {d.dia === hoje ? <span className="ml-1.5">hoje</span> : null}
              {d.stories.length ? <span className="ml-auto tabular-nums">{d.stories.length}</span> : null}
            </p>
            {d.stories.length ? (
              <ul className="mt-2 grid min-w-0 gap-2">
                {d.stories.map((s) => (
                  <ItemDaAgenda key={s.id} clientId={clientId} s={s} marca={marca} onMudou={onMudou} onAbrir={onAbrir} />
                ))}
              </ul>
            ) : (
              <p className={juntar(texto.auxiliar, "mt-2")}>Nada</p>
            )}
          </section>
        ))}
      </div>
    </Secao>
  );
}
