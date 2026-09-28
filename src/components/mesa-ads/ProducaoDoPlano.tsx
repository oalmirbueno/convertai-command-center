import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import CaminhoPronto from "@/components/agentes/CaminhoPronto";
import { custoDaResposta, ErroDaMesa, usd } from "@/lib/mesa/api";
import { foco, juntar } from "@/components/sistema/estilos";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import {
  caminhoDoEstudio,
  chamarAds,
  chavesAds,
  FORMATOS,
  formatosAutomaticos,
  partesDaCriacao,
  rotuloDoTom,
  tomDe,
  TONS_DO_CRIATIVO,
  type FormatoAds,
  type PlanoAds,
  type TomDoCriativo,
} from "./adsApi";
import { gerarKit, kitDoAngulo, partesDoKit } from "./acoesDoAgenteApi";
import { pedirArteDoPlano, type AndamentoDoLote } from "./loteDoEstudio";
import { resumoDoModelo, SeletorDoModeloDaCopy, useModeloDaCopy } from "./ModeloDaCopy";
import ProgressoComParada from "./ProgressoComParada";

/**
 * Criar criativos em um clique (frente CR, pedido do dono em 27/09: "do Plano
 * de teste ao criativo pronto no menor número de cliques; o sistema escolhe
 * estilo, formato e ângulo sozinho; o dono muda só se quiser, com um trocar
 * simples, sem formulário").
 *
 * - Ângulos: os marcados no plano (a conferência do Jev já marca os aprovados).
 * - Formatos: automáticos por ângulo (4:5 e 9:16; carrossel quando o ângulo
 *   pediu). Estilo: o do ângulo, escolhido pela ordem de resultado no servidor.
 * - Copy: no modelo escolhido (padrão GPT-6 Luna no raciocínio máximo); o
 *   servidor escreve a mais e o Jev escolhe as melhores.
 * - Um ângulo por chamada, com o andamento à vista e o botão Parar: o que já
 *   saiu fica, o resto não é escrito nem cobrado. No fim abre o Estúdio Ads e
 *   as artes começam sozinhas (custo já mostrado e confirmado no botão), com
 *   o andamento e o Parar de lá.
 */

/** Corpo de criativos_produzir: ângulos na ordem do plano, formatos na ordem da lista, tom e modelo quando vierem. */
export function corpoDaProducao(plano: PlanoAds, angulos: string[], formatos: FormatoAds[], tom?: TomDoCriativo | null, modelo?: Record<string, unknown>) {
  const corpo: { plano_id: string; angulo_ids: string[]; formatos: FormatoAds[]; tom?: TomDoCriativo } & Record<string, unknown> = {
    plano_id: plano.id,
    angulo_ids: plano.angulos.filter((a) => angulos.indexOf(a.id) >= 0).map((a) => a.id),
    formatos: FORMATOS.map((f) => f.valor).filter((f) => formatos.indexOf(f) >= 0),
  };
  if (tom) corpo.tom = tom;
  if (modelo) Object.keys(modelo).forEach((k) => (corpo[k] = modelo[k]));
  return corpo;
}

/** Seletor dos três tons (sóbrio, direto, agressivo), com a regra de cada um no título. */
export function SeletorDeTom({ valor, onMudar, rotulo = "Tom" }: { valor: TomDoCriativo; onMudar: (t: TomDoCriativo) => void; rotulo?: string }) {
  return (
    <div className="inline-flex h-9 min-w-0 max-w-full items-center rounded-md bg-muted p-0.5" role="radiogroup" aria-label={rotulo}>
      {TONS_DO_CRIATIVO.map((t) => (
        <button
          key={t.valor}
          type="button"
          role="radio"
          aria-checked={valor === t.valor}
          title={t.dica}
          onClick={() => onMudar(t.valor)}
          className={juntar(
            "inline-flex h-8 min-w-0 items-center justify-center whitespace-nowrap rounded px-3 text-[12.5px] font-medium transition-colors",
            valor === t.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            foco,
          )}
        >
          {t.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Texto curto dos formatos ("Feed 4:5 e Stories 9:16"). */
function textoDosFormatos(lista: FormatoAds[]): string {
  const rotulos = FORMATOS.filter((f) => lista.indexOf(f.valor) >= 0).map((f) => f.rotulo);
  if (rotulos.length <= 1) return rotulos[0] || "nenhum formato";
  return `${rotulos.slice(0, -1).join(", ")} e ${rotulos[rotulos.length - 1]}`;
}

/** O que criativos_produzir devolve e a tela usa. */
interface RespostaDaProducao {
  criativos?: { id?: unknown; angulo_id?: unknown }[];
  caminho?: { rotulo?: unknown; destino?: unknown } | null;
  custo_usd?: number;
}

interface FimDaCriacao {
  criados: number;
  feitos: number;
  total: number;
  parado: boolean;
  caminho: { rotulo: string; destino: string } | null;
}

export default function ProducaoDoPlano({ plano, marcados, onProduzido }: { plano: PlanoAds; marcados: string[]; onProduzido: (planoId: string) => void }) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const modelo = useModeloDaCopy();
  const tomDoPlano: TomDoCriativo = tomDe(plano.estrutura.tom) || "direto";
  const [tom, setTom] = useState<TomDoCriativo>(tomDoPlano);
  // null = automático por ângulo; a equipe troca só se quiser.
  const [formatosEscolhidos, setFormatosEscolhidos] = useState<FormatoAds[] | null>(null);
  const [comKit, setComKit] = useState(true);
  const [comArte, setComArte] = useState(true);
  const [trocando, setTrocando] = useState(false);
  const [andamento, setAndamento] = useState<AndamentoDoLote | null>(null);
  const [fim, setFim] = useState<FimDaCriacao | null>(null);
  const parar = useRef(false);

  useEffect(() => {
    setTom(tomDoPlano);
    setFormatosEscolhidos(null);
    setFim(null);
  }, [plano.id, tomDoPlano]);

  const angulos = plano.angulos.filter((a) => marcados.indexOf(a.id) >= 0);
  const formatosDo = (a: Pick<PlanoAds["angulos"][number], "formatos">): FormatoAds[] =>
    formatosEscolhidos && formatosEscolhidos.length ? FORMATOS.map((f) => f.valor).filter((f) => formatosEscolhidos.indexOf(f) >= 0) : formatosAutomaticos(a);
  const pecas = angulos.reduce((s, a) => s + (a.variacoes || 1) * formatosDo(a).length, 0);
  const formatosEmUso: FormatoAds[] = [];
  angulos.forEach((a) => formatosDo(a).forEach((f) => formatosEmUso.indexOf(f) < 0 && formatosEmUso.push(f)));
  const semKit = angulos.filter((a) => !kitDoAngulo(a)).map((a) => a.id);

  const gerarKits = (ids: string[]) => {
    void Promise.all(ids.map((id) => gerarKit(plano.id, id).then(() => true, () => false))).then((r) => {
      mesa.atualizarCusto();
      void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
      const ok = r.filter(Boolean).length;
      if (ok) toast.success(ok === 1 ? "Kit de recepção pronto" : `${ok} kits de recepção prontos`, { description: "No Estúdio Ads, embaixo do criativo, e no Plano de teste." });
      if (ok < r.length) toast.warning(`${r.length - ok} kit(s) não saíram`, { description: "Gere de novo pelo botão do ângulo." });
    });
  };

  /** Um ângulo por chamada; Parar vale antes do próximo. */
  const criar = async () => {
    const lista = angulos.slice();
    const formatosDaVez = lista.map((a) => formatosDo(a));
    const tomDaVez = tom !== tomDoPlano ? tom : null;
    const corpoDoModelo = modelo.corpo;
    parar.current = false;
    setFim(null);
    let custo = 0;
    const ids: string[] = [];
    const angulosFeitos: string[] = [];
    const falhas: unknown[] = [];
    let caminho: FimDaCriacao["caminho"] = null;
    let feitos = 0;
    setAndamento({ feitas: 0, total: lista.length, custo_usd: 0, atual: lista.length ? lista[0].nome : "", parando: false });
    try {
      for (let i = 0; i < lista.length; i++) {
        if (parar.current) break;
        const a = lista[i];
        setAndamento((x) => (x ? { ...x, atual: a.nome } : x));
        try {
          const data = await chamarAds<RespostaDaProducao>("criativos_produzir", corpoDaProducao(plano, [a.id], formatosDaVez[i], tomDaVez, corpoDoModelo));
          custo += custoDaResposta(data) || 0;
          const novos = data && Array.isArray(data.criativos) ? data.criativos : [];
          novos.forEach((c) => c && c.id && ids.push(String(c.id)));
          if (novos.length) angulosFeitos.push(a.id);
          if (data && data.caminho && typeof data.caminho.destino === "string") caminho = { rotulo: String(data.caminho.rotulo || "Abrir no Estúdio Ads"), destino: data.caminho.destino };
          void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
        } catch (e) {
          falhas.push(e);
          // Saldo, cota, chave ou modelo: os próximos ângulos falhariam igual.
          if (e instanceof ErroDaMesa && e.acao) break;
        }
        feitos = i + 1;
        mesa.atualizarCusto();
        setAndamento((x) => (x ? { ...x, feitas: i + 1, custo_usd: custo } : x));
      }
    } finally {
      setAndamento(null);
    }
    if (!ids.length && falhas.length) throw falhas[0];
    return { custo_usd: custo, ids, angulosFeitos, parado: parar.current, falhas, feitos, total: lista.length, caminho };
  };

  const aoCriar = (r: Awaited<ReturnType<typeof criar>>) => {
    void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
    void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
    const semKitFeitos = semKit.filter((id) => r.angulosFeitos.indexOf(id) >= 0);
    if (comKit && semKitFeitos.length) gerarKits(semKitFeitos);
    if (r.falhas.length) avisarErro(r.falhas[0], r.falhas.length === 1 ? "Um ângulo não saiu" : `${r.falhas.length} ângulos não saíram`);
    const caminho = r.caminho || caminhoDoEstudio(clientId, plano.id);
    if (r.parado) {
      toast.info("Criação parada", { description: `${r.ids.length} criativo(s) de ${r.angulosFeitos.length} ângulo(s) ficaram prontos. O resto não foi escrito nem cobrado.` });
      setFim({ criados: r.ids.length, feitos: r.feitos, total: r.total, parado: true, caminho });
      return;
    }
    toast.success("Criativos criados", {
      description: `${r.ids.length} criativo(s), copy por ${usd(r.custo_usd)}.${comArte && r.ids.length ? " As artes começam no Estúdio Ads, com o andamento e o Parar." : ""}`,
    });
    if (comArte && r.ids.length) pedirArteDoPlano(plano.id, r.ids);
    onProduzido(plano.id);
  };

  const alternarFormato = (f: FormatoAds) =>
    setFormatosEscolhidos((atual) => {
      const base = atual && atual.length ? atual : formatosEmUso;
      const nova = base.indexOf(f) >= 0 ? base.filter((x) => x !== f) : base.concat([f]);
      return nova.length ? nova : null;
    });

  const pedirParada = () => {
    parar.current = true;
    setAndamento((x) => (x ? { ...x, parando: true } : x));
  };

  // O resumo da produção numa frase (a linha trunca; o "?" e o title mostram inteiro).
  const resumoDaProducao = `${angulos.length} ângulo${angulos.length === 1 ? "" : "s"} · ${pecas} criativo${pecas === 1 ? "" : "s"} · ${formatosEscolhidos ? textoDosFormatos(formatosEmUso) : `${textoDosFormatos(formatosEmUso)} (automático)`} · tom ${rotuloDoTom(tom).toLowerCase()} · copy no ${resumoDoModelo(modelo.modelo, modelo.raciocinio)}${comKit ? " · com kit de recepção" : ""}${comArte ? "" : " · só a copy"}`;

  return (
    // 28/09 (frente AD4, dono: "não no meio"): a barra é o rodapé da coluna principal, fora da
    // região que rola (AbaPlano), colada embaixo e sem cobrir texto; antes era sticky dentro da
    // região, e o respiro de baixo da região a deixava flutuando no meio, por cima do ângulo.
    // Uma linha: o resumo trunca e o detalhe fica no "?". No celular fica no fim da página.
    <div className="shrink-0 border-t border-border bg-background py-2" role="group" aria-label="Produzir criativos" data-barra-de-producao="">
      <div className="flex min-w-0 items-center">
        {andamento ? (
          <ProgressoComParada
            className="mr-3 min-w-0 flex-1"
            rotulo="Escrevendo a copy"
            unidade={andamento.total === 1 ? "ângulo" : "ângulos"}
            feitas={andamento.feitas}
            total={andamento.total}
            atual={andamento.atual}
            custo={andamento.custo_usd}
            parando={andamento.parando}
            onParar={pedirParada}
          />
        ) : (
          <div className="mr-2 flex min-w-0 flex-1 items-center text-[12px] leading-5 text-muted-foreground" data-resumo-da-producao="">
            <p className="min-w-0 truncate" title={resumoDaProducao}>
              <span className="font-medium text-foreground">
                {angulos.length} ângulo{angulos.length === 1 ? "" : "s"}
              </span>
              {` · ${formatosEscolhidos ? textoDosFormatos(formatosEmUso) : `${textoDosFormatos(formatosEmUso)} (automático)`} · tom ${rotuloDoTom(tom).toLowerCase()} · copy no ${resumoDoModelo(modelo.modelo, modelo.raciocinio)}${comKit ? " · com kit de recepção" : ""}${comArte ? "" : " · só a copy"}`}
            </p>
            <AjudaRecolhida className="ml-1 shrink-0" rotulo="O que vai ser produzido">
              {resumoDaProducao}. Para cada ângulo marcado: a copy escrita a mais (o Jev escolhe a melhor), a direção de arte{comArte ? " e as artes no Estúdio Ads, com o andamento e o Parar" : ""}{comKit ? ", e o kit de recepção de quem ainda não tem" : ""}. Trocar muda formatos, tom, modelo da copy, artes e kit.
            </AjudaRecolhida>
            <button type="button" onClick={() => setTrocando((v) => !v)} aria-expanded={trocando} className={juntar("ml-1.5 shrink-0 rounded font-medium text-primary hover:underline", foco)}>
              {trocando ? "Pronto" : "Trocar"}
            </button>
          </div>
        )}
        <span className="ml-auto flex shrink-0 items-center">
          <span className="mr-2 whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
            {pecas} criativo{pecas === 1 ? "" : "s"}
          </span>
          <BotaoComCusto
            rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Criar criativos</>}
            titulo="Criar criativos"
            descricao={`Para cada ângulo: a copy no ${resumoDoModelo(modelo.modelo, modelo.raciocinio)} (escrita a mais, o Jev escolhe a melhor), a direção de arte${comArte ? " e as artes no Estúdio Ads" : ""}. Um ângulo por vez, com Parar.`}
            className="h-8"
            disabled={!angulos.length || pecas === 0 || andamento !== null}
            fecharAoConfirmar
            partes={() => partesDaCriacao(catalogo, modelo, angulos, formatosDo, comArte).concat(comKit && semKit.length ? partesDoKit(catalogo, semKit.length) : [])}
            executar={criar}
            aoConcluir={aoCriar}
          />
        </span>
      </div>

      {trocando && !andamento && (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-2" aria-label="Trocar a produção">
          <div className="min-w-0">
            <p className="mb-1 text-[11.5px] font-medium text-muted-foreground">Formatos</p>
            <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="Formatos">
              <button
                type="button"
                aria-pressed={!formatosEscolhidos}
                onClick={() => setFormatosEscolhidos(null)}
                className={juntar(
                  "mb-1 mr-1.5 inline-flex h-8 items-center rounded-full border px-2.5 text-[12px] transition-colors",
                  !formatosEscolhidos ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground",
                  foco,
                )}
              >
                {!formatosEscolhidos && <Check className="mr-1 h-3 w-3" />}
                Automático
              </button>
              {FORMATOS.map((f) => {
                const ativo = !!formatosEscolhidos && formatosEscolhidos.indexOf(f.valor) >= 0;
                return (
                  <button
                    key={f.valor}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => alternarFormato(f.valor)}
                    className={juntar(
                      "mb-1 mr-1.5 inline-flex h-8 items-center rounded-full border px-2.5 text-[12px] transition-colors",
                      ativo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground",
                      foco,
                    )}
                  >
                    {ativo && <Check className="mr-1 h-3 w-3" />}
                    {f.rotulo}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11.5px] font-medium text-muted-foreground">Tom</p>
            <SeletorDeTom valor={tom} onMudar={setTom} rotulo="Tom dos criativos" />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11.5px] font-medium text-muted-foreground">Modelo da copy</p>
            <SeletorDoModeloDaCopy estado={modelo} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center">
            <label className="mb-1 mr-4 inline-flex items-center text-[12px] text-muted-foreground" title="As artes começam no Estúdio Ads assim que a copy sai, com o andamento e o Parar">
              <input type="checkbox" className="mr-1.5" checked={comArte} onChange={(e) => setComArte(e.target.checked)} />
              Gerar as artes junto
            </label>
            <label className="mb-1 inline-flex items-center text-[12px] text-muted-foreground" title="O post que recebe quem veio do anúncio e o roteiro de atendimento e vendas de cada ângulo">
              <input type="checkbox" className="mr-1.5" checked={comKit} onChange={(e) => setComKit(e.target.checked)} />
              Com o kit de recepção
            </label>
          </div>
        </div>
      )}

      {fim && !andamento && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center border-t border-border pt-2" aria-label="Resultado da criação">
          <p className="mb-1 mr-2 min-w-0 flex-1 text-[12px] text-muted-foreground">
            {fim.parado ? `Parado em ${fim.feitos} de ${fim.total} ângulos: ${fim.criados} criativo(s) prontos para a arte.` : `${fim.criados} criativo(s) criados.`}
          </p>
          <CaminhoPronto caminho={fim.caminho} />
        </div>
      )}
    </div>
  );
}
