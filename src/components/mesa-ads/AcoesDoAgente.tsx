import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, ExternalLink, FlaskConical, KeyRound, Loader2, Play, ShieldAlert, Undo2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import CaminhoPronto from "@/components/agentes/CaminhoPronto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta } from "@/lib/mesa/api";
import { brl, chavesAds, inteiro, porcento, tempoDesde } from "./adsApi";
import {
  ativarCampanhaMontada,
  criarPlanoDoAgente,
  desfazerAcoesDaConta,
  desfazerItemDaConta,
  estadoDasAcoes,
  executarAcoesDaConta,
  itemTemDesfazer,
  itensDisponiveis,
  nomeDoNivel,
  normalizarAcoesDaConta,
  ROTULO_DA_ACAO,
  temDesfazer,
  type AcoesDaConta,
  type ItemDaAcao,
  type NumerosVistos,
} from "./acoesDoAgenteApi";
import { chavesRotina } from "./rotinaApi";
import { juntar } from "@/components/sistema/estilos";

/**
 * Agente sênior que age (pedido do dono em 25/09 à noite): o que ele viu
 * (números do código, com fonte e período), as ações propostas em cartões
 * (confirmar, cancelar, desfazer) e o plano de teste já preenchido. Mesmo
 * padrão do agente do Mês (CartaoDaAcaoNaAgenda): nada muda na conta sem o
 * Confirmar, cada item responde por si e o motivo aparece quando falha.
 */

const variacao = (v: number | null) => (v === null ? "" : `${v > 0 ? "+" : ""}${Math.round(v)}%`);

function Numero({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10.5px] text-muted-foreground">{rotulo}</p>
      <p className="truncate text-[13px] font-semibold tabular-nums">{valor}</p>
      {sub && <p className="truncate text-[10.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * "O que ele viu": uma linha com os números principais (fonte e período à
 * vista); abre para o detalhe (comparação, CTR, onde está o dinheiro).
 */
export function NumerosQueEleViu({ n, carregando = false }: { n: NumerosVistos; carregando?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const cmp = n.comparacao;
  const resumo = [
    `${brl(n.gasto)} investidos`,
    n.resultados !== null ? `${inteiro(n.resultados)} ${n.resultado_rotulo ? n.resultado_rotulo.toLowerCase() : "resultados"}` : "",
    n.custo_por_resultado !== null ? `${brl(n.custo_por_resultado)} cada` : "",
  ].filter(Boolean).join(" · ");
  return (
    <section className="min-w-0" aria-label="O que o agente viu">
      <button type="button" className="flex w-full min-w-0 items-start text-left" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-muted-foreground">O que ele viu{carregando ? " (lendo a conta...)" : ""}</span>
          <span className="block text-[12.5px] font-medium tabular-nums [overflow-wrap:anywhere]">{resumo}</span>
          <span className="block text-[10.5px] text-muted-foreground">
            Fonte: {n.fonte}
            {n.periodo ? `, de ${dataCurta(n.periodo.inicio)} a ${dataCurta(n.periodo.fim)} (${n.periodo.dias} dias)` : ""}
            {n.atualizado_em ? `, coletado ${tempoDesde(n.atualizado_em)}` : ""}.
          </span>
        </span>
        <ChevronDown className={`ml-2 mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="mt-2 min-w-0 space-y-1.5">
          <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2">
            <Numero rotulo="Investido" valor={brl(n.gasto)} sub={cmp && cmp.gasto_pct !== null ? `${variacao(cmp.gasto_pct)} vs. antes` : undefined} />
            <Numero rotulo={n.resultado_rotulo ? `Resultados (${n.resultado_rotulo})` : "Resultados"} valor={inteiro(n.resultados)} sub={cmp && cmp.resultados_pct !== null ? `${variacao(cmp.resultados_pct)} vs. antes` : undefined} />
            <Numero rotulo="Custo por resultado" valor={brl(n.custo_por_resultado)} sub={cmp && cmp.custo_por_resultado_pct !== null ? `${variacao(cmp.custo_por_resultado_pct)} vs. antes` : undefined} />
            <Numero rotulo="CTR do link" valor={porcento(n.ctr_link_pct)} sub={n.cpm !== null ? `CPM ${brl(n.cpm)}` : undefined} />
          </div>
          {n.mix.length > 0 && (
            <p className="text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">Onde o dinheiro está: {n.mix.map((m) => `${m.rotulo} ${Math.round(m.pct)}%`).join(" · ")}</p>
          )}
        </div>
      )}
      {n.alertas.map((a, k) => (
        <p key={k} className="mt-1 flex items-start text-[11.5px] leading-snug text-warning">
          <ShieldAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{a}</span>
        </p>
      ))}
    </section>
  );
}

/** Antes e depois do item (status, orçamento ou nome). */
function AntesDepois({ i }: { i: ItemDaAcao }) {
  const de = i.de;
  const para = i.para;
  const status = (s: string | null | undefined) => (s === "ACTIVE" ? "ativo" : s === "PAUSED" ? "pausado" : s ? s.toLowerCase() : "sem leitura");
  let antes = "";
  let depois = "";
  if ((i.tipo === "pausar" || i.tipo === "ativar") && para) {
    antes = status(de ? de.status : null);
    depois = status(para.status);
  } else if (i.tipo === "orcamento") {
    antes = de ? `${brl(de.orcamento_diario_brl)} por dia` : "orçamento não lido";
    depois = para && para.orcamento_diario_brl !== undefined ? `${brl(para.orcamento_diario_brl)} por dia (${variacao(i.variacao_pct)})` : "a calcular";
  } else if (i.tipo === "renomear") {
    antes = de && de.nome ? de.nome : "nome atual";
    depois = i.texto || "";
  }
  if (!antes && !depois) return null;
  return (
    <span className="mt-0.5 flex min-w-0 flex-wrap items-center text-[11.5px]">
      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground [overflow-wrap:anywhere]">{antes}</span>
      <ArrowRight className="mx-1 h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary [overflow-wrap:anywhere]">{depois}</span>
      {i.limitado && <span className="ml-1.5 text-[10.5px] text-muted-foreground">limitado a 30% por vez</span>}
    </span>
  );
}

/** Aviso de acesso só de leitura, com o caminho para conectar com gestão. */
export function AvisoDeGestao({ motivo }: { motivo: string | null }) {
  const { isAdmin } = useMesa();
  return (
    <div className="mt-2 flex min-w-0 items-start rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11.5px] leading-snug">
      <KeyRound className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {motivo || "O acesso de anúncios deste cliente não tem permissão de gestão."} As ações na Meta ficam indisponíveis até lá; o resto funciona.{" "}
        {isAdmin ? (
          <a href="/anuncios" className="inline-flex items-center font-medium text-primary hover:underline">
            Conectar com permissão de gestão <ExternalLink className="ml-0.5 h-3 w-3" />
          </a>
        ) : (
          <span className="font-medium">Peça a um admin para conectar com permissão de gestão em Anúncios.</span>
        )}
      </span>
    </div>
  );
}

/**
 * As ações que o agente propôs, uma por linha, com antes e depois. Os itens
 * disponíveis vêm marcados; o Confirmar faz só os marcados.
 *
 * Frente TR (27/09, "menos burocracia"): o que o agente já fez sozinho (seguro:
 * reversível e sem aumento de gasto) aparece como "Já fiz", com o Desfazer de
 * cada um; a campanha montada do plano mostra o resumo e o Confirmar para
 * ativar; depois de feito, o caminho "Ir para ..." (contrato comum).
 */
export function CartaoDasAcoes({ mensagemId, acoes, onPlanoPronto }: { mensagemId: string; acoes: AcoesDaConta; onPlanoPronto?: (planoId: string) => void }) {
  const avisarErro = useAvisarErro();
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [atual, setAtual] = useState<AcoesDaConta>(acoes);
  const [marcados, setMarcados] = useState<string[]>(() => itensDisponiveis(acoes).map((i) => i.id));
  const [fazendo, setFazendo] = useState<string | null>(null);
  const [irSozinho, setIrSozinho] = useState(false);
  const estado = estadoDasAcoes(atual);
  const ensaio = atual.modo === "ensaio";
  const semGestao = !ensaio && atual.gestao && !atual.gestao.disponivel && atual.itens.some((i) => i.na_meta && !i.ensaio);
  const confirmaveis = itensDisponiveis(atual).length;
  const feitosSozinho = atual.itens.filter((i) => i.auto && i.resultado && i.resultado.ok);
  // Frente AD: o que ele tentou sozinho e não deu (ordem direta com a conta travada, por exemplo).
  const falhasSozinho = atual.itens.filter((i) => i.auto && i.resultado && !i.resultado.ok);
  // Todo item já resolvido sozinho (feito ou não): nada a confirmar, o cartão só mostra o resultado.
  const resolvidoSozinho = atual.itens.length > 0 && atual.itens.every((i) => i.auto && !!i.resultado);

  const releituras = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "urls", "ads-conta", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "urls", "ads-resultados", clientId] });
    void queryClient.invalidateQueries({ queryKey: chavesRotina.rotina(clientId) });
  };

  const agir = async (tipo: "confirmar" | "descartar" | "desfazer") => {
    setFazendo(tipo);
    try {
      const data = tipo === "desfazer" ? await desfazerAcoesDaConta(mensagemId) : await executarAcoesDaConta(mensagemId, marcados, tipo === "descartar");
      const novo = data && data.anexo ? normalizarAcoesDaConta(data.anexo) : null;
      if (novo) setAtual(novo);
      if (tipo === "confirmar") {
        const falhas = Number(data && data.falhas) || 0;
        toast.success(`${Number(data && data.feitos) || 0} ${Number(data && data.feitos) === 1 ? "ação feita" : "ações feitas"}`, {
          description: falhas ? `${falhas} não ${falhas === 1 ? "pôde" : "puderam"}. O motivo está no cartão.` : "Dá para desfazer no cartão quando houver volta.",
        });
        releituras();
        void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
        void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
        const plano = novo ? novo.itens.find((i) => i.tipo === "plano_de_teste" && i.resultado && i.resultado.ok) : null;
        if (plano && plano.resultado && plano.resultado.criado.plano_id && onPlanoPronto) onPlanoPronto(plano.resultado.criado.plano_id);
        // Confirmado nesta tela: o caminho abre sozinho quando o servidor pediu.
        setIrSozinho(true);
      } else if (tipo === "desfazer") {
        toast.success("Conta como estava", { description: `${Number(data && data.voltaram) || 0} item(ns) voltaram.` });
        releituras();
      }
    } catch (e) {
      avisarErro(e, tipo === "desfazer" ? "Não foi possível desfazer" : tipo === "descartar" ? "Não foi possível cancelar" : "Não foi possível fazer as ações");
    } finally {
      setFazendo(null);
    }
  };

  /** Desfazer só um item (o que o agente fez sozinho). */
  const desfazerItem = async (i: ItemDaAcao) => {
    setFazendo(`desfazer:${i.id}`);
    try {
      const data = await desfazerItemDaConta(mensagemId, i.id);
      const novo = data && data.anexo ? normalizarAcoesDaConta(data.anexo) : null;
      if (novo) setAtual(novo);
      toast.success("Desfeito", { description: "Este item voltou como estava." });
      releituras();
    } catch (e) {
      avisarErro(e, "Não foi possível desfazer");
    } finally {
      setFazendo(null);
    }
  };

  /** O Confirmar da campanha montada: começa a gastar. */
  const ativar = async (i: ItemDaAcao) => {
    setFazendo(`ativar:${i.id}`);
    try {
      const data = await ativarCampanhaMontada(mensagemId, i.id);
      const novo = data && data.anexo ? normalizarAcoesDaConta(data.anexo) : null;
      if (novo) setAtual(novo);
      toast.success("Campanha ativada", { description: "Ela entra em análise na Meta e começa a rodar. O Desfazer arquiva a campanha." });
      releituras();
    } catch (e) {
      avisarErro(e, "A campanha não foi ativada");
    } finally {
      setFazendo(null);
    }
  };

  const alternar = (id: string) => setMarcados((m) => (m.indexOf(id) >= 0 ? m.filter((x) => x !== id) : m.concat([id])));

  /** "Qual delas?" (itens de mesmo nome): um clique escolhe e executa só esse, pelo Confirmar de sempre. */
  const escolherUm = async (id: string) => {
    setFazendo(`escolher:${id}`);
    try {
      const data = await executarAcoesDaConta(mensagemId, [id]);
      const novo = data && data.anexo ? normalizarAcoesDaConta(data.anexo) : null;
      if (novo) setAtual(novo);
      if (Number(data && data.feitos) > 0) toast.success("Feito e conferido na Meta", { description: "Dá para voltar no cartão." });
      else toast.warning("Não foi feito", { description: "O motivo está no cartão." });
      releituras();
    } catch (e) {
      avisarErro(e, "Não foi possível fazer");
    } finally {
      setFazendo(null);
    }
  };

  if (atual.escolher_um) {
    // Depois da escolha, só o item escolhido fica (os outros não foram tocados).
    const visiveis = estado === "aberta" ? atual.itens : atual.itens.filter((i) => !(i.resultado && !i.resultado.ok && i.resultado.motivo === "Não marcado nesta confirmação."));
    return (
      <section className="min-w-0 rounded-lg border border-primary/30 bg-card p-3" aria-label="Qual delas?" data-escolher-um={estado}>
        <p className="flex min-w-0 items-center text-[12.5px] font-semibold">
          <Zap className="mr-1.5 h-3.5 w-3.5 text-primary" />
          {estado === "aberta" ? `Qual delas? (${atual.itens.length} com o mesmo nome)` : "Escolhido"}
        </p>
        <ul className="mt-2 divide-y divide-border border-y border-border">
          {visiveis.map((i) => {
            const r = i.resultado;
            return (
              <li key={i.id} className="flex min-w-0 flex-wrap items-start py-2" data-opcao={i.id}>
                <span className="mr-2 min-w-0 flex-1 text-[12px] leading-snug">
                  <span className="block font-medium [overflow-wrap:anywhere]">{i.alvo ? i.alvo.nome : ROTULO_DA_ACAO[i.tipo]}</span>
                  {i.detalhe && <span className="block text-muted-foreground [overflow-wrap:anywhere]">{i.detalhe}</span>}
                  <AntesDepois i={i} />
                  {i.indisponivel && estado === "aberta" && <span className="mt-0.5 block text-[11.5px] text-warning [overflow-wrap:anywhere]">{i.indisponivel}</span>}
                  {r && !r.ok && r.motivo && <span className="mt-0.5 block text-[11.5px] text-destructive [overflow-wrap:anywhere]">Não fiz: {r.motivo}</span>}
                  {r && r.ok && !r.desfeito && r.depois && <ProvaNaMeta i={i} />}
                  {r && r.desfeito && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">Desfeito.</span>}
                </span>
                {estado === "aberta" && !i.indisponivel && (
                  <Button type="button" size="sm" className="mt-0.5 h-8" disabled={!!fazendo} onClick={() => void escolherUm(i.id)} aria-label={`É esta: ${i.detalhe || i.id}`}>
                    {fazendo === `escolher:${i.id}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                    É esta
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {fazendo && fazendo.indexOf("escolher:") === 0 && (
          <p className="mt-2 flex items-center text-[11.5px] leading-snug" role="status">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
            Fazendo na Meta: relê o item, faz e relê de novo para provar.
          </p>
        )}
        <div className="mt-2 flex min-w-0 flex-wrap items-center">
          {estado === "aberta" && (
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" disabled={!!fazendo} onClick={() => void agir("descartar")}>
              Nenhuma
            </Button>
          )}
          {estado === "feita" && temDesfazer(atual) && (
            <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" disabled={!!fazendo} onClick={() => void agir("desfazer")}>
              {fazendo === "desfazer" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1.5 h-3.5 w-3.5" />}
              Desfazer
            </Button>
          )}
          {estado === "descartada" && <span className="text-[11.5px] text-muted-foreground">Nenhuma escolhida: nada mudou.</span>}
          {estado === "desfeita" && <span className="text-[11.5px] text-muted-foreground">Desfeito: voltou como estava.</span>}
        </div>
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-lg border border-primary/30 bg-card p-3" aria-label="Ações propostas" data-acoes-conta={estado} data-modo={atual.modo}>
      <p className="flex min-w-0 flex-wrap items-center text-[12.5px] font-semibold">
        <Zap className="mr-1.5 h-3.5 w-3.5 text-primary" />
        {feitosSozinho.length && estado === "aberta" ? `Já fiz ${feitosSozinho.length} · o resto espera você` : `Ações propostas · ${atual.itens.length}`}
        {ensaio && <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-medium text-warning">Modo ensaio</span>}
      </p>
      {atual.resumo && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{atual.resumo}</p>}
      {ensaio && estado === "aberta" && (
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
          Não mexi na conta: {atual.gestao && atual.gestao.motivo ? atual.gestao.motivo : "sem permissão de gestão."} Os itens da Meta mostram como seria feito. Resolvido isso, peça de novo.
        </p>
      )}
      {semGestao && estado === "aberta" && !resolvidoSozinho && <AvisoDeGestao motivo={atual.gestao ? atual.gestao.motivo : null} />}
      <ul className="mt-2 divide-y divide-border border-y border-border">
        {atual.itens.map((i) => {
          const r = i.resultado;
          const sozinho = i.auto && !!r;
          const pode = estado === "aberta" && !i.indisponivel && !i.ensaio && !sozinho;
          return (
            <li key={i.id} className="flex min-w-0 items-start py-2" data-ensaio={i.ensaio ? "" : undefined} data-feito-sozinho={sozinho ? "" : undefined}>
              {sozinho && r && r.ok ? (
                <Check className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : estado === "aberta" && i.ensaio ? (
                <span className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-dashed border-warning" aria-hidden="true" />
              ) : estado === "aberta" && !sozinho ? (
                <input
                  type="checkbox"
                  className="mr-2 mt-0.5 shrink-0"
                  aria-label={`Marcar: ${ROTULO_DA_ACAO[i.tipo]}${i.alvo ? ` ${i.alvo.nome}` : ""}`}
                  checked={pode && marcados.indexOf(i.id) >= 0}
                  disabled={!pode || !!fazendo}
                  onChange={() => alternar(i.id)}
                />
              ) : r && r.ok ? (
                <Check className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <X className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 text-[12px] leading-snug">
                <span className="block font-medium [overflow-wrap:anywhere]">
                  {ROTULO_DA_ACAO[i.tipo]}
                  {i.alvo ? <span className="font-normal text-muted-foreground">{` · ${nomeDoNivel(i.alvo.nivel)} `}</span> : null}
                  {i.alvo ? i.alvo.nome : i.tipo === "tarefa_equipe" && i.texto ? `: ${i.texto}` : ""}
                  {i.criativo ? <span className="font-normal text-muted-foreground">{` com ${i.criativo.nome}`}</span> : null}
                  {sozinho && r && r.ok && !r.desfeito && <span className="ml-1.5 rounded bg-success/15 px-1.5 py-0.5 text-[10.5px] font-medium text-success">Já fiz</span>}
                </span>
                <AntesDepois i={i} />
                {i.montagem && <ResumoDaMontagem i={i} />}
                {i.ensaio && estado === "aberta" && <span className="mt-0.5 inline-block rounded bg-warning/15 px-1.5 py-0.5 text-[10.5px] font-medium text-warning">Seria feito assim</span>}
                {i.motivo && <span className="mt-0.5 block text-muted-foreground [overflow-wrap:anywhere]">{i.motivo}</span>}
                {i.indisponivel && estado === "aberta" && !sozinho && <span className="mt-0.5 block text-[11.5px] text-warning [overflow-wrap:anywhere]">{i.indisponivel}</span>}
                {r && !r.ok && (estado !== "aberta" || sozinho) && r.motivo && <span className="mt-0.5 block text-[11.5px] text-destructive [overflow-wrap:anywhere]">{r.motivo}</span>}
                {r && r.ok && r.motivo && <span className="mt-0.5 block text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{r.motivo}</span>}
                {r && r.ok && !r.desfeito && r.depois && <ProvaNaMeta i={i} />}
                {r && r.ok && (i.tipo === "duplicar_anuncio" || i.tipo === "trocar_criativo") && (
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">Criado pausado na Meta. Nada entra no ar sem alguém ativar.</span>
                )}
                {r && r.desfeito && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">Desfeito.</span>}
                {r && r.motivo_desfazer && <span className="mt-0.5 block text-[11.5px] text-destructive [overflow-wrap:anywhere]">Não desfeito: {r.motivo_desfazer}</span>}
                {r && r.ok && i.tipo === "plano_de_teste" && r.criado.plano_id && onPlanoPronto && (
                  <button type="button" className="mt-0.5 text-[11.5px] font-medium text-primary hover:underline" onClick={() => onPlanoPronto(r.criado.plano_id)}>
                    Abrir o plano de teste
                  </button>
                )}
                {r && r.ok && !r.desfeito && i.tipo === "montar_campanha_do_plano" && (
                  <span className="mt-1 flex min-w-0 flex-wrap items-center">
                    {r.ativada_em ? (
                      <span className="mb-1 mr-1.5 rounded bg-success/15 px-1.5 py-0.5 text-[10.5px] font-medium text-success">Ativada</span>
                    ) : (
                      <Button type="button" size="sm" className="mb-1 mr-1.5 h-7 text-[11.5px]" disabled={!!fazendo} onClick={() => void ativar(i)} title="Começa a gastar a verba do plano. O Desfazer arquiva a campanha.">
                        {fazendo === `ativar:${i.id}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                        Ativar campanha{i.montagem && i.montagem.verba_diaria_brl !== null ? ` (${brl(i.montagem.verba_diaria_brl)} por dia)` : ""}
                      </Button>
                    )}
                  </span>
                )}
                {sozinho && itemTemDesfazer(i) && (
                  <Button type="button" size="sm" variant="outline" className="mt-1 h-7 text-[11.5px]" disabled={!!fazendo} onClick={() => void desfazerItem(i)} aria-label={`Desfazer este item: ${ROTULO_DA_ACAO[i.tipo]}${i.alvo ? ` ${i.alvo.nome}` : ""}`}>
                    {fazendo === `desfazer:${i.id}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1 h-3.5 w-3.5" />}
                    Voltar este
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {fazendo === "confirmar" && (
        <p className="mt-2 flex items-center rounded-md bg-primary/5 px-2.5 py-1.5 text-[11.5px] leading-snug" role="status" data-fazendo-na-meta="">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          Fazendo na Meta, um item por vez: relê o item, faz e relê de novo para provar.
        </p>
      )}
      {atual.ignorados.length > 0 && estado === "aberta" && (
        <p className="mt-1.5 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">Fora da lista (o agente citou algo que não existe ou não faz sentido): {atual.ignorados.join("; ")}.</p>
      )}
      <div className="mt-2.5 flex min-w-0 flex-wrap items-center">
        {estado === "aberta" && resolvidoSozinho ? (
          <span className={juntar("mb-1 mr-2 inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px]", falhasSozinho.length && !feitosSozinho.length ? "bg-destructive/10 text-destructive" : "bg-success/15")} data-resolvido={falhasSozinho.length ? (feitosSozinho.length ? "em-parte" : "nao-feito") : "feito"}>
            {falhasSozinho.length && !feitosSozinho.length ? <X className="mr-1 h-3 w-3" /> : <Check className="mr-1 h-3 w-3" />}
            {falhasSozinho.length ? (feitosSozinho.length ? `Feito em parte: ${feitosSozinho.length} feito, ${falhasSozinho.length} não deu` : "Não feito: o motivo está no item") : "Feito e conferido na Meta"}
          </span>
        ) : estado === "aberta" && confirmaveis === 0 && feitosSozinho.length > 0 && !ensaio ? (
          <span className="mb-1 mr-2 text-[11.5px] text-muted-foreground">Feito o que era seguro. Nada espera confirmação.</span>
        ) : estado === "aberta" ? (
          <>
            {confirmaveis > 0 || !ensaio ? (
              <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" disabled={!marcados.length || !!fazendo} onClick={() => void agir("confirmar")}>
                {fazendo === "confirmar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Confirmar {marcados.length}
              </Button>
            ) : (
              <span className="mb-1 mr-2 text-[11.5px] text-muted-foreground">Ensaio: nada para confirmar agora.</span>
            )}
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" disabled={!!fazendo} onClick={() => void agir("descartar")}>
              {fazendo === "descartar" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {confirmaveis > 0 || !ensaio ? "Cancelar" : "Dispensar"}
            </Button>
            <span className="mb-1 ml-auto text-[11px] text-muted-foreground">Sem custo de IA. Antes de mexer, o painel relê cada item na Meta: se mudou, não faz.</span>
          </>
        ) : null}
        {estado === "feita" && (
          <>
            <span className="mb-1 mr-2 inline-flex items-center rounded-full bg-success/15 px-2.5 py-1 text-[11.5px]">
              <Check className="mr-1 h-3 w-3" />
              Feito
            </span>
            {temDesfazer(atual) && (
              <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" disabled={!!fazendo} onClick={() => void agir("desfazer")}>
                {fazendo === "desfazer" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1.5 h-3.5 w-3.5" />}
                Desfazer
              </Button>
            )}
          </>
        )}
        {(estado === "descartada" || estado === "desfeita") && (
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11.5px] text-muted-foreground">
            <X className="mr-1 h-3 w-3" />
            {estado === "desfeita" ? "Desfeito: a conta voltou como estava onde deu" : feitosSozinho.length ? "Cancelado o resto: o que já fiz continua, com o Voltar de cada um" : "Cancelado: nada mudou"}
          </span>
        )}
        {atual.caminho && (estado === "feita" || feitosSozinho.length > 0) && <CaminhoPronto caminho={atual.caminho} abrirSozinho={irSozinho && !!atual.caminho.abrir_sozinho} className="ml-auto" />}
      </div>
    </section>
  );
}

/** A prova de um item feito: o estado relido na Meta logo depois, com a hora (e a resposta da Meta). */
function ProvaNaMeta({ i }: { i: ItemDaAcao }) {
  const r = i.resultado;
  if (!r || !r.depois) return null;
  const d = r.depois;
  const valor = i.tipo === "renomear" ? `nome "${d.nome || ""}"` : i.tipo === "orcamento" ? `${brl(d.orcamento_diario_brl)} por dia` : d.status === "PAUSED" ? "pausado" : d.status === "ACTIVE" ? "ativo" : d.status ? d.status.toLowerCase() : "sem status";
  const quando = r.relido_em || r.feito_em;
  const hora = quando && isFinite(Date.parse(quando)) ? new Date(Date.parse(quando) - 3 * 3600_000).toISOString().slice(11, 16) : "";
  return (
    <span className="mt-0.5 block text-[11.5px] text-success [overflow-wrap:anywhere]" data-prova-na-meta="">
      Conferido na Meta{hora ? ` às ${hora}` : ""}: {valor}
      {r.resposta && typeof r.resposta.success === "boolean" ? ` (a Meta respondeu ${r.resposta.success ? "sucesso" : "sem sucesso"})` : ""}.
    </span>
  );
}

/** A campanha que o agente monta (ou montou) a partir do plano: nome, verba, criativos e o anúncio modelo. */
function ResumoDaMontagem({ i }: { i: ItemDaAcao }) {
  const m = i.montagem;
  if (!m) return null;
  const r = i.resultado;
  const anuncios = r && r.ok && r.criado.anuncio_ids ? r.criado.anuncio_ids.split(",").filter(Boolean).length : 0;
  return (
    <span className="mt-0.5 block text-[11.5px] leading-snug [overflow-wrap:anywhere]" data-montagem="">
      <span className="block">
        {m.campanha_nome || m.plano_nome}
        {m.verba_diaria_brl !== null ? ` · ${brl(m.verba_diaria_brl)} por dia` : ""}
        {m.criativos.length ? ` · ${m.criativos.length} ${m.criativos.length === 1 ? "criativo" : "criativos"}` : ""}
      </span>
      {m.modelo && <span className="block text-muted-foreground">Página, público, destino e botão do anúncio {m.modelo.nome}.</span>}
      {r && r.ok && <span className="block text-muted-foreground">Montada na Meta e pausada: {anuncios} {anuncios === 1 ? "anúncio" : "anúncios"} em análise. Nada gasta até você ativar.</span>}
    </span>
  );
}

/**
 * "Levar ao Plano de teste": cria o plano já preenchido (hipótese, variável,
 * criativos, público, verba, duração, métrica e critério) a partir desta
 * análise, sem formulário vazio e sem gastar IA. A equipe só revisa.
 */
export function BotaoDoPlanoDoAgente({ mensagemId, onPlanoPronto, className = "" }: { mensagemId: string; onPlanoPronto?: (planoId: string) => void; className?: string }) {
  const avisarErro = useAvisarErro();
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [fazendo, setFazendo] = useState(false);
  const criar = async () => {
    setFazendo(true);
    try {
      const r = await criarPlanoDoAgente(mensagemId);
      await queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
      toast.success(r.jaExistia ? "Este plano já tinha sido criado" : "Plano de teste pronto para revisar", {
        description: r.lacunas.length ? `Falta decidir: ${r.lacunas.length} ponto(s), marcados no plano.` : "Hipótese, criativos, público, verba, duração e critério já preenchidos.",
      });
      if (r.planoId && onPlanoPronto) onPlanoPronto(r.planoId);
    } catch (e) {
      avisarErro(e, "O plano de teste não foi criado");
    } finally {
      setFazendo(false);
    }
  };
  return (
    <Button type="button" size="sm" variant="outline" className={`h-7 text-[11.5px] ${className}`} disabled={fazendo} onClick={() => void criar()} title="Cria o plano já preenchido com esta análise. Sem custo de IA.">
      {fazendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="mr-1 h-3.5 w-3.5" />}
      Levar ao Plano de teste (já preenchido)
    </Button>
  );
}
