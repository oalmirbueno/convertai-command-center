import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, EyeOff, Eye, Lock, Trash2 } from "lucide-react";
import JanelaDoCelular from "@/components/sistema/JanelaDoCelular";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { EDITORIAL_DEFAULT_TIME_ZONE, isoUtcToZonedDateTimeLocal, zonedDateTimeLocalToIso } from "@/lib/editorialDate";
import { ImagemDaMesa, useMesa } from "../MesaContexto";
import { JanelaDaPublicacao, type PecaParaPublicar, type PublicacaoParaPublicar } from "../PublicacaoDaPeca";
import { estadoNoCalendario, type EstadoNoCalendario } from "../../../../supabase/functions/_shared/calendario-da-grade";
import { linkDoPostNaMesaFoto } from "../../../../supabase/functions/_shared/post-de-fotos";
import type { ItemDaGradeNaAba } from "./instagramApi";
import { dataCurtaOuSem, type Planejamento } from "./usePlanejamento";

/**
 * O post inteiro, aberto do calendário ou do simulador: todas as lâminas, a
 * legenda, o estado e a data (a de hoje e a proposta). Mudar a data vai para
 * o rascunho (aparece no calendário e na grade simulada na hora); agendar
 * de verdade é o Confirmar ou o "Publicar em".
 */

export const TOM_DO_CALENDARIO: Record<EstadoNoCalendario["tom"], string> = {
  ok: "bg-success/15 text-success",
  andamento: "bg-primary/10 text-primary",
  alerta: "bg-warning/15 text-foreground",
  erro: "bg-destructive/10 text-destructive",
  neutro: "bg-secondary text-muted-foreground",
  trava: "bg-muted text-muted-foreground",
};

export const bucketDoItem = (i: ItemDaGradeNaAba) => (i.origem === "agenda" || i.origem === "simulado") && i.imagem ? i.imagem.bucket : "mesa";

export default function DetalheDoPost({ item, plano, onFechar, podePublicar, onMudou }: { item: ItemDaGradeNaAba | null; plano: Planejamento; onFechar: () => void; podePublicar: boolean; onMudou: () => void }) {
  const { clientId } = useMesa();
  const efetivo = item ? plano.ordenados.find((x) => x.id === item.id) || item : null;
  const [quando, setQuando] = useState("");
  const [publicar, setPublicar] = useState(false);
  useEffect(() => {
    setQuando(efetivo && efetivo.data ? isoUtcToZonedDateTimeLocal(efetivo.data, EDITORIAL_DEFAULT_TIME_ZONE) || "" : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item && item.id]);
  if (!item || !efetivo) return null;
  const trava = plano.travaDoItem(item);
  const semAgenda = plano.semAgendamento(item);
  const estado = estadoNoCalendario(item);
  const laminas = item.laminas && item.laminas.length ? item.laminas : item.imagem ? [item.imagem.caminho] : [];
  const dentro = plano.fora.indexOf(item.id) < 0;
  const proposta = plano.rascunho[item.id];
  return (
    <>
      <JanelaDoCelular
        aberta={!!item}
        titulo={item.titulo}
        onFechar={onFechar}
        larga
        rodape={
          <div className="flex w-full flex-wrap items-center justify-end [&>*]:mb-1 [&>*]:ml-2">
            {item.origem === "simulado" ? (
              <button type="button" className={botao.perigo} onClick={() => { plano.removerSimulado(item.id); onFechar(); }}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Tirar da simulação
              </button>
            ) : (
              <button type="button" className={botao.discreto} onClick={() => plano.naSimulacaoOuNao(item.id, !dentro)}>
                {dentro ? <EyeOff className="mr-1.5 h-4 w-4" /> : <Eye className="mr-1.5 h-4 w-4" />}
                {dentro ? "Tirar da simulação" : "Pôr na simulação"}
              </button>
            )}
            {item.peca && !trava && (
              <button type="button" className={botao.secundario} onClick={() => setPublicar(true)}>
                <CalendarClock className="mr-1.5 h-4 w-4" />
                Publicar em
              </button>
            )}
          </div>
        }
      >
        <div className="min-w-0 space-y-3 text-[13px]">
          <div className="flex min-w-0 flex-wrap items-center">
            <span className={juntar(etiqueta, "mr-2", TOM_DO_CALENDARIO[estado.tom])}>{estado.rotulo}</span>
            <span className={texto.auxiliar}>
              Hoje: {dataCurtaOuSem(item.data)}
              {proposta ? ` · proposta: ${dataCurtaOuSem(proposta)}` : ""}
            </span>
          </div>
          <ul className="-mx-1 flex min-w-0 overflow-x-auto pb-1" aria-label="Lâminas do post">
            {laminas.map((c, k) => (
              <li key={c + k} className="mx-1 w-[150px] shrink-0">
                <span className="relative block w-full overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "125%" }}>
                  <ImagemDaMesa caminho={c} bucket={bucketDoItem(item)} alt={`Lâmina ${k + 1} de ${item.titulo}`} className="absolute inset-0 h-full w-full" />
                </span>
                <span className="mt-0.5 block text-center text-[11px] text-muted-foreground">{k + 1}</span>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            <p className={texto.rotulo}>Legenda</p>
            <p className="mt-0.5 whitespace-pre-line text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{item.legenda || <span className="text-muted-foreground">Sem legenda ainda.</span>}</p>
          </div>
          {trava ? (
            <p className="flex items-start rounded-md bg-muted px-3 py-2 text-[12.5px] leading-5">
              <Lock className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {trava}
            </p>
          ) : (
            <div className="min-w-0 space-y-2">
              <CampoDeFormulario rotulo="Nova data na simulação" apoio="Vai para o antes e depois; agenda só no Confirmar.">
                <div className="flex min-w-0 items-center">
                  <input type="datetime-local" className={juntar(campo, "min-w-0 flex-1")} value={quando} onChange={(e) => setQuando(e.target.value)} />
                  <button
                    type="button"
                    className={juntar(botao.primario, "ml-2 h-9")}
                    disabled={!quando}
                    onClick={() => {
                      const iso = zonedDateTimeLocalToIso(quando, EDITORIAL_DEFAULT_TIME_ZONE);
                      if (iso) plano.mudarData(item.id, iso);
                    }}
                  >
                    Mudar
                  </button>
                </div>
              </CampoDeFormulario>
              {semAgenda && <p className={juntar(texto.auxiliar, "leading-5")}>{semAgenda}</p>}
              {item.origem === "simulado" && (
                <Link to={linkDoPostNaMesaFoto(clientId)} className="inline-flex text-[12.5px] font-medium text-primary hover:underline">
                  Criar o post de fotos na Mesa Foto
                </Link>
              )}
            </div>
          )}
        </div>
      </JanelaDoCelular>
      {publicar && item.peca && (
        <JanelaDaPublicacao
          aberta={publicar}
          onFechar={() => setPublicar(false)}
          titulo={item.titulo}
          clientId={clientId}
          diaDaPeca={item.dia_da_peca}
          peca={item.peca as unknown as PecaParaPublicar}
          publicacao={(item.publicacao as unknown as PublicacaoParaPublicar) || null}
          podePublicar={podePublicar}
          onMudou={onMudou}
        />
      )}
    </>
  );
}
