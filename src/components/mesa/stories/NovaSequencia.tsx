import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Clapperboard, Flame, Megaphone, MessageCircleQuestion, Rocket, Sparkles, Star, Zap, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { campo, juntar, texto } from "@/components/sistema/estilos";
import { BotaoComCusto } from "../Custo";
import { useMarcaDaMesa, useMesa } from "../MesaContexto";
import { lerCampanhas, type Campanha } from "../mesaV4Api";
import { IconeDoAdesivo } from "./PreviaDoStory";
import {
  chamarStories,
  FASES_DA_CAMPANHA,
  gerarFotosNaturais,
  ROTULO_DO_ESTILO,
  type EstiloDaImagem,
  gerarImagensDosStories,
  gerarStoriesDaCampanha,
  hojeLocal,
  MODELO_DA_FASE,
  MODELOS_DE_SEQUENCIA,
  modeloPorChave,
  normalizarSequencia,
  normalizarStory,
  OBJETIVOS,
  partesDaEstimativaDosStories,
  ROTULO_DA_FASE,
  ROTULO_DO_PAPEL,
  somarDias,
  telasDaEstrutura,
  type FaseDaCampanha,
  type Sequencia,
  type Story,
} from "./storiesApi";

/**
 * Nova sequência (21/10/2026, dono: "algo que converte ... e que combine com
 * as campanhas"): o modelo (a sequência que converte e os prontos: lançamento,
 * bastidores, prova social, oferta relâmpago, enquete de engajamento,
 * tutorial; e a novela do dia de antes), a estrutura tela a tela, o dia, a
 * campanha e a fase. Um clique planeja e pede as imagens ao gerador, com o
 * custo total ao lado do botão antes de gastar.
 */

type Pedido = { data: string; modelo: string; telas: number; campanhaId: string; fase: FaseDaCampanha; pedido: string; objetivo: string; comImagens: boolean; estilo?: EstiloDaImagem };

const NOVELA = "novela";
const ICONES: Record<string, LucideIcon> = {
  conversao: Zap,
  lancamento: Rocket,
  bastidores: Clapperboard,
  prova_social: Star,
  oferta_relampago: Flame,
  enquete_engajamento: MessageCircleQuestion,
  tutorial: BookOpen,
  [NOVELA]: Megaphone,
};
const TELAS = [3, 4, 5, 6, 7, 8];

/** Campanhas da marca aberta (Acerbi e CME nunca se misturam). Função pura. */
export function campanhasDaMarca(lista: Campanha[], marcaId: string | null): Campanha[] {
  if (!marcaId) return lista;
  return lista.filter((c) => {
    const m = c.identidade && c.identidade.marca_id ? c.identidade.marca_id : null;
    return !m || m === marcaId;
  });
}

export default function NovaSequencia({
  clientId,
  onCriada,
}: {
  clientId: string;
  onCriada: (sequencia: Sequencia, stories: Story[]) => void;
}) {
  const { catalogo } = useMesa();
  const { marca } = useMarcaDaMesa();
  const marcaId = marca ? marca.id : null;
  const [p, setP] = useEstadoDaTela<Pedido>(
    `mesa:stories:nova-v2:${clientId}`,
    { data: somarDias(hojeLocal(), 1), modelo: "conversao", telas: 5, campanhaId: "", fase: "lancamento", pedido: "", objetivo: "engajar", comImagens: true },
    { validar: (v) => !!v && typeof (v as Pedido).data === "string" && typeof (v as Pedido).modelo === "string" && typeof (v as Pedido).telas === "number" },
  );
  const mudar = (m: Partial<Pedido>) => setP({ ...p, ...m });
  const campanhas = useQuery({ queryKey: ["mesa", "campanhas", clientId], queryFn: () => lerCampanhas(clientId), enabled: !!clientId, staleTime: 60_000, retry: 1 });
  const daMarca = useMemo(() => campanhasDaMarca(campanhas.data || [], marcaId), [campanhas.data, marcaId]);
  const campanha = p.campanhaId ? daMarca.filter((c) => c.id === p.campanhaId)[0] || null : null;
  const novela = p.modelo === NOVELA;
  const estilo: EstiloDaImagem = p.estilo === "destaque" ? "destaque" : "natural";
  const modelo = modeloPorChave(p.modelo);
  const estrutura = modelo ? telasDaEstrutura(modelo, p.telas) : [];
  const hoje = hojeLocal();
  const dataValida = p.data >= hoje;

  const criar = async () => {
    let sequencia: Sequencia;
    let stories: Story[];
    let custo = 0;
    const avisos: string[] = [];
    if (campanha && !novela) {
      const r = await gerarStoriesDaCampanha({
        clientId,
        campanhaId: campanha.id,
        temaId: null,
        fase: p.fase,
        quantidadeDeTelas: p.telas,
        modelo: p.modelo,
        data: p.data,
        pedido: p.pedido.trim() || null,
        confirmado: true,
        refazer: true,
        marcaId,
        nomeDaCampanha: campanha.nome,
        estilo,
      });
      if (r.situacao !== "pronta") throw new Error(r.mensagem);
      sequencia = r.sequencia;
      stories = r.stories;
      custo = r.custo_usd;
      avisos.push(...r.avisos);
    } else {
      const r = await chamarStories<{ sequencia: unknown; stories: unknown[]; avisos?: unknown[]; custo_usd?: number }>("planejar_sequencia", clientId, {
        data: p.data,
        quantidade: p.telas,
        ...(novela ? { objetivo: p.objetivo } : { modelo_da_sequencia: p.modelo }),
        estilo,
        ...(p.pedido.trim() ? { pedido: p.pedido.trim() } : {}),
      });
      sequencia = normalizarSequencia(r && r.sequencia);
      if (!sequencia.id) throw new Error("O agente não devolveu a sequência.");
      stories = (r && Array.isArray(r.stories) ? r.stories : []).map(normalizarStory).filter((s) => !!s.id);
      custo = Number(r && r.custo_usd) || 0;
      (r && Array.isArray(r.avisos) ? r.avisos : []).forEach((a) => typeof a === "string" && a && avisos.push(a));
      onCriada(sequencia, stories);
      if (p.comImagens && stories.length) {
        try {
          const img =
            estilo === "natural"
              ? await gerarFotosNaturais(clientId, stories.filter((s) => s.fundo.tipo === "natural"))
              : await gerarImagensDosStories({ clientId, titulo: sequencia.titulo, stories, campanha: null, marcaId });
          const novos: Record<string, Story> = {};
          img.stories.forEach((s) => (novos[s.id] = s));
          stories = stories.map((s) => novos[s.id] || s);
          custo += img.custo_usd;
          avisos.push(...img.avisos);
        } catch (e) {
          // O roteiro já foi gravado: a sequência fica e o Gerar imagens tenta de novo.
          toast.error("A sequência foi criada, mas as imagens não saíram", { description: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    onCriada(sequencia, stories);
    mudar({ pedido: "" });
    if (avisos.length) toast.message("Sequência criada com avisos", { description: avisos.join(" ") });
    return { custo_usd: custo };
  };

  return (
    <Secao
      titulo="Nova sequência"
      recolher={`mesa:stories:nova:${clientId}`}
      ajuda="Escolha o modelo: cada tela tem um papel (gancho, problema ou desejo, prova, oferta e CTA com adesivo) e a imagem sai do gerador do Estúdio em 9:16, com o texto integrado. Com campanha, o briefing, a identidade, o selo e a fase entram no roteiro e nas imagens."
    >
      <div className="grid min-w-0 grid-cols-2 gap-2 xl:grid-cols-4" role="radiogroup" aria-label="Modelo da sequência" data-modelos-de-sequencia="">
        {MODELOS_DE_SEQUENCIA.map((m) => ({ chave: m.chave, nome: m.nome, descricao: m.descricao }))
          .concat([{ chave: NOVELA, nome: "Novela do dia", descricao: "O capítulo do dia: gancho, interação e o gancho para amanhã." }])
          .map((m) => {
            const Icone = ICONES[m.chave] || Zap;
            const ativo = p.modelo === m.chave;
            return (
              <button
                key={m.chave}
                type="button"
                role="radio"
                aria-checked={ativo}
                onClick={() => mudar({ modelo: m.chave })}
                className={juntar(
                  "flex min-w-0 items-start rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ativo ? "border-primary bg-primary/[0.06]" : "border-border hover:border-primary/50",
                )}
                data-modelo={m.chave}
              >
                <Icone className={juntar("mr-2.5 mt-0.5 h-4 w-4 shrink-0", ativo ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                <span className="min-w-0">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{m.nome}</span>
                  <span className={juntar(texto.auxiliar, "mt-0.5 line-clamp-2 hidden sm:block")}>{m.descricao}</span>
                </span>
              </button>
            );
          })}
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center" data-estilo-da-sequencia={estilo}>
        <span className={juntar(texto.rotulo, "mb-1 mr-3")}>Imagens</span>
        <SeletorCompacto
          rotulo="Estilo das imagens"
          valor={estilo}
          onEscolher={(v) => mudar({ estilo: v === "destaque" ? "destaque" : "natural" })}
          opcoes={[
            { valor: "natural", rotulo: ROTULO_DO_ESTILO.natural },
            { valor: "destaque", rotulo: ROTULO_DO_ESTILO.destaque },
          ]}
        />
        <span className={juntar(texto.auxiliar, "mb-1 ml-3 min-w-0 flex-1 truncate")}>
          {estilo === "natural" ? "Foto do momento, de celular, com o texto do próprio Instagram" : "Arte de designer com a referência da campanha"}
        </span>
      </div>

      {estrutura.length ? (
        <ol className="mt-3 flex min-w-0 flex-wrap items-center" aria-label="Estrutura da sequência" data-estrutura="">
          {estrutura.map((t, i) => (
            <li key={i} className="mb-1 mr-1.5 inline-flex h-6 items-center rounded-full bg-muted px-2 text-[11px] font-medium text-foreground" data-papel={t.papel}>
              <span className="mr-1 tabular-nums text-muted-foreground">{i + 1}</span>
              {ROTULO_DO_PAPEL[t.papel]}
              {t.adesivo !== "nenhum" ? <IconeDoAdesivo tipo={t.adesivo} className="ml-1 h-3 w-3 text-muted-foreground" /> : null}
            </li>
          ))}
        </ol>
      ) : null}

      <div className="mt-3 grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-[150px_90px_minmax(0,200px)_minmax(0,150px)_minmax(0,1fr)] lg:items-end">
        <label className="min-w-0">
          <span className={texto.rotulo}>Dia</span>
          <input className={juntar(campo, "mt-1")} type="date" value={p.data} min={hoje} onChange={(e) => e.target.value && mudar({ data: e.target.value })} />
        </label>
        <label className="min-w-0">
          <span className={texto.rotulo}>Telas</span>
          <select className={juntar(campo, "mt-1")} value={p.telas} onChange={(e) => mudar({ telas: Number(e.target.value) })}>
            {TELAS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {novela ? (
          <label className="col-span-2 min-w-0 sm:col-span-1">
            <span className={texto.rotulo}>Objetivo</span>
            <select className={juntar(campo, "mt-1")} value={p.objetivo} onChange={(e) => mudar({ objetivo: e.target.value })}>
              {OBJETIVOS.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="col-span-2 min-w-0 sm:col-span-1">
            <span className={texto.rotulo}>Campanha</span>
            <select
              className={juntar(campo, "mt-1")}
              value={campanha ? campanha.id : ""}
              onChange={(e) => mudar({ campanhaId: e.target.value, ...(e.target.value ? { modelo: MODELO_DA_FASE[p.fase] } : {}) })}
            >
              <option value="">Sem campanha</option>
              {daMarca.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        {campanha && !novela ? (
          <label className="col-span-2 min-w-0 sm:col-span-1">
            <span className={texto.rotulo}>Fase</span>
            <select
              className={juntar(campo, "mt-1")}
              value={p.fase}
              onChange={(e) => {
                const fase = e.target.value as FaseDaCampanha;
                mudar({ fase, modelo: MODELO_DA_FASE[fase] });
              }}
            >
              {FASES_DA_CAMPANHA.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_DA_FASE[f]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={juntar("col-span-2 min-w-0", campanha && !novela ? "sm:col-span-1 lg:col-span-1" : "sm:col-span-1 lg:col-span-2")}>
          <span className={texto.rotulo}>Pedido (opcional)</span>
          <input className={juntar(campo, "mt-1")} value={p.pedido} onChange={(e) => mudar({ pedido: e.target.value })} placeholder="Ex.: o combo de sábado com entrega grátis" maxLength={2000} />
        </label>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center">
        {!campanha || novela ? (
          <label className={juntar(texto.corpo, "mb-1 mr-4 inline-flex items-center")}>
            <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={p.comImagens} onChange={(e) => mudar({ comImagens: e.target.checked })} />
            Já pedir as imagens ao gerador
          </label>
        ) : (
          <span className={juntar(texto.auxiliar, "mb-1 mr-4")}>Com a campanha, as imagens já saem na identidade dela</span>
        )}
        <span className="flex-1" />
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Criar a sequência
            </>
          }
          titulo="Sequência de stories"
          descricao={`Roteiro${(campanha && !novela) || p.comImagens ? ` e ${p.telas} ${estilo === "natural" ? "fotos naturais de story" : "artes 9:16 de designer"} pelo gerador` : ""}.`}
          partes={() => partesDaEstimativaDosStories(catalogo, p.telas, { comPlano: true, comImagens: (!!campanha && !novela) || p.comImagens, natural: estilo === "natural" })}
          executar={criar}
          disabled={!dataValida}
          className="mb-1"
        />
      </div>
    </Secao>
  );
}
