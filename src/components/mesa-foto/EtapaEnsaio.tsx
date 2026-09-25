import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera as IconeCamera, ClipboardCheck, Loader2, Lock, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo, SeletorDeQualidade } from "@/components/mesa/Seletores";
import { estimarLocal, padraoPara, usd, type Qualidade } from "@/lib/mesa/api";
import { AndamentoDoLote, BotaoDoLote } from "./AndamentoDoLote";
import { SeletorDaCampanha, useCampanhaEscolhida } from "./CampanhaDaMesa";
import { DecisaoRapida, MenuDeUso } from "./UsoDaFoto";
import { Cartao, ListaCurta, MiniaturaDaFoto, Moldura, Pilulas, useMesaFoto, Vazio } from "./Comuns";
import { geraNoLote, useLote } from "./lote";
import SeletorDeGuia from "./SeletorDeGuia";
import {
  AZIMUTES,
  chaveDosEnsaios,
  editarTomada,
  ELEVACOES,
  ENQUADRAMENTOS,
  ESTADOS_DA_TOMADA,
  ehCampanha,
  FINALIDADES,
  fotoDaVersao,
  FORMATOS,
  gerarTomada,
  guardarEnsaio,
  invalidarFotos,
  limitarQuantidade,
  MODOS_DA_FOTO,
  mudaAVista,
  nomeDaReceita,
  partesDaGeracao,
  partesDoPlanejamento,
  partesDoPlanoDeLote,
  planejarEnsaio,
  planejarVariacoes,
  proporcaoDoFormato,
  RECEITAS_COM_TELA_PROPRIA,
  receitaServeParaKit,
  resumoDoEnsaio,
  rotuloDaCamera,
  rotuloDoEstadoDoEnsaio,
  rotuloDoPapel,
  rotuloDoTipo,
  rotuloDoTipoDeVariacao,
  TIPOS_DE_VARIACAO,
  useEnsaios,
  useFotos,
  useKits,
  useReceitas,
  type Camera,
  type Ensaio,
  type Guia,
  type KitDeFoto,
  type Receita,
  type Tomada,
} from "./fotoApi";

/**
 * Criar > Variações (?etapa=ensaio): o diretor de fotografia monta as fotos a partir do produto (kit),
 * da receita e do contexto do cliente. Tomada que pede evidência que o kit
 * não tem vem bloqueada, com o motivo (tomada_editar confere de novo depois
 * que o kit foi completado). A câmera se escolhe por botões (ângulo, altura,
 * enquadramento) e vai em tomada_gerar, que a grava na tomada. Cada tomada
 * gera uma vez, com o custo antes; sem laço de correção automática: refazer
 * pede uma variação nova. Tomada presa em "gerando" há mais de 6 minutos
 * aparece como falhou e pode gerar de novo.
 *
 * v2: o jeito direto é "Variações" (variacoes_planejar): quantas fotos e de
 * que tipos, e o diretor monta N tomadas realmente diferentes. A receita
 * continua em "Por receita". Gerar todas vai em lote (lote.ts): total antes,
 * uma por vez, andamento por foto, dá para sair e voltar.
 *
 * 25/09 (pedido do dono): o resultado fica numa caixa com rolagem própria,
 * organizado por tipo, em cartões menores; cada foto aprova, rejeita, refaz e
 * tem o menu Usar ali mesmo (revisar embutido). A campanha da Mesa (a do mês
 * vem marcada) vai no plano.
 */

const QUANTIDADES_DE_VARIACAO = [4, 6, 8, 12, 16].map((n) => ({ valor: n, rotulo: `${n} fotos` }));
const TIPOS_PADRAO = ["heroi_fundo_cor", "fundo_branco", "lifestyle", "na_mao", "flat_lay", "macro", "cenario_marca", "flutuando"];

type ModoDoNovo = "variacoes" | "receita";

function ResumoDoKit({ kit }: { kit: KitDeFoto }) {
  const { clientId } = useMesa();
  const fotos = useFotos(clientId);
  const todas = fotos.data || [];
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border bg-background p-3" data-resumo-do-kit="">
      <div className="flex min-w-0 flex-wrap">
        {kit.refs.slice(0, 8).map((r) => {
          const f = todas.find((x) => x.id === r.imagem_id);
          return (
            <div key={`${r.imagem_id}-${r.papel}`} className="mb-1 mr-1 w-12" title={rotuloDoPapel(r.papel)}>
              {f ? <MiniaturaDaFoto foto={f} selo={false} /> : <div className="h-12 w-12 rounded-lg bg-muted" />}
              <span className="block truncate text-center text-[9.5px] text-muted-foreground">{rotuloDoPapel(r.papel)}</span>
            </div>
          );
        })}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <ListaCurta titulo="Não pode mudar" itens={kit.invariantes} vazio="Nada escrito." />
        <ListaCurta titulo="Lacunas: tomadas que dependem delas ficam bloqueadas" itens={kit.lacunas} vazio="Nenhuma lacuna escrita." tom="alerta" />
      </div>
    </div>
  );
}

function NovoEnsaio({ kits, onPlanejado }: { kits: KitDeFoto[]; onPlanejado: (e: Ensaio) => void }) {
  const { clientId, catalogo } = useMesa();
  const { kitId, escolherKit, irPara } = useMesaFoto();
  const receitas = useReceitas();
  const kit = kitId ? kits.find((k) => k.id === kitId) || null : null;
  // Campanha tem tela própria: não entra na grade de receitas.
  const lista = useMemo(() => (receitas.data ? receitas.data.receitas.filter((r) => RECEITAS_COM_TELA_PROPRIA.indexOf(r.id) < 0) : []), [receitas.data]);
  const [modo, setModo] = useState<ModoDoNovo>("variacoes");
  const [quantidade, setQuantidade] = useState(8);
  const [tiposEscolhidos, setTiposEscolhidos] = useState<string[]>(TIPOS_PADRAO);
  const combinam = lista.filter((r) => receitaServeParaKit(r, kit ? kit.tipo : null));
  const outras = lista.filter((r) => combinam.indexOf(r) < 0);
  const [receitaId, setReceitaId] = useState<string>("");
  const receita: Receita | null = lista.find((r) => r.id === receitaId) || combinam[0] || null;
  const [fora, setFora] = useState<string[]>([]);
  const [finalidade, setFinalidade] = useState("catalogo");
  const [formatos, setFormatos] = useState<string[]>(["1:1", "4:5"]);
  const [pedido, setPedido] = useState("");
  const campanha = useCampanhaEscolhida();
  // "fora" guarda ids de tomada da receita: é o que ensaio_planejar aceita em tomadas_pedidas.
  const tomadas = receita ? receita.tomadas.filter((t) => fora.indexOf(t.id) < 0) : [];

  const idDaReceita = receita ? receita.id : null;
  useEffect(() => setFora([]), [idDaReceita]);

  const alternarFormato = (f: string) => setFormatos((l) => (l.indexOf(f) >= 0 ? (l.length > 1 ? l.filter((x) => x !== f) : l) : l.concat([f])));

  if (!kits.length) {
    return (
      <Vazio
        titulo="Primeiro, o produto"
        acao={
          <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => irPara("acervo")}>
            Identificar o produto nas fotos
          </Button>
        }
      >
        As variações partem das fotos que provam como o produto é. Sem produto, não há o que preservar.
      </Vazio>
    );
  }

  const imagem = padraoPara(catalogo, "imagem");
  // Todos os tipos escolhidos vão: com menos fotos que tipos, o diretor escolhe os que mais servem.
  const tipos = tiposEscolhidos;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <Pilulas
          rotulo="Como montar"
          opcoes={[
            { valor: "variacoes" as ModoDoNovo, rotulo: "Variações", dica: "Quantas fotos e de que tipos" },
            { valor: "receita" as ModoDoNovo, rotulo: "Por receita", dica: "Tomadas de uma receita pronta por categoria" },
          ]}
          valor={modo}
          onEscolher={setModo}
        />
        <Cartao titulo="Produto">
          <Select value={kit && kit.id ? kit.id : ""} onValueChange={(v) => escolherKit(v)}>
            <SelectTrigger className="h-9 min-w-0 text-[12.5px]" aria-label="Produto das variações">
              <SelectValue placeholder="Escolha o produto" />
            </SelectTrigger>
            <SelectContent>
              {kits.map((k) => (
                <SelectItem key={String(k.id)} value={String(k.id)}>
                  {k.nome} · {rotuloDoTipo(k.tipo)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {kit && (
            <div className="mt-3">
              <ResumoDoKit kit={kit} />
            </div>
          )}
        </Cartao>
        <SeletorDaCampanha escolhida={campanha} />

        {modo === "variacoes" && (
          <Cartao titulo="Variações" dica="Quantas fotos e de que tipos. Cada uma sai realmente diferente: câmera, cenário e luz próprios.">
            <Pilulas rotulo="Quantas fotos" opcoes={QUANTIDADES_DE_VARIACAO} valor={quantidade} onEscolher={(n) => setQuantidade(limitarQuantidade(n))} />
            <p className="mb-1 mt-2 text-[11.5px] text-muted-foreground">Tipos (toque para tirar ou pôr)</p>
            <div className="flex min-w-0 flex-wrap" role="group" aria-label="Tipos de variação">
              {TIPOS_DE_VARIACAO.map((t) => {
                const dentro = tiposEscolhidos.indexOf(t.valor) >= 0;
                return (
                  <button
                    key={t.valor}
                    type="button"
                    aria-pressed={dentro}
                    onClick={() => setTiposEscolhidos((l) => (dentro ? l.filter((x) => x !== t.valor) : l.concat([t.valor])))}
                    className={`mb-1.5 mr-1.5 h-7 max-w-full truncate rounded-full border px-2.5 text-[12px] ${dentro ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground"}`}
                  >
                    {t.rotulo}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {!tiposEscolhidos.length
                ? "Sem tipo escolhido, o diretor escolhe pelo produto e pela marca."
                : quantidade > tiposEscolhidos.length
                  ? `Com ${tiposEscolhidos.length} tipos e ${quantidade} fotos, o diretor repete tipos com cena diferente.`
                  : quantidade < tiposEscolhidos.length
                    ? `Com ${quantidade} fotos e ${tiposEscolhidos.length} tipos, o diretor escolhe os que mais servem ao produto.`
                    : "Uma foto de cada tipo."}
            </p>
          </Cartao>
        )}

        {modo === "receita" && (
          <Cartao titulo="Receita" dica={receitas.data && receitas.data.fonte === "local" ? "Receitas da pesquisa (a função ainda não respondeu)." : "Direção fotográfica pronta por categoria."}>
            {receitas.isLoading && (
              <p className="flex items-center text-[12px] text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo as receitas...
              </p>
            )}
            <div role="radiogroup" aria-label="Receita" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              {combinam.concat(outras).map((r) => {
                const ativa = receita ? receita.id === r.id : false;
                const combina = combinam.indexOf(r) >= 0;
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={ativa}
                    onClick={() => setReceitaId(r.id)}
                    className={`min-w-0 rounded-lg border px-3 py-2 text-left transition-colors ${ativa ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"} ${combina ? "" : "opacity-60"}`}
                  >
                    <span className="block truncate text-[12.5px] font-semibold">{r.nome}</span>
                    <span className="block text-[11.5px] leading-snug text-muted-foreground">{r.direcao}</span>
                    <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                      {r.tomadas.length} tomadas{combina ? "" : " · outro tipo de assunto"}
                    </span>
                  </button>
                );
              })}
            </div>
            {receita && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11.5px] text-muted-foreground">Tomadas (toque para tirar):</p>
                <div className="flex min-w-0 flex-wrap">
                  {receita.tomadas.map((t) => {
                    const dentro = fora.indexOf(t.id) < 0;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={dentro}
                        onClick={() => setFora((l) => (dentro ? l.concat([t.id]) : l.filter((x) => x !== t.id)))}
                        className={`mb-1.5 mr-1.5 h-7 max-w-full truncate rounded-full border px-2.5 text-[12px] ${dentro ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground line-through"}`}
                      >
                        {t.nome}
                      </button>
                    );
                  })}
                </div>
                {receita.atributos_criticos.length > 0 && <p className="text-[11.5px] text-muted-foreground">Conferência olha: {receita.atributos_criticos.join(", ")}.</p>}
              </div>
            )}
          </Cartao>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        {modo === "variacoes" && (
          <Cartao titulo="Montar">
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-muted-foreground">Pedido ao diretor (opcional)</span>
              <div className="relative">
                <Textarea value={pedido} onChange={(e) => setPedido(e.target.value)} rows={3} placeholder="Ex.: fundo verde da marca, mesa de escritório clara" className="pr-10 text-[12.5px]" aria-label="Pedido das variações" />
                <Ditado valor={pedido} onChange={setPedido} className="absolute bottom-1.5 right-1.5" />
              </div>
            </label>
            <BotaoComCusto
              rotulo={
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Planejar {quantidade} variações
                </>
              }
              titulo="Variações planejadas"
              descricao="O diretor monta as tomadas com o produto e a marca. Nenhuma imagem é gerada agora: o total para gerar aparece antes."
              className="mt-3 h-9 w-full text-[12.5px]"
              disabled={!kit || !kit.id}
              partes={() => partesDoPlanoDeLote(catalogo)}
              executar={() => planejarVariacoes({ clientId, kitId: String(kit && kit.id), quantidade, tipos, pedido, campanhaId: campanha.campanhaId })}
              aoConcluir={(data) => {
                if (data && data.ensaio) onPlanejado(data.ensaio);
                if (data && data.estimativa_usd !== null && data.estimativa_usd !== undefined) {
                  toast.info(`Gerar todas: cerca de ${usd(data.estimativa_usd)}`, { description: "O botão Gerar todas mostra o total antes." });
                }
              }}
            />
            {imagem && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Depois, gerar as {quantidade} fotos custa perto de <EstimativaDoLote modeloId={imagem.id} quantidade={quantidade} />.
              </p>
            )}
            {!kit && <p className="mt-2 text-[11.5px] text-muted-foreground">Escolha o produto.</p>}
            {campanha.campanha && <p className="mt-2 text-[11px] text-muted-foreground">Dentro da campanha {campanha.campanha.nome}.</p>}
          </Cartao>
        )}
        {modo === "receita" && (
          <Cartao titulo="Para quê">
            <Pilulas rotulo="Finalidade" opcoes={FINALIDADES} valor={finalidade} onEscolher={setFinalidade} />
            <p className="mb-1 mt-2 text-[11.5px] text-muted-foreground">Formatos</p>
            <div className="flex min-w-0 flex-wrap" role="group" aria-label="Formatos">
              {FORMATOS.map((f) => (
                <button
                  key={f.valor}
                  type="button"
                  aria-pressed={formatos.indexOf(f.valor) >= 0}
                  onClick={() => alternarFormato(f.valor)}
                  className={`mb-1.5 mr-1.5 h-7 rounded-full border px-2.5 text-[12px] ${formatos.indexOf(f.valor) >= 0 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
            <label className="mt-2 block">
              <span className="mb-1 block text-[11.5px] text-muted-foreground">Pedido ao diretor (opcional)</span>
              <div className="relative">
                <Textarea value={pedido} onChange={(e) => setPedido(e.target.value)} rows={3} placeholder="Ex.: clima de escritório claro, espaço para texto à direita" className="pr-10 text-[12.5px]" aria-label="Pedido ao diretor" />
                <Ditado valor={pedido} onChange={setPedido} className="absolute bottom-1.5 right-1.5" />
              </div>
            </label>
            <BotaoComCusto
              rotulo={
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Planejar {tomadas.length} {tomadas.length === 1 ? "tomada" : "tomadas"}
                </>
              }
              titulo="Ensaio planejado"
              descricao="O diretor de fotografia monta as fotos com o produto, a receita, a campanha da Mesa e o contexto do cliente. Nenhuma imagem é gerada agora."
              className="mt-3 h-9 w-full text-[12.5px]"
              disabled={!kit || !kit.id || !receita || tomadas.length === 0 || !receitaServeParaKit(receita, kit.tipo)}
              partes={() => partesDoPlanejamento(catalogo)}
              executar={() =>
                planejarEnsaio({
                  clientId,
                  kitId: String(kit && kit.id),
                  receitaId: receita ? receita.id : "",
                  finalidade,
                  formatos,
                  pedido,
                  tomadasPedidas: fora.length ? tomadas.map((t) => t.id) : [],
                  campanhaId: campanha.campanhaId,
                })
              }
              aoConcluir={(data) => {
                if (data && data.ensaio) onPlanejado(data.ensaio);
                if (data && data.estimativa_usd !== null && data.estimativa_usd !== undefined) {
                  toast.info(`Gerar todas as tomadas: cerca de ${usd(data.estimativa_usd)}`, { description: "O custo de cada tomada aparece no botão antes de gerar." });
                }
              }}
            />
            {!kit && <p className="mt-2 text-[11.5px] text-muted-foreground">Escolha o produto.</p>}
            {kit && receita && !receitaServeParaKit(receita, kit.tipo) && (
              <p className="mt-2 text-[11.5px] text-warning">A receita {receita.nome} não serve para kit de {rotuloDoTipo(kit.tipo).toLowerCase()} (produto deste tipo). Escolha uma receita em destaque.</p>
            )}
          </Cartao>
        )}
      </div>
    </div>
  );
}

/** O total de gerar N fotos, em linha (conta local com o catálogo). */
function EstimativaDoLote({ modeloId, quantidade }: { modeloId: string; quantidade: number }) {
  const { catalogo } = useMesa();
  const valor = estimarLocal(partesDaGeracao(modeloId, "alta", quantidade), catalogo);
  return <span className="font-medium text-foreground">{valor === null ? "sem estimativa" : usd(valor)}</span>;
}

/**
 * Câmera por botões. A escolha fica na tela até gerar: tomada_gerar leva a
 * câmera e a função a grava na tomada (modo e bloqueio recalculados lá).
 * "Câmera do plano" volta para a câmera que o diretor planejou.
 */
function SeletorDeCamera({
  camera,
  planejada,
  onMudar,
  disabled,
}: {
  camera: Camera | null;
  planejada: Camera | null;
  onMudar: (c: Camera | null) => void;
  disabled?: boolean;
}) {
  const base: Camera = camera || planejada || { azimute: 0, elevacao: 0, enquadramento: "medio" };
  return (
    <div className={`min-w-0 space-y-1.5 ${disabled ? "pointer-events-none opacity-60" : ""}`} data-camera="">
      <div className="flex min-w-0 flex-wrap items-center">
        <button
          type="button"
          aria-pressed={!camera}
          onClick={() => onMudar(null)}
          className={`mb-1.5 mr-1.5 h-7 rounded-full border px-2.5 text-[11.5px] ${!camera ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
        >
          Câmera do plano
        </button>
        <span className="mb-1.5 text-[11px] text-muted-foreground">ou escolha:</span>
      </div>
      <Pilulas rotulo="Ângulo" opcoes={AZIMUTES.map((a) => ({ valor: a.graus, rotulo: a.rotulo }))} valor={base.azimute} onEscolher={(v) => onMudar({ ...base, azimute: v })} />
      <Pilulas rotulo="Altura da câmera" opcoes={ELEVACOES.map((e) => ({ valor: e.graus, rotulo: e.rotulo }))} valor={base.elevacao} onEscolher={(v) => onMudar({ ...base, elevacao: v })} />
      <Pilulas rotulo="Enquadramento" opcoes={ENQUADRAMENTOS} valor={base.enquadramento} onEscolher={(v) => onMudar({ ...base, enquadramento: v })} />
    </div>
  );
}

function CartaoDaTomada({
  ensaio,
  tomada,
  camera,
  onCamera,
  gerando,
  modeloId,
  qualidade,
  onGerar,
  onAmpliar,
}: {
  ensaio: Ensaio;
  tomada: Tomada;
  /** Câmera escolhida na tela (null: a do plano). */
  camera: Camera | null;
  onCamera: (c: Camera | null) => void;
  gerando: boolean;
  modeloId: string;
  qualidade: Qualidade;
  onGerar: () => Promise<any>;
  onAmpliar: (caminho: string) => void;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { ensaioId } = useMesaFoto();
  const fotos = useFotos(clientId);
  const [abrirCamera, setAbrirCamera] = useState(false);
  const [detalhes, setDetalhes] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const ultima = tomada.versoes.length ? tomada.versoes[tomada.versoes.length - 1] : null;
  const aprovadaV = tomada.versoes.find((v) => v.aprovada) || null;
  const bloqueada = tomada.status === "bloqueada";
  const aprovada = !!aprovadaV;
  // "gerando" gravado pela função (outra aba ou outra pessoa) também trava o botão.
  const emGeracao = gerando || tomada.status === "gerando";
  const estado = emGeracao ? ESTADOS_DA_TOMADA.gerando : ESTADOS_DA_TOMADA[tomada.status] || ESTADOS_DA_TOMADA.pendente;
  const angulo = camera ? mudaAVista(camera) : tomada.modo === "angulo";
  const mostrada = aprovadaV || ultima;
  const pendente = !aprovada && ultima && !ultima.rejeitada && ultima.storage_path ? ultima : null;
  const fotoAprovada = aprovadaV ? fotoDaVersao(fotos.data || [], aprovadaV) : null;

  /** tomada_editar sem mudar nada: a função remonta a tomada com o kit de agora e recalcula o bloqueio. */
  const conferirDeNovo = async () => {
    if (!ensaioId) return;
    setConferindo(true);
    try {
      const r = await editarTomada(ensaioId, tomada.id, { nome: tomada.nome });
      if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
      const nova = r.tomada;
      if (nova && nova.status !== "bloqueada") toast.success("Tomada liberada", { description: "O produto agora tem a evidência que faltava." });
      else toast.info("Ainda bloqueada", { description: (nova && nova.motivo_bloqueio) || tomada.motivo_bloqueio || "Falta evidência no produto." });
    } catch (e) {
      avisarErro(e, "Não conferida");
    } finally {
      setConferindo(false);
    }
  };
  return (
    <li className={`min-w-0 rounded-xl border bg-card p-2 ${aprovada ? "border-success/50" : "border-border"}`} data-tomada={tomada.id}>
      <div className="relative min-w-0">
        {mostrada && mostrada.storage_path ? (
          <button type="button" className="block w-full cursor-zoom-in" onClick={() => mostrada.storage_path && onAmpliar(mostrada.storage_path)} aria-label={`Ver grande: ${tomada.nome}`}>
            <Moldura proporcao={proporcaoDoFormato(tomada.formato)} className="border border-border">
              <div className="h-full w-full" style={emGeracao ? { filter: "blur(10px)", WebkitFilter: "blur(10px)" } : undefined}>
                <ImagemDaMesa caminho={mostrada.storage_path} alt={`${tomada.nome}, versão ${mostrada.versao}`} className="h-full w-full !object-contain" />
              </div>
              <span className="pointer-events-none absolute left-1 top-1 rounded-full border border-primary/30 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary" data-selo="gerada">
                gerada
              </span>
            </Moldura>
          </button>
        ) : (
          <Moldura proporcao={proporcaoDoFormato(tomada.formato)} className="border border-dashed border-border">
            <span className="flex h-full w-full items-center justify-center p-1 text-center text-[10.5px] text-muted-foreground">
              {bloqueada ? <Lock className="h-4 w-4" /> : <IconeCamera className="h-4 w-4" />}
            </span>
          </Moldura>
        )}
        {emGeracao && (
          <span className="absolute inset-0 flex items-center justify-center" aria-live="polite">
            <span className="inline-flex items-center rounded-full bg-card px-2 py-1 text-[11px] font-medium shadow-sm">
              <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Gerando
            </span>
          </span>
        )}
      </div>
      <div className="mt-1.5 min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center">
          <p className="mr-1.5 min-w-0 truncate text-[12.5px] font-semibold" title={tomada.nome}>
            {tomada.nome}
          </p>
          <span className={`mr-1 rounded-full px-1.5 py-px text-[10px] font-medium ${estado.cor}`}>{estado.rotulo}</span>
          {mostrada && <span className="text-[10.5px] text-muted-foreground">v{mostrada.versao}</span>}
        </div>
        {bloqueada && (
          <p className="flex items-start rounded-lg bg-warning/10 px-2 py-1.5 text-[11.5px] leading-snug">
            <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {tomada.motivo_bloqueio || "Falta evidência no produto para esta foto."} Complete o produto para liberar.{" "}
              {ensaioId && (
                <button type="button" className="font-medium text-primary hover:underline disabled:opacity-60" onClick={() => void conferirDeNovo()} disabled={conferindo}>
                  {conferindo ? "Conferindo..." : "Já completei, conferir de novo"}
                </button>
              )}
            </span>
          </p>
        )}
        {tomada.status === "falhou" && !gerando && (
          <p className="flex items-start rounded-lg bg-destructive/10 px-2 py-1.5 text-[11.5px] leading-snug" data-falhou="">
            <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{tomada.ultimo_erro || "A geração falhou."} Pode gerar de novo.</span>
          </p>
        )}
        {ultima && ultima.rejeitada && !aprovada && ultima.motivo_rejeicao && (
          <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">Rejeitada: {ultima.motivo_rejeicao}</p>
        )}
        {angulo && !aprovada && (
          <p className="text-[11px] leading-snug text-primary">Novo ângulo: partes que não aparecem nas fotos serão criadas. Fica marcada como gerada, sem garantia de fidelidade.</p>
        )}
        <div className="flex min-w-0 flex-wrap items-center">
          <button type="button" className="mr-3 text-[11.5px] text-muted-foreground hover:text-foreground" onClick={() => setDetalhes(!detalhes)} aria-expanded={detalhes}>
            {detalhes ? "Menos" : "Detalhes"}
          </button>
          {!bloqueada && !aprovada && (
            <button type="button" className="text-[11.5px] font-medium text-primary hover:underline" onClick={() => setAbrirCamera(!abrirCamera)} aria-expanded={abrirCamera}>
              {abrirCamera ? "Fechar câmera" : "Mudar a câmera"}
            </button>
          )}
        </div>
        {detalhes && (
          <div className="space-y-0.5 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            <p>
              {rotuloDaCamera(camera || tomada.camera)} · {tomada.formato} ·{" "}
              <span title={MODOS_DA_FOTO[tomada.modo].dica}>{MODOS_DA_FOTO[tomada.modo].rotulo}</span>
            </p>
            {tomada.luz && <p>Luz: {tomada.luz}</p>}
            {tomada.cenario && <p>Cenário: {tomada.cenario}</p>}
            {tomada.invariantes.length > 0 && <p>Fica: {tomada.invariantes.join(", ")}.</p>}
            {tomada.pode_mudar.length > 0 && <p>Pode mudar: {tomada.pode_mudar.join(", ")}.</p>}
          </div>
        )}
        {abrirCamera && !bloqueada && !aprovada && <SeletorDeCamera camera={camera} planejada={tomada.camera} onMudar={onCamera} disabled={emGeracao} />}
        <div className="flex min-w-0 flex-wrap items-center pt-0.5">
          {pendente && !emGeracao && <DecisaoRapida ensaio={ensaio} tomada={tomada} versao={pendente} compacta />}
          {!bloqueada && !aprovada && (
            <BotaoComCusto
              rotulo={
                ultima ? (
                  <>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {pendente ? "Refazer" : "Nova variação"}
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar
                  </>
                )
              }
              titulo={ultima ? "Variação gerada" : "Tomada gerada"}
              descricao="Gera uma versão desta foto, uma vez. Refazer pede uma variação nova; as versões antigas ficam."
              variant={ultima ? "outline" : "default"}
              className="mb-1 mr-1 h-8 text-[12px]"
              disabled={emGeracao || !modeloId}
              partes={() => partesDaGeracao(modeloId, qualidade)}
              executar={onGerar}
            />
          )}
          {aprovadaV && fotoAprovada && <MenuDeUso foto={fotoAprovada} className="mb-1" />}
          {pendente && !emGeracao && <MenuDeUso pendente={{ ensaio, tomada, versao: pendente }} variante="ghost" className="mb-1" />}
        </div>
      </div>
    </li>
  );
}

/** Filtro do resultado: o que falta gerar, o que espera revisão, o que está pronto. */
type FiltroDoResultado = "todas" | "gerar" | "revisar" | "prontas";

function EnsaioAberto({ ensaio, kit }: { ensaio: Ensaio; kit: KitDeFoto | null }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const { irPara } = useMesaFoto();
  const receitas = useReceitas();
  const receita = receitas.data ? receitas.data.receitas.find((r) => r.id === ensaio.receita_id) || null : null;
  const padrao = padraoPara(catalogo, "imagem");
  const [modeloId, setModeloId] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [guia, setGuia] = useState<Guia>({ modo: "nenhum" });
  const [cameras, setCameras] = useState<Record<string, Camera | null>>({});
  const [gerando, setGerando] = useState<Record<string, boolean>>({});
  const [filtro, setFiltro] = useState<FiltroDoResultado>("todas");
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const lote = useLote(ensaio.id);
  const modelo = modeloId || (padrao ? padrao.id : "");
  const resumo = resumoDoEnsaio(ensaio);
  const finalidade = FINALIDADES.find((f) => f.valor === ensaio.finalidade);
  const campanhaMesa = ensaio.direcao.campanha_mesa;

  const gerarUma = async (t: Tomada) => {
    setGerando((g) => ({ ...g, [t.id]: true }));
    try {
      const r = await gerarTomada({
        ensaioId: ensaio.id,
        tomadaId: t.id,
        modeloImagemId: modelo,
        qualidade,
        // A câmera escolhida nos botões vai junto; a função a grava na tomada.
        camera: cameras[t.id] || null,
        guia,
      });
      if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
      else void queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(clientId) });
      invalidarFotos(queryClient, clientId);
      // A câmera escolhida agora é a da tomada (a função gravou).
      setCameras((m) => ({ ...m, [t.id]: null }));
      return r;
    } catch (e) {
      // Falha do gerador fica escrita na tomada (status falhou): relê o ensaio.
      void queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(clientId) });
      throw e;
    } finally {
      setGerando((g) => ({ ...g, [t.id]: false }));
    }
  };

  const passa = (t: Tomada) => {
    const aprovada = t.versoes.some((v) => v.aprovada);
    if (filtro === "prontas") return aprovada;
    if (filtro === "revisar") return !aprovada && t.versoes.some((v) => !v.rejeitada);
    if (filtro === "gerar") return !aprovada && !t.versoes.length;
    return true;
  };
  const visiveis = ensaio.tomadas.filter(passa);
  // Organizado por tipo (herói, na mão, flat lay...): cada grupo com o seu título.
  const grupos: { tipo: string; tomadas: Tomada[] }[] = [];
  visiveis.forEach((t) => {
    const tipo = t.tipo || "";
    const g = grupos.find((x) => x.tipo === tipo);
    if (g) g.tomadas.push(t);
    else grupos.push({ tipo, tomadas: [t] });
  });
  const comTipo = grupos.some((g) => g.tipo);
  const faltamGerar = ensaio.tomadas.filter((t) => !t.versoes.length).length;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">
        <AndamentoDoLote ensaioId={ensaio.id} />
        <div className="flex min-w-0 flex-wrap items-center">
          <p className="mb-1 mr-auto min-w-0 text-[12.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">{receita ? receita.nome : nomeDaReceita(null, ensaio.receita_id)}</span>
            {finalidade ? ` · ${finalidade.rotulo}` : ""} · {resumo.aprovadas} de {resumo.total} aprovadas
            {resumo.paraRevisar ? ` · ${resumo.paraRevisar} para revisar` : ""}
            {resumo.bloqueadas ? ` · ${resumo.bloqueadas} bloqueadas` : ""}
            {campanhaMesa ? ` · campanha ${campanhaMesa.nome}` : ""}
          </p>
          {resumo.versoes > 0 && (
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" onClick={() => irPara("revisar", { ensaio: ensaio.id })}>
              <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Comparar com as fontes
            </Button>
          )}
          {resumo.aprovadas > 0 && (
            <Button type="button" size="sm" variant="outline" className="mb-1 ml-1 h-8 text-[12px]" onClick={() => irPara("usar", { ensaio: ensaio.id })}>
              Usar as {resumo.aprovadas} aprovadas
            </Button>
          )}
        </div>
        <Pilulas
          rotulo="Mostrar"
          opcoes={[
            { valor: "todas" as FiltroDoResultado, rotulo: `Todas · ${ensaio.tomadas.length}` },
            { valor: "gerar" as FiltroDoResultado, rotulo: `A gerar · ${faltamGerar}` },
            { valor: "revisar" as FiltroDoResultado, rotulo: `Para revisar · ${resumo.paraRevisar}` },
            { valor: "prontas" as FiltroDoResultado, rotulo: `Aprovadas · ${resumo.aprovadas}` },
          ]}
          valor={filtro}
          onEscolher={setFiltro}
        />
        {ensaio.tomadas.length === 0 ? (
          <Vazio titulo="Este lote não tem fotos planejadas">O diretor não montou fotos. Planeje de novo com outro pedido ou complete o produto.</Vazio>
        ) : visiveis.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-[12.5px] text-muted-foreground">Nenhuma foto com esse filtro.</p>
        ) : (
          <div className="max-h-[75vh] min-w-0 overflow-y-auto rounded-xl border border-border bg-background p-2" data-rolagem-propria="" data-resultado-do-lote="">
            {grupos.map((g) => (
              <section key={g.tipo || "sem-tipo"} className="mb-3 min-w-0 last:mb-0" data-grupo-do-tipo={g.tipo || "outras"}>
                {comTipo && (
                  <h4 className="mb-1.5 px-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {g.tipo ? rotuloDoTipoDeVariacao(g.tipo) : "Outras"} · {g.tomadas.length}
                  </h4>
                )}
                <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {g.tomadas.map((t) => (
                    <CartaoDaTomada
                      key={t.id}
                      ensaio={ensaio}
                      tomada={t}
                      camera={cameras[t.id] || null}
                      onCamera={(c) => setCameras((m) => ({ ...m, [t.id]: c }))}
                      gerando={!!gerando[t.id] || geraNoLote(lote, t.id)}
                      modeloId={modelo}
                      qualidade={qualidade}
                      onGerar={() => gerarUma(t)}
                      onAmpliar={setAmpliada}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-4">
        <Cartao titulo="Gerar">
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modelo} onChange={setModeloId} qualidade={qualidade} />
            <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
          </div>
          <BotaoDoLote
            ensaio={ensaio}
            modeloId={modelo}
            qualidade={qualidade}
            guia={guia}
            cameras={cameras}
            className="mt-3 h-9 w-full text-[12.5px]"
            rotulo={(n) => (
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {n} {n === 1 ? "tomada" : "tomadas"}, uma por vez
              </>
            )}
          />
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">Pode trocar de etapa enquanto gera: o andamento segue na barra de cima e cada foto pronta já fica salva. Aprove ou refaça em cada foto.</p>
        </Cartao>
        {kit && (
          <Cartao titulo={`Produto: ${kit.nome}`}>
            <ResumoDoKit kit={kit} />
          </Cartao>
        )}
        <Cartao titulo="Guia (opcional)">
          <SeletorDeGuia guia={guia} onMudar={setGuia} />
        </Cartao>
      </div>
      <Ampliar imagens={ampliada ? [{ caminho: ampliada, titulo: "Foto gerada", legenda: "Imagem gerada por IA" }] : []} indice={ampliada ? 0 : null} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

export default function EtapaEnsaio() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const { ensaioId, escolherEnsaio, kitId, escolherKit } = useMesaFoto();
  const kits = useKits(clientId);
  const ensaios = useEnsaios(clientId);
  const listaDeKits = useMemo(() => kits.data || [], [kits.data]);
  const lista = useMemo(() => ensaios.data || [], [ensaios.data]);
  const [novo, setNovo] = useState(false);
  // Campanha abre na aba própria; aqui ficam variações e ensaios por receita.
  const ensaio = !novo && ensaioId ? lista.find((e) => e.id === ensaioId && !ehCampanha(e)) || null : null;
  const kitDoEnsaio = ensaio && ensaio.kit_id ? listaDeKits.find((k) => k.id === ensaio.kit_id) || null : null;
  const receitas = useReceitas();
  const nomeDoEnsaio = (id: string) => nomeDaReceita(receitas.data ? receitas.data.receitas : null, id);

  // O ensaio aberto puxa o kit dele para a barra.
  useEffect(() => {
    if (ensaio && ensaio.kit_id && ensaio.kit_id !== kitId) escolherKit(ensaio.kit_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensaio ? ensaio.id : null]);

  return (
    <div className="min-w-0 space-y-4 pb-24">
      <div className="flex min-w-0 flex-wrap items-center">
        <Select
          value={ensaio ? ensaio.id : ""}
          onValueChange={(v) => {
            setNovo(false);
            escolherEnsaio(v);
          }}
        >
          <SelectTrigger className="mb-1.5 mr-2 h-9 w-full min-w-0 text-[12.5px] sm:w-[340px]" aria-label="Ensaio aberto">
            <SelectValue placeholder={lista.length ? "Abrir um ensaio" : "Nenhum ensaio ainda"} />
          </SelectTrigger>
          <SelectContent>
            {lista
              .filter((e) => !ehCampanha(e))
              .map((e) => {
                const k = listaDeKits.find((x) => x.id === e.kit_id);
                return (
                  <SelectItem key={e.id} value={e.id}>
                    {nomeDoEnsaio(e.receita_id)}
                    {k ? ` · ${k.nome}` : ""} · {rotuloDoEstadoDoEnsaio(e.status)}
                  </SelectItem>
                );
              })}
          </SelectContent>
        </Select>
        {(ensaio || lista.length > 0) && (
          <Button
            type="button"
            size="sm"
            variant={ensaio ? "outline" : "default"}
            className="mb-1.5 h-9 text-[12.5px]"
            onClick={() => {
              setNovo(true);
              escolherEnsaio(null);
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Novo ensaio
          </Button>
        )}
      </div>
      {(kits.isError || ensaios.isError) && <AvisoDeErro erro={kits.error || ensaios.error} />}
      {kits.isLoading ? (
        <p className="flex items-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo kits e ensaios...
        </p>
      ) : ensaio ? (
        <EnsaioAberto key={ensaio.id} ensaio={ensaio} kit={kitDoEnsaio} />
      ) : (
        <NovoEnsaio
          kits={listaDeKits}
          onPlanejado={(e) => {
            guardarEnsaio(queryClient, clientId, e);
            setNovo(false);
            escolherEnsaio(e.id);
          }}
        />
      )}
    </div>
  );
}
