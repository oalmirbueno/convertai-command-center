import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CalendarCheck, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import JanelaDoCelular from "@/components/sistema/JanelaDoCelular";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, juntar } from "@/components/sistema/estilos";
import { EDITORIAL_DEFAULT_TIME_ZONE, isoUtcToZonedDateTimeLocal, zonedDateTimeLocalToIso } from "@/lib/editorialDate";
import {
  confirmarPublicacao,
  dispensarPublicacao,
  lerMelhoresHorarios,
  lerPerfisDaPeca,
  textoDoErro,
  type PerfilDaPecaNaTela,
} from "@/lib/mesa/api";
import { itemDaMarca } from "@/lib/mesa/marcas";
import { useFiltroDaMarca, useMesa } from "./MesaContexto";
import { dataEHoraCurta } from "./PublicacaoDaPeca";
import {
  horarioSugerido,
  localParaIso,
  partesNoFuso,
  problemaNoHorario,
  rotuloDoPerfil,
  tipoDoConteudo,
} from "../../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";

/**
 * Aprovou → Agenda, sem data (frente AP, 28/09). Pedido do dono: "se não tem
 * data, dentro do Estúdio, quando entrar, ele pergunta qual é a data e o
 * horário; aí escolhe se vai postar ou não, onde, qual o perfil; já escolhe
 * tudo ali para ficar agendadinho".
 *
 * A peça aprovada pelo cliente sem data confirmada (ou aprovada depois do
 * horário) aparece aqui, uma de cada vez: data e hora (a proposta da entrega
 * ou o dia da peça com o melhor horário do perfil), vai postar ou não, e os
 * perfis da marca (Instagram publica sozinho; página do Facebook fica na
 * Agenda para a equipe postar). Confirmar grava tudo pelo mesmo caminho do
 * "Publicar em" (publicacao_confirmar): aprovada + data = agendada.
 *
 * Abre sozinha uma vez por sessão ao entrar no Estúdio (só admin e gestor,
 * que são quem agenda), ou pelo link do aviso (&publicar=<trabalho>). Depois
 * fica no botão "sem data" da faixa de pautas.
 */

export const PARAMETRO_PUBLICAR = "publicar";
const DIAS_DE_APROVACAO = 45;

export interface AprovadaSemData {
  id: string;
  task_id: string | null;
  file_ids: string[];
  post_id: string | null;
  aprovado_em: string | null;
  publicar_em: string | null;
  entrega_aviso: string | null;
  titulo: string;
  dia: string | null;
  project_id: string | null;
}

export const chaveDasAprovadasSemData = (clientId: string) => ["mesa", "aprovadas-sem-data", clientId];

const COLUNAS = "id, task_id, tipo, status, file_ids, post_id, entrega_status, entrega_aviso, aprovado_em, publicar_em";

/** Peças aprovadas que ainda esperam a data (sem as que o dono marcou "não vai postar"). */
export async function lerAprovadasSemData(clientId: string, agora = new Date()): Promise<AprovadaSemData[]> {
  const desde = new Date(agora.getTime() - DIAS_DE_APROVACAO * 24 * 60 * 60_000).toISOString();
  const consulta = (colunas: string) =>
    (supabase as any)
      .from("estudio_trabalhos")
      .select(colunas)
      .eq("client_id", clientId)
      .eq("status", "entregue")
      .eq("entrega_status", "aprovado")
      .gte("aprovado_em", desde)
      .order("aprovado_em", { ascending: true })
      .limit(30);
  // Sem o SQL AP-01 a coluna do "não vai postar" não existe: lê sem ela.
  let r = await consulta(`${COLUNAS}, publicacao_dispensada_em`);
  if (r.error) r = await consulta(COLUNAS);
  if (r.error) throw r.error;
  const linhas = ((r.data || []) as any[]).filter((t) => t.tipo !== "ads" && !t.publicacao_dispensada_em && !!t.task_id);
  if (!linhas.length) return [];
  const { data: tarefas } = await (supabase as any)
    .from("tasks")
    .select("id, title, due_date, project_id, deleted_at")
    .in("id", linhas.map((t) => t.task_id));
  const porId: Record<string, any> = {};
  for (const x of (tarefas || []) as any[]) porId[x.id] = x;
  return linhas
    .filter((t) => porId[t.task_id] && !porId[t.task_id].deleted_at)
    .map((t) => ({
      id: t.id,
      task_id: t.task_id,
      file_ids: Array.isArray(t.file_ids) ? t.file_ids : [],
      post_id: t.post_id || null,
      aprovado_em: t.aprovado_em || null,
      publicar_em: t.publicar_em || null,
      entrega_aviso: t.entrega_aviso || null,
      titulo: String(porId[t.task_id].title || "Post"),
      dia: porId[t.task_id].due_date || null,
      project_id: porId[t.task_id].project_id || null,
    }));
}

/** Data e hora que o campo abre: a proposta na entrega (se ainda à frente) ou o dia da peça com o melhor horário. */
export function dataInicialDaAprovada(p: Pick<AprovadaSemData, "publicar_em" | "dia" | "file_ids">, melhorHora: string | null, agora = new Date()): string {
  if (p.publicar_em && !problemaNoHorario(p.publicar_em, agora)) {
    return isoUtcToZonedDateTimeLocal(p.publicar_em, EDITORIAL_DEFAULT_TIME_ZONE) || "";
  }
  const hoje = partesNoFuso(agora, EDITORIAL_DEFAULT_TIME_ZONE);
  const s = horarioSugerido({ diaDaPeca: p.dia, hoje: hoje.dia, agoraHHMM: hoje.hora, melhorHora });
  const iso = localParaIso(s.dia, s.hora, EDITORIAL_DEFAULT_TIME_ZONE);
  return iso ? isoUtcToZonedDateTimeLocal(iso, EDITORIAL_DEFAULT_TIME_ZONE) || "" : "";
}

/** Perfis que abrem marcados: os que o post já tem; senão o primeiro Instagram. */
export function perfisIniciais(perfis: PerfilDaPecaNaTela[]): string[] {
  const ja = perfis.filter((p) => p.escolhido).map((p) => p.id);
  if (ja.length) return ja;
  const ig = perfis.find((p) => p.platform === "instagram");
  return ig ? [ig.id] : [];
}

const lembrete = (clientId: string) => `mesa:aprovadas-sem-data:vista:${clientId}`;
function jaAbriuNaSessao(clientId: string): boolean {
  try {
    return window.sessionStorage.getItem(lembrete(clientId)) === "1";
  } catch {
    return false;
  }
}
function marcarAberta(clientId: string) {
  try {
    window.sessionStorage.setItem(lembrete(clientId), "1");
  } catch {
    /* sem sessionStorage: abre de novo na próxima vez, sem problema */
  }
}

/** Relê a lista quando chega aviso novo para quem está na tela (o cliente aprovou agora). */
function useRelerComAvisos(clientId: string, userId: string | null, ligado: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ligado || !userId || !clientId) return;
    let espera: ReturnType<typeof setTimeout> | null = null;
    const reler = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => void queryClient.invalidateQueries({ queryKey: chaveDasAprovadasSemData(clientId) }), 1500);
    };
    let canal: ReturnType<typeof supabase.channel> | null = null;
    try {
      canal = supabase
        .channel(`aprovadas-sem-data:${clientId}:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, reler)
        .subscribe();
    } catch {
      canal = null;
    }
    return () => {
      if (espera) clearTimeout(espera);
      if (canal) void supabase.removeChannel(canal);
    };
  }, [clientId, userId, ligado, queryClient]);
}

export default function AprovadasSemData() {
  const { clientId, userId, podeRecarregar } = useMesa();
  const filtro = useFiltroDaMarca();
  const [parametros, setParametros] = useSearchParams();
  const pedida = (parametros.get(PARAMETRO_PUBLICAR) || "").trim() || null;
  const lista = useQuery({
    queryKey: chaveDasAprovadasSemData(clientId),
    enabled: !!clientId && podeRecarregar,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => lerAprovadasSemData(clientId),
  });
  useRelerComAvisos(clientId, userId, podeRecarregar);
  // Acerbi e CME: só as peças da marca aberta.
  const pecas = useMemo(() => (lista.data || []).filter((p) => itemDaMarca(p.project_id, filtro)), [lista.data, filtro]);
  const [aberta, setAberta] = useState(false);
  const [indice, setIndice] = useState(0);

  // Abre sozinha: pelo link do aviso, ou uma vez por sessão ao entrar no Estúdio.
  const abriuSozinha = useRef(false);
  useEffect(() => {
    if (!podeRecarregar || !lista.data || abriuSozinha.current) return;
    if (pedida) {
      const i = pecas.findIndex((p) => p.id === pedida);
      abriuSozinha.current = true;
      if (i >= 0) {
        setIndice(i);
        setAberta(true);
        marcarAberta(clientId);
      }
      const p = new URLSearchParams(parametros.toString());
      p.delete(PARAMETRO_PUBLICAR);
      setParametros(p, { replace: true });
      return;
    }
    if (pecas.length && !jaAbriuNaSessao(clientId)) {
      abriuSozinha.current = true;
      setIndice(0);
      setAberta(true);
      marcarAberta(clientId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeRecarregar, lista.data, pecas.length, pedida, clientId]);

  if (!podeRecarregar || !pecas.length) return null;
  const atual = pecas[Math.min(indice, pecas.length - 1)];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIndice(0);
          setAberta(true);
        }}
        className={juntar(botao.barra, "mb-1 mt-1 text-foreground")}
        title="Aprovadas pelo cliente que ainda esperam a data"
        data-aprovadas-sem-data={pecas.length}
      >
        <CalendarClock className="mr-1 h-3.5 w-3.5 text-warning" />
        {pecas.length} sem data
      </button>
      {aberta && atual && (
        <JanelaDaAprovada
          key={atual.id}
          peca={atual}
          posicao={Math.min(indice, pecas.length - 1) + 1}
          total={pecas.length}
          onFechar={() => setAberta(false)}
          onFeita={() => {
            // A lista relê sem esta peça; o índice fica e aponta para a próxima.
            if (pecas.length <= 1) setAberta(false);
          }}
        />
      )}
    </>
  );
}

/** A janela curta (data e hora, vai postar, onde). Também é a do "Agendar" do Estúdio (AgendarDoEstudio). */
export function JanelaDaAprovada({
  peca,
  posicao,
  total,
  onFechar,
  onFeita,
  titulo,
}: {
  peca: AprovadaSemData;
  posicao: number;
  total: number;
  onFechar: () => void;
  onFeita: () => void;
  /** Título da janela; sem ele, "Aprovado sem data". */
  titulo?: string;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const perfis = useQuery({
    queryKey: ["mesa", "perfis-da-peca", peca.id],
    staleTime: 60_000,
    retry: false,
    queryFn: () => lerPerfisDaPeca(peca.id),
  });
  const melhores = useQuery({
    queryKey: ["mesa", "melhores-horarios", clientId],
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => lerMelhoresHorarios(clientId),
  });
  const melhorHora = melhores.data?.por_tipo?.[tipoDoConteudo(peca.file_ids)] || null;

  const [vaiPostar, setVaiPostar] = useState(true);
  const [quando, setQuando] = useState("");
  const [escolhidos, setEscolhidos] = useState<string[] | null>(null);
  const [fazendo, setFazendo] = useState(false);

  useEffect(() => {
    if (!quando) setQuando(dataInicialDaAprovada(peca, melhorHora));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [melhorHora, melhores.isFetched]);
  useEffect(() => {
    if (escolhidos === null && perfis.data) setEscolhidos(perfisIniciais(perfis.data));
  }, [perfis.data, escolhidos]);

  const iso = quando ? zonedDateTimeLocalToIso(quando, EDITORIAL_DEFAULT_TIME_ZONE) : null;
  const problema = vaiPostar && quando ? problemaNoHorario(iso, new Date()) : null;
  const lista = perfis.data || [];
  const marcados = escolhidos || [];
  const semPerfil = vaiPostar && perfis.isSuccess && !marcados.length;

  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const l = atual || [];
      return l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : l.concat([id]);
    });

  const depois = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDasAprovadasSemData(clientId) });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes"] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "item-avulso"] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "peca-do-post"] });
    void queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
    onFeita();
  };

  const confirmar = async () => {
    setFazendo(true);
    try {
      if (!vaiPostar) {
        await dispensarPublicacao(peca.id);
        toast.success(`"${peca.titulo}" não vai ser postado.`, { description: "Fica em Arquivos. Dá para agendar depois em Publicar em." });
      } else {
        if (!iso || problema || !marcados.length) return;
        await confirmarPublicacao(peca.id, iso, false, marcados);
        toast.success(`Agendado para ${dataEHoraCurta(iso)}.`, { description: peca.titulo });
      }
      depois();
    } catch (e) {
      toast.error("Não foi possível", { description: textoDoErro(e) });
    } finally {
      setFazendo(false);
    }
  };

  const podeConfirmar = !fazendo && (!vaiPostar || (!!iso && !problema && !!marcados.length && !perfis.isLoading));
  const rodape = (
    <div className="flex w-full items-center justify-end">
      <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={onFechar} disabled={fazendo}>
        Depois
      </button>
      <button type="button" className={botao.primario} onClick={() => void confirmar()} disabled={!podeConfirmar} data-confirmar-aprovada="">
        {fazendo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-1.5 h-4 w-4" />}
        {vaiPostar ? "Agendar" : "Confirmar"}
      </button>
    </div>
  );

  return (
    <JanelaDoCelular aberta titulo={titulo || (total > 1 ? `Aprovado sem data · ${posicao} de ${total}` : "Aprovado sem data")} onFechar={onFechar} rodape={rodape}>
      <div className="space-y-4 text-[13px]" data-aprovada={peca.id}>
        <div className="flex min-w-0 items-start">
          <p className="min-w-0 flex-1 truncate font-medium">{peca.titulo}</p>
          <AjudaRecolhida className="ml-1 shrink-0" rotulo="Como funciona">
            Escolha a data, o horário e onde a peça sai. Aprovada pelo cliente, agenda na hora; ainda sem aprovação, fica marcada e sai
            nessa data depois que o cliente aprovar. O Instagram marcado como "publica sozinho" sai pelo painel; a página do Facebook fica
            na Agenda e a equipe posta. "Não vai postar" deixa a peça em Arquivos.
          </AjudaRecolhida>
        </div>

        <div role="radiogroup" aria-label="Vai postar?" className="flex items-center">
          <span className="mr-3 text-[13px] text-muted-foreground">Vai postar?</span>
          {[
            { v: true, r: "Sim" },
            { v: false, r: "Não" },
          ].map((o) => (
            <button
              key={o.r}
              type="button"
              role="radio"
              aria-checked={vaiPostar === o.v}
              onClick={() => setVaiPostar(o.v)}
              className={juntar(
                "mr-1 h-8 rounded-md px-3 text-[13px]",
                vaiPostar === o.v ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {o.r}
            </button>
          ))}
        </div>

        {vaiPostar && (
          <>
            <CampoDeFormulario rotulo="Data e hora" erro={problema || undefined}>
              <input type="datetime-local" className={campo} value={quando} onChange={(e) => setQuando(e.target.value)} disabled={fazendo} />
            </CampoDeFormulario>

            <fieldset className="min-w-0" aria-label="Onde publicar">
              <legend className="mb-1 text-[13px] text-muted-foreground">Onde</legend>
              {perfis.isLoading && (
                <p className="flex items-center text-[12px] text-muted-foreground">
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo os perfis…
                </p>
              )}
              {perfis.isError && <p className="text-[12px] text-destructive">{textoDoErro(perfis.error)}</p>}
              {perfis.isSuccess && !lista.length && (
                <p className="text-[12px] text-muted-foreground">Nenhum perfil ligado a esta marca. Ligue o Instagram na Agenda.</p>
              )}
              <ul className="space-y-1">
                {lista.map((p) => (
                  <li key={p.id}>
                    <label className="flex min-h-8 cursor-pointer items-center rounded-md px-1 hover:bg-muted">
                      <input
                        type="checkbox"
                        className="mr-2 h-4 w-4 shrink-0 accent-primary"
                        checked={marcados.indexOf(p.id) >= 0}
                        onChange={() => alternar(p.id)}
                        disabled={fazendo}
                        data-perfil={p.id}
                      />
                      <span className="min-w-0 flex-1 truncate">{rotuloDoPerfil(p)}</span>
                      <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                        {p.platform === "instagram" && p.automatico ? "publica sozinho" : "a equipe posta"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {semPerfil && <p className="mt-1 text-[12px] text-destructive">Escolha ao menos um perfil, ou marque que não vai postar.</p>}
            </fieldset>
          </>
        )}
      </div>
    </JanelaDoCelular>
  );
}
