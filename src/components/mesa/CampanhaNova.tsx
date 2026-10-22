import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, ChevronDown, ChevronLeft, ChevronRight, Copy, Flame, Lightbulb, Rocket, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "./AnexosDoPedido";
import CampanhaReferencias, { MAX_REFERENCIAS, ReferenciasEscolhidas } from "./CampanhaReferencias";
import { Cronometro } from "./Cronometro";
import { Ditado } from "./Ditado";
import { Campo } from "./Seletores";
import {
  campanhaCriar,
  chaves,
  DIAS_MAX_CAMPANHA,
  DIAS_PADRAO_CAMPANHA,
  diasEntreIso,
  hojeIso,
  partesDaCampanha,
  pedidoDaCampanhaDoHype,
  somarDiasIso,
  type BriefingDaCampanha,
  type Campanha,
  type Hype,
  type ImagemDaCampanha,
} from "./mesaV4Api";
import { EditorDaLinha, esquemaDaNova, linhaPrevista, type DatasDaNova } from "./CampanhaLinhaDoTempo";
import { briefingEmBranco, MAX_IMAGENS_CAMPANHA, partesDoMercado, trocarCampanhaNoCache } from "./campanhasApi";
import CampanhaImagens from "./CampanhaImagens";
import { briefingParaEnviar, FormularioDoBriefing } from "./CampanhaBriefing";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, juntar, superficie, texto as estiloDeTexto } from "@/components/sistema/estilos";
import { DEFINICAO_DO_TIPO, TIPOS_DE_CAMPANHA, type TipoDeCampanha } from "../../../supabase/functions/_shared/tipos-de-campanha";
import { padraoPara } from "@/lib/mesa/api";
import { useMarcaDaMesa } from "./MesaContexto";
import type { SementeDaCampanha } from "./sementeDaCampanha";
import { campanhaDaSemente, datasDoQuando, type MoldeDaCampanha, normalizarFormatos, partesDosPassos, passosQueFaltam, resumoDosPassos, sugerirFormatos, totalNaSerie, type FormatosDaCampanha } from "./regrasDaCampanha";
import Etapas from "@/components/sistema/Etapas";
import { PreviaDaCampanha, SeletorDeFormatos } from "./CampanhaFormatos";
import { depsDaCampanha, ProgressoDaCampanha } from "./CampanhaCompleta";
import { emAndamento, executarCampanha, useExecucao } from "./execucaoDaCampanha";

/**
 * Tipo da campanha (frente AE, 28/09, dono: "não é só promoção"): cada tipo
 * tem identidade e selo próprios. "Automático": o Jev lê o pedido.
 */
export function EscolhaDoTipo({ valor, onValor, desabilitado }: { valor: TipoDeCampanha | ""; onValor: (v: TipoDeCampanha | "") => void; desabilitado?: boolean }) {
  const pilula = (ativa: boolean) =>
    `mb-1.5 mr-1.5 inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[12px] transition-colors ${
      ativa ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary/50"
    }`;
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Tipo</p>
      <div role="radiogroup" aria-label="Tipo da campanha" className="flex min-w-0 flex-wrap" data-tipo-da-campanha={valor || "auto"}>
        <button type="button" role="radio" aria-checked={valor === ""} disabled={desabilitado} className={pilula(valor === "")} onClick={() => onValor("")} title="O agente reconhece o tipo pelo pedido">
          Automático
        </button>
        {TIPOS_DE_CAMPANHA.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={valor === t} disabled={desabilitado} className={pilula(valor === t)} onClick={() => onValor(t)} title={DEFINICAO_DO_TIPO[t].dica}>
            {DEFINICAO_DO_TIPO[t].rotulo}
          </button>
        ))}
      </div>
      {valor && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{DEFINICAO_DO_TIPO[valor].dica} Selo: {DEFINICAO_DO_TIPO[valor].selo.split(".")[0].toLowerCase()}.</p>}
    </div>
  );
}

/**
 * Nova campanha, numa coluna só e com o mínimo à vista: um campo grande
 * ("O que é a campanha?", com microfone e imagens), o período, quantos
 * conteúdos, as imagens da campanha (acervo ou enviadas, com papel e porquê)
 * e o botão. O briefing (produto, oferta, mensagem, público, provas) e as
 * referências ficam em "Mais opções". Um clique e o estrategista cria o
 * tema, o briefing, a identidade (com o selo a desenhar), os conteúdos e o
 * plano de imagens; a campanha abre com o agente ao lado para os ajustes.
 */

/**
 * 21/10/2026 (dono: "mais intuitivo, mais fácil, mais organizado e mais bonito"): a campanha nova em 3
 * passos (O que é → Formatos → Gerar), com a prévia montando ao lado; tipo, imagens, briefing e
 * referências ficam recolhidos em "Mais opções", no último passo. Os botões de gerar ficam sempre à mão.
 */
type PassoDaNova = "oque" | "formatos" | "gerar";
const PASSOS_DA_NOVA: { valor: PassoDaNova; rotulo: string }[] = [
  { valor: "oque", rotulo: "O que é a campanha" },
  { valor: "formatos", rotulo: "Formatos" },
  { valor: "gerar", rotulo: "Gerar" },
];

export default function CampanhaNova({
  hype,
  semente = null,
  onLimparSemente,
  molde = null,
  onLimparMolde,
  onLimparHype,
  onCriada,
  onCancelar,
}: {
  hype?: Hype | null;
  /** 21/10/2026: o que o Mês juntou (hypes, trendings e o pedido): a campanha nasce preenchida. */
  semente?: SementeDaCampanha | null;
  onLimparSemente?: () => void;
  /** 22/10/2026: "Nova campanha a partir desta": formatos, duração, tipo, público, tom, canais e CTA de outra campanha. */
  molde?: MoldeDaCampanha | null;
  onLimparMolde?: () => void;
  onLimparHype?: () => void;
  onCriada: (campanha: Campanha, projectId: string | null) => void;
  onCancelar?: () => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const anexos = useAnexos(clientId);
  const hoje = hojeIso();
  const { marca } = useMarcaDaMesa();
  // A semente vira título, pedido, briefing e período (a janela do hype; trending: agora + 7 ou 14 dias).
  const [daSemente] = useState(() => (semente ? campanhaDaSemente(semente, hoje) : null));
  const [nome, setNome] = useState(() => (daSemente ? daSemente.titulo : ""));
  const [pedido, setPedido] = useState(() => (daSemente ? daSemente.pedido : hype ? pedidoDaCampanhaDoHype(hype) : ""));
  // 22/10/2026: as datas saem da linha do tempo: data do evento, começar X dias antes e terminar em (sem a
  // escolha, o evento é o fim da janela de antes: a semente, o molde ou os dias padrão).
  const [datas, setDatas] = useState<DatasDaNova>(() => {
    const ini = daSemente ? daSemente.inicio : hoje;
    const fimDeAntes = daSemente ? daSemente.fim : somarDiasIso(hoje, molde ? molde.dias : DIAS_PADRAO_CAMPANHA);
    // Do Mês com data (hype): o evento é a data do hype; senão, o fim da janela.
    const doHype = semente && semente.hypes && semente.hypes[0] ? datasDoQuando(semente.hypes[0].quando, hoje).filter((d) => d >= hoje)[0] : "";
    const evento = doHype || fimDeAntes;
    return { evento, diasAntes: Math.max(0, diasEntreIso(ini, evento)), fim: doHype && fimDeAntes > doHype ? fimDeAntes : null };
  });
  const [passo, setPasso] = useState<PassoDaNova>("oque");
  // 22/10/2026: "O que o mercado está fazendo" antes de criar (campanhas reais com fonte; custo antes).
  const [comMercado, setComMercado] = useState(true);
  // Formatos: a sugestão pela duração até o dono mexer; depois vale a escolha dele.
  const [formatosEscolhidos, setFormatosEscolhidos] = useState<FormatosDaCampanha | null>(() => (molde ? molde.formatos : null));
  const [referencias, setReferencias] = useState<string[]>([]);
  const [imagens, setImagens] = useState<ImagemDaCampanha[]>([]);
  const [briefing, setBriefing] = useState<BriefingDaCampanha>(() => ({ ...briefingEmBranco(), ...(molde ? molde.briefing : {}), ...(daSemente ? daSemente.briefing : {}) }));
  const [maisOpcoes, setMaisOpcoes] = useState(!!daSemente);
  const [tipo, setTipo] = useState<TipoDeCampanha | "">(() => (molde && molde.tipo && (TIPOS_DE_CAMPANHA as readonly string[]).indexOf(molde.tipo) >= 0 ? (molde.tipo as TipoDeCampanha) : ""));
  const [galeria, setGaleria] = useState(false);
  const [desde, setDesde] = useState<number | null>(null);

  const esquema = esquemaDaNova(`${nome} ${pedido} ${hype ? hype.titulo : ""}`, tipo || null);
  const linha = linhaPrevista(datas, esquema, hoje);
  const inicio = linha.inicio;
  const fim = linha.fim;
  const dias = inicio && fim ? diasEntreIso(inicio, fim) : -1;
  const erroDoPeriodo = !inicio || !fim
    ? "Escolha o início e o fim."
    : dias < 0
      ? "O fim vem antes do início."
      : dias > DIAS_MAX_CAMPANHA
        ? `Até ${DIAS_MAX_CAMPANHA} dias por campanha.`
        : "";
  const formatos = formatosEscolhidos || sugerirFormatos(Math.max(1, dias));
  const qtd = totalNaSerie(formatos) || null;

  const criar = async () => {
    setDesde(Date.now());
    try {
      return await campanhaCriar({
        clientId,
        pedido: pedido.trim(),
        periodoInicio: inicio,
        periodoFim: fim,
        dataEvento: datas.evento,
        diasAntes: datas.diasAntes,
        quantidade: qtd,
        anexos: anexos.caminhos,
        referenciasIds: referencias,
        hype: hype || (daSemente ? daSemente.hype : null),
        briefing: briefingParaEnviar(briefing),
        imagens,
        tipo: tipo || null,
        nome: nome.trim() || null,
        formatos: normalizarFormatos(formatos),
        mercado: comMercado,
      });
    } finally {
      setDesde(null);
    }
  };

  const concluir = (data: any) => {
    const campanha = data && data.campanha ? (data.campanha as Campanha) : null;
    if (data && data.proposta && data.proposta.id) queryClient.setQueryData(chaves.proposta(data.proposta.id), data.proposta);
    if (campanha) trocarCampanhaNoCache(queryClient, clientId, campanha);
    void queryClient.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
    anexos.limpar();
    if (campanha) onCriada(campanha, data.project_id ? String(data.project_id) : null);
  };

  // 21/10/2026: "Gerar campanha completa": cria a campanha (briefing, identidade e série), o selo e cada peça
  // pelo Estúdio, em sequência, com o custo total antes. Ao criar, a tela vai para a campanha e o andamento segue.
  const qc = queryClient;
  const chaveDaExecucao = `nova:${clientId}`;
  const execucao = useExecucao(chaveDaExecucao);
  const andando = emAndamento(execucao);
  const imagemPadrao = padraoPara(catalogo, "imagem");
  const passosDaCompleta = passosQueFaltam({ temCampanha: false, temSelo: false, pecas: [], formatos });
  const gerarCompleta = async () => {
    void executarCampanha(
      chaveDaExecucao,
      null,
      passosDaCompleta,
      depsDaCampanha({
        qc,
        clientId,
        catalogo,
        marcaId: marca ? marca.id : null,
        criarCampanha: async () => {
          const data = await criar();
          concluir(data);
          return { campanha: data.campanha as Campanha, proposta: data.proposta && data.proposta.id ? data.proposta : null };
        },
      }),
    );
    return { custo_usd: 0 };
  };

  const indice = PASSOS_DA_NOVA.map((x) => x.valor).indexOf(passo);
  const podeGerar = !!pedido.trim() && !erroDoPeriodo && !anexos.subindo && desde === null && !andando;
  const extras = [tipo ? 1 : 0, imagens.length, referencias.length].reduce((a, b) => a + b, 0);

  return (
    <ZonaDeAnexos anexos={anexos} className="mx-auto w-full min-w-0 max-w-5xl">
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* O formulário é o assunto da tela: cartão com função (superficie.painel). Nada de outro cartão dentro. */}
        <section className={juntar(superficie.painel, "min-w-0 p-4 sm:p-6")} aria-label="Nova campanha">
          <div className="flex min-w-0 items-start">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center">
                <h2 className={juntar(estiloDeTexto.tituloSecao, "truncate")}>Nova campanha</h2>
                <AjudaRecolhida className="ml-1.5" rotulo="Como funciona">
                  Diga o que é, escolha os formatos e gere. O agente cria o tema, a identidade com o selo e a série; o Estúdio faz as peças.
                </AjudaRecolhida>
              </div>
            </div>
            {onCancelar && (
              // Criando: a chamada já foi paga e segue no servidor; cancelar aqui
              // não a pararia e, ao voltar, puxaria a tela para a campanha nova.
              <Button type="button" size="sm" variant="ghost" className="ml-2 h-8 w-8 shrink-0 p-0" aria-label="Cancelar" title="Cancelar" onClick={onCancelar} disabled={desde !== null}>
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>

          <Etapas numerar rotulo="Passos da campanha nova" itens={PASSOS_DA_NOVA.map((x, i) => ({ valor: x.valor, rotulo: x.rotulo, feita: i < indice }))} valor={passo} onEscolher={(v) => setPasso(v as PassoDaNova)} className="mt-3 border-b border-border" />

          {/* 1. O que é a campanha: nome, o pedido (texto, voz e imagens) e o período. */}
          {passo === "oque" && (
            <div className="min-w-0 pt-4" data-passo-da-nova="oque">
              {hype && (
                <div className="mb-3 flex min-w-0 items-center rounded-md bg-muted px-3 py-2 text-[12px]">
                  <Flame className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">Do hype: <strong className="font-medium">{hype.titulo}</strong></span>
                  {onLimparHype && (
                    <button type="button" onClick={onLimparHype} aria-label="Tirar o hype" title="Tirar o hype" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              {molde && (
                <div className="mb-3 flex min-w-0 items-center rounded-md bg-muted px-3 py-2 text-[12px]" data-molde={molde.origemId}>
                  <Copy className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">A partir de: <strong className="font-medium">{molde.origemNome}</strong> (estrutura; o tema é novo)</span>
                  {onLimparMolde && (
                    <button type="button" onClick={onLimparMolde} aria-label="Tirar a campanha de origem" title="Tirar a campanha de origem" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              {daSemente && (
                <div className="mb-3 rounded-md bg-muted px-3 py-2 text-[12px]" data-semente="">
                  <div className="flex min-w-0 items-center">
                    <Lightbulb className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">Do Mês: <strong className="font-medium">{daSemente.titulo}</strong></span>
                    {onLimparSemente && (
                      <button type="button" onClick={onLimparSemente} aria-label="Tirar o que veio do Mês" title="Tirar o que veio do Mês" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {daSemente.sugestoes.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground" aria-label="Sugestões do Mês">
                      {daSemente.sugestoes.map((t) => <li key={t}>{t}</li>)}
                    </ul>
                  )}
                </div>
              )}

              <Campo rotulo="Nome (opcional)">
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="O agente sugere, se ficar vazio" className="h-9 min-w-0 text-[13px]" aria-label="Nome da campanha" maxLength={120} />
              </Campo>

              {/* O campo grande, como uma conversa: texto, microfone e imagens. */}
              <div className="mt-3 rounded-md bg-muted/50 p-2.5 ring-primary/60 focus-within:ring-1">
                <label htmlFor="pedido-da-campanha" className="block px-1 pb-1 text-[12px] font-medium text-muted-foreground">
                  O que é a campanha?
                </label>
                <Textarea
                  id="pedido-da-campanha"
                  value={pedido}
                  onChange={(e) => setPedido(e.target.value)}
                  rows={4}
                  aria-label="Pedido da campanha"
                  placeholder={tipo ? `Ex.: ${DEFINICAO_DO_TIPO[tipo].exemplo}` : "Ex.: Black Friday com 30% no plano anual, tom direto"}
                  className="min-h-[104px] resize-y border-0 bg-transparent px-1 py-1 text-[13px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <MiniaturasDosAnexos anexos={anexos} />
                <div className="mt-1 flex min-w-0 items-center">
                  <BotaoDeAnexar anexos={anexos} className="mr-1.5" />
                  <Ditado valor={pedido} onChange={setPedido} disabled={desde !== null} className="min-w-0" />
                </div>
              </div>

              <div className="mt-3 min-w-0">
                <EditorDaLinha datas={datas} onDatas={setDatas} esquema={esquema} desabilitado={desde !== null} />
              </div>
              {erroDoPeriodo && <p className="mt-2 text-[12px] text-destructive">{erroDoPeriodo}</p>}
            </div>
          )}

          {/* 2. Formatos: posts, carrosséis, stories e vídeos, com a sugestão pela duração. */}
          {passo === "formatos" && (
            <div className="min-w-0 pt-4" data-passo-da-nova="formatos">
              <SeletorDeFormatos valor={formatos} onChange={setFormatosEscolhidos} dias={Math.max(1, dias)} desabilitado={desde !== null} />
            </div>
          )}

          {/* 3. Gerar: o que vai sair, o andamento e, recolhido, o avançado. */}
          {passo === "gerar" && (
            <div className="min-w-0 pt-4" data-passo-da-nova="gerar">
              <p className="text-[13px]">
                <strong className="font-medium">Campanha completa:</strong> {resumoDosPassos(passosDaCompleta)}.
              </p>
              <p className={juntar(estiloDeTexto.auxiliar, "mt-1")}>Ou só o plano: briefing, identidade e série, sem gerar as peças.</p>
              <label className="mt-3 flex min-w-0 items-center text-[13px]">
                <input type="checkbox" className="mr-2 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={comMercado} onChange={(e) => setComMercado(e.target.checked)} aria-label="Pesquisar o que o mercado está fazendo" />
                <span className="min-w-0">O que o mercado está fazendo <span className="text-muted-foreground">(campanhas reais com fonte, para diferenciar)</span></span>
              </label>

              <div className="mt-4 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setMaisOpcoes((v) => !v)}
                  aria-expanded={maisOpcoes}
                  className="inline-flex items-center text-[12px] font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={`mr-1 h-4 w-4 transition-transform ${maisOpcoes ? "" : "-rotate-90"}`} />
                  Mais opções
                  <span className="ml-1.5 font-normal">{extras ? `(${extras} escolhida(s))` : "(tipo, imagens, briefing, referências)"}</span>
                </button>
                {maisOpcoes && (
                  <div className="mt-3 min-w-0 space-y-4">
                    <EscolhaDoTipo valor={tipo} onValor={setTipo} desabilitado={desde !== null} />
                    <div className="min-w-0">
                      <p className="mb-2 text-[12px] font-medium text-muted-foreground">
                        Imagens da campanha <span className="font-normal">({imagens.length} de {MAX_IMAGENS_CAMPANHA})</span>
                      </p>
                      <CampanhaImagens valor={imagens} onChange={setImagens} desabilitado={desde !== null} vazio="Do acervo ou do computador. Marque o produto herói." />
                    </div>
                    <div className="min-w-0 rounded-md bg-muted/50 p-3">
                      <p className="mb-2 flex items-center text-[12px] font-medium text-muted-foreground">
                        Briefing
                        <AjudaRecolhida className="ml-1" rotulo="Como o briefing vale">
                          O que você preencher vale; o agente completa o resto.
                        </AjudaRecolhida>
                      </p>
                      <FormularioDoBriefing valor={briefing} onChange={setBriefing} prefixo="briefing-nova" desabilitado={desde !== null} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center">
                        <p className="min-w-0 flex-1 text-[12px] font-medium text-muted-foreground">
                          Referências <span className="font-normal">({referencias.length} de {MAX_REFERENCIAS})</span>
                        </p>
                        <Button type="button" size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0 text-primary" aria-expanded={galeria} aria-label={galeria ? "Fechar a galeria de referências" : "Escolher referências"} title={galeria ? "Fechar a galeria" : "Escolher referências"} onClick={() => setGaleria((v) => !v)}>
                          {galeria ? <X className="h-4 w-4" aria-hidden="true" /> : <BookmarkPlus className="h-4 w-4" aria-hidden="true" />}
                        </Button>
                      </div>
                      {galeria ? (
                        <CampanhaReferencias valor={referencias} onChange={setReferencias} />
                      ) : (
                        <ReferenciasEscolhidas ids={referencias} onTirar={(id) => setReferencias((l) => l.filter((x) => x !== id))} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {execucao && <div className="mt-4"><ProgressoDaCampanha execucao={execucao} /></div>}

          {/* Barra: voltar e continuar entre os passos; gerar fica sempre à mão. */}
          <div className="mt-5 flex min-w-0 flex-wrap items-center border-t border-border pt-3">
            <button type="button" className={juntar(botao.icone, "mb-1")} onClick={() => setPasso(PASSOS_DA_NOVA[Math.max(0, indice - 1)].valor)} disabled={indice === 0} aria-label="Voltar" title="Voltar ao passo anterior">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={juntar(botao.icone, "mb-1 mr-2")} onClick={() => setPasso(PASSOS_DA_NOVA[Math.min(PASSOS_DA_NOVA.length - 1, indice + 1)].valor)} disabled={indice === PASSOS_DA_NOVA.length - 1} aria-label="Continuar" title="Continuar para o próximo passo">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="ml-auto flex flex-wrap items-center justify-end">
              {desde !== null && <span className="mb-1 mr-3 min-w-0"><Cronometro desde={desde} rotulo="Criando a campanha" previsao="~1min" /></span>}
              <BotaoComCusto
                rotulo={<><Rocket className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Criar campanha</span></>}
                titulo="Campanha criada"
                descricao="Criar campanha: só o plano (tema, identidade com o selo e a série nos formatos escolhidos), sem gerar as peças."
                partes={() => partesDaCampanha(catalogo, qtd, anexos.caminhos.length + imagens.length).concat(comMercado ? partesDoMercado(catalogo) : [])}
                executar={criar}
                aoConcluir={concluir}
                disabled={!podeGerar}
                variant="outline"
                className="mb-1 mr-2 h-9 gap-0 px-3"
              />
              <BotaoComCusto
                rotulo={<><Wand2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Gerar campanha completa</span></>}
                titulo="Campanha completa"
                descricao={`Gerar campanha completa: ${resumoDosPassos(passosDaCompleta)}, tudo pelo gerador do Estúdio. Custo total estimado ao lado; confirme no segundo clique.`}
                partes={() => partesDosPassos(passosDaCompleta, catalogo, { modeloImagemId: imagemPadrao ? imagemPadrao.id : null, quantidade: qtd, anexos: anexos.caminhos.length + imagens.length }).concat(comMercado ? partesDoMercado(catalogo) : [])}
                executar={gerarCompleta}
                fecharAoConfirmar
                sempreConfirmar
                disabled={!podeGerar}
                className="mb-1 h-9 gap-0 px-3"
              />
            </span>
          </div>
        </section>

        {/* A prévia da campanha montando (ao lado no computador; embaixo no celular). */}
        <aside className="min-w-0 lg:pt-2">
          <PreviaDaCampanha nome={nome} inicio={inicio} fim={fim} formatos={formatos} linha={linha} className="lg:sticky lg:top-2" />
        </aside>
      </div>
    </ZonaDeAnexos>
  );
}
