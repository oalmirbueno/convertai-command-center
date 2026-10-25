import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, Copy, Download, Link2, Loader2, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { botao, campo, espaco, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataEHora } from "@/lib/mesa/api";
import { type CartaoDeDns, normalizarDominio, REGISTRADORES, ROTULO_DO_DOMINIO, type EstadoDoDominio } from "../../../supabase/functions/mesa-site/modulos/dns-do-site";
import { ehAberto } from "../../../supabase/functions/_shared/motor-codigo";
import { chamarSite, CHAVES, comAEdicaoDaPrevia, type LinhaDoSite, previaAtual, trabalhosDeCodigo, useGuardarSite, useTrabalhos } from "./siteApi";
import ChecagensAntesDePublicar, { type ResultadoDasChecagens } from "./ChecagensAntesDePublicar";
import { resumoDasChecagens } from "./checagensDoSite";
import { useChecklistDoSite } from "./ChecklistDeLancamento";
import { pendentesObrigatorios } from "../../../supabase/functions/_shared/site-lancamento";
import { useBarraDaEtapa } from "./BarraDaEtapa";
import Versoes from "./Versoes";
import { conferenciaAtual, travaDaPublicacao } from "../../../supabase/functions/mesa-site/modulos/obra-do-site";
import { type Comparacao, linhasDaComparacao } from "../../../supabase/functions/mesa-site/modulos/publicacao-nuvem";
// Frente CUS (01/10): o navegador do agente confere o site publicado (prints, velocidade e links quebrados).
import { BotaoDoNavegador, TarefasDoNavegador } from "@/components/agentes/NavegadorDoAgente";

type Estado = {
  vercel_ligada: boolean;
  faltas: string[];
  dominio: string | null;
  registrador: string;
  cartao: CartaoDeDns | null;
  estado: EstadoDoDominio;
  deploy_url: string | null;
  zip: { path: string; em: string | null } | null;
  // 20/10/2026 (Vercel da agência): a chave nos dois lados, a versão salva que sobe, o que está no ar e a comparação.
  vercel_no_servidor?: boolean;
  vercel_no_motor?: boolean | null;
  dominio_ligado?: boolean;
  versao?: { commit: string; em: string; previa_url: string | null } | null;
  publicado?: { deploy_url: string | null; commit: string | null; paginas: string[]; publicado_em: string | null; no_ar: boolean; tirado_em: string | null } | null;
  comparacao?: Comparacao | null;
};

/** "Falta:" em palavras da equipe: o item da chave da Vercel vira "a conta de publicação da agência" (o técnico fica no "?"). */
export const faltaNaTela = (f: string) => (/VERCEL_TOKEN/.test(f) ? (/worker/.test(f) && !/servidor/.test(f) ? "a chave de publicação no motor desta máquina" : "a conta de publicação da agência") : f);

/**
 * Etapa 8: publicação. Pelo painel, só vinculando o domínio: Vercel (deploy
 * no worker) e o cartão de DNS do registrador com os valores da API. Preparada
 * e desligada até haver a conta: sem a chave, "Baixar o site (zip)" e o que
 * falta. Publicar sempre com Confirmar.
 * UXS 30/09: o zip é um fluxo que termina (acompanha o trabalho "zip" e troca
 * para "Baixar agora" quando fica pronto); o domínio grava ao sair do campo e
 * no Enter, só quando muda; esqueleto na primeira leitura e erro com "Tentar
 * de novo". É a última etapa: a barra só tem o Voltar.
 * 19/10/2026: as checagens automáticas (borda, links, alt, contraste, títulos
 * e peso) ficam em cima, e o Confirmar do Publicar diz o que elas acharam.
 */
export default function EtapaPublicacao({ site, onPedirAoDiretor, onIrPara }: { site: LinhaDoSite; onPedirAoDiretor?: (texto: string) => void; /** Leva à etapa de um item que falta no checklist. */ onIrPara?: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const estadoQ = useQuery({ queryKey: CHAVES.publicacao(site.id), queryFn: () => chamarSite<Estado>("publicacao_estado", { site_id: site.id }) });
  const e = estadoQ.data;
  const [dominio, setDominio] = useState("");
  const [registrador, setRegistrador] = useState("registro_br");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [tirando, setTirando] = useState(false);
  const trabalhosQ = useTrabalhos(clientId, site.id);
  // SPV: só os trabalhos de código (a edição da prévia esperando não é montagem na fila).
  const trabalhos = trabalhosQ.data ? trabalhosDeCodigo(trabalhosQ.data.trabalhos) : [];
  const checklist = useChecklistDoSite(site, trabalhos);
  const pendentes = pendentesObrigatorios(checklist);
  const previaDoMotor = previaAtual(comAEdicaoDaPrevia(trabalhosQ.data ? { trabalhos, conteudo: trabalhosQ.data.conteudo } : null));
  const [checagens, setChecagens] = useState<ResultadoDasChecagens | null>(null);
  // Gravyx: a conferência no navegador do motor e as travas do Publicar (nada gerando, rascunho salvo,
  // nenhum problema grave a não ser com "publicar mesmo assim"). O servidor confere de novo.
  const conferenciaDoMotor = conferenciaAtual(trabalhos);
  const trava = travaDaPublicacao(trabalhos);
  const travaFixa = !trava.ok && trava.codigo !== "conferencia_com_problemas";
  const [mesmoAssim, setMesmoAssim] = useState(false);
  const resumoDaChecagem = checagens ? resumoDasChecagens(checagens.problemas) : null;
  // Uma gravação da publicação por vez: o servidor troca o JSON inteiro, e duas juntas desfariam uma delas.
  const gravando = useRef<Promise<unknown>>(Promise.resolve());

  // O zip pelo trabalho do motor (sobrevive a sair e voltar da etapa).
  const zipAberto = trabalhos.find((t) => t.tipo === "zip" && ehAberto(t.estado)) || null;
  const ultimoZip = trabalhos.find((t) => t.tipo === "zip") || null;
  const zipPronto = !!(e && e.zip) && !zipAberto;
  const zipFalhou = !zipAberto && !!ultimoZip && (ultimoZip.estado === "falhou" || ultimoZip.estado === "parado" || ultimoZip.estado === "cancelado");
  const motorDesligado = !!zipAberto && !!trabalhosQ.data && !trabalhosQ.data.vivo;
  const zipVisto = useRef<string | null>(null);
  // Pediu o zip nesta visita: quando ficar pronto, o botão vira "Baixar agora".
  const [pediuZip, setPediuZip] = useState(false);

  useEffect(() => {
    if (!e) return;
    setDominio(e.dominio || "");
    setRegistrador(e.registrador || "registro_br");
    dominioPedido.current = null;
    // Só quando o estado chega do servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e && e.dominio, e && e.registrador]);

  // O zip que ficou pronto: relê a publicação (o botão vira "Baixar agora"; o download sai do clique).
  useEffect(() => {
    if (!pediuZip || !ultimoZip || ultimoZip.estado !== "feito" || zipVisto.current === ultimoZip.id) return;
    zipVisto.current = ultimoZip.id;
    void qc.invalidateQueries({ queryKey: CHAVES.publicacao(site.id) });
  }, [pediuZip, ultimoZip && ultimoZip.id, ultimoZip && ultimoZip.estado, qc, site.id]);

  const rodar = async (rotulo: string, fn: () => Promise<void>): Promise<boolean> => {
    setOcupado(rotulo);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: CHAVES.publicacao(site.id) });
      return true;
    } catch (err) {
      avisarErro(err, rotulo);
      return false;
    } finally {
      setOcupado(null);
    }
  };

  /** Grava na fila (uma de cada vez). Com o domínio: só quando mudou (salvar o domínio zera o DNS vindo da Vercel). */
  const gravarPublicacao = (publicacao: Record<string, unknown>, rotulo: string): Promise<boolean> => {
    const vez = gravando.current.then(() =>
      rodar(rotulo, async () => {
        const d = await chamarSite<{ site: LinhaDoSite }>("site_salvar", { site_id: site.id, publicacao });
        guardar(d.site);
      }),
    );
    gravando.current = vez.catch(() => undefined);
    return vez;
  };
  // O domínio que já foi pedido (Enter e depois sair do campo não gravam duas vezes).
  const dominioPedido = useRef<{ valor: string | null } | null>(null);
  const salvarDominio = () => {
    const novo = dominio.trim() ? normalizarDominio(dominio) : null;
    const base = dominioPedido.current ? dominioPedido.current.valor : e ? e.dominio : null;
    if (dominio.trim() && !novo) {
      avisarErro(new Error("Esse domínio não parece válido. Ex.: cliente.com.br"), "O domínio não foi salvo");
      return;
    }
    if (novo === base) return;
    dominioPedido.current = { valor: novo };
    void gravarPublicacao({ dominio: novo }, "O domínio não foi salvo").then((ok) => {
      if (!ok) dominioPedido.current = null;
    });
  };
  const salvarRegistrador = (v: string) => {
    setRegistrador(v);
    // Só o registrador: mandar o domínio junto zeraria a configuração do DNS.
    void gravarPublicacao({ registrador: v }, "O registrador não foi salvo");
  };

  const baixar = () =>
    rodar("O zip não saiu", async () => {
      const d = await chamarSite<{ zip: { path: string } | null; trabalho?: { id: string }; ja_na_fila?: boolean; motor_ligado?: boolean }>("zip_pedir", { site_id: site.id });
      if (!d.zip) {
        // O useTrabalhos só relê de 4 em 4 s quando já vê um trabalho aberto: relê agora.
        // O estado (guardando, motor desligado, pronto) vem da lista de trabalhos, na linha da seção.
        setPediuZip(true);
        void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
        return;
      }
      const { data, error } = await supabase.storage.from("mesa").createSignedUrl(d.zip.path, 600, { download: `${site.projeto}.zip` });
      if (error || !data) throw error || new Error("Link do zip indisponível");
      window.location.assign(data.signedUrl);
    });

  const verificar = () => rodar("A verificação falhou", async () => void (await chamarSite("dominio_verificar", { site_id: site.id })));
  // O domínio no projeto do site na Vercel: devolve os registros de DNS de verdade e o estado da verificação.
  const ligarDominio = () =>
    rodar("O domínio não foi ligado", async () => {
      const d = await chamarSite<{ site: LinhaDoSite }>("dominio_ligar", { site_id: site.id });
      if (d && d.site) guardar(d.site);
    });
  // Só a versão salva que a comparação mostrou (o servidor recusa se outra foi salva no meio).
  const publicar = () =>
    rodar("A publicação não entrou na fila", async () => {
      await chamarSite("publicar", { site_id: site.id, confirmar: true, versao: e && e.versao ? e.versao.commit : undefined, mesmo_assim: trava.codigo === "conferencia_com_problemas" ? mesmoAssim : undefined });
      toast.success("Publicação na fila do motor.");
      setMesmoAssim(false);
    });
  const tirarDoAr = () =>
    rodar("O site não saiu do ar", async () => {
      const d = await chamarSite<{ site: LinhaDoSite; removidos: string[] }>("publicacao_tirar_do_ar", { site_id: site.id, confirmar: true });
      if (d && d.site) guardar(d.site);
      toast.success(d && d.removidos && d.removidos.length ? `Fora do ar: ${d.removidos.join(", ")}` : "Fora do ar.");
    });

  const copiar = (v: string) => {
    try {
      void navigator.clipboard.writeText(v);
      toast.success("Copiado");
    } catch {
      /* navegador sem área de transferência */
    }
  };

  const podePublicar = !!e && e.vercel_ligada && !e.faltas.length;
  const faltas = e ? e.faltas.map(faltaNaTela) : [];
  // Domínio, DNS e tirar do ar falam com a Vercel pelo servidor (resposta antiga sem o campo: segue vercel_ligada).
  const servidorLigado = !!e && (e.vercel_no_servidor === undefined ? e.vercel_ligada : e.vercel_no_servidor);
  const noAr = !!e && !!e.publicado && e.publicado.no_ar;
  const comparacao = e && e.comparacao ? linhasDaComparacao(e.comparacao) : [];

  // 25/10/2026 (dono: "mais intuitivo, completo"): um bloco só. Em cima o estado e o que falta (com a ação de
  // cada item); depois checagens, endereço e o que está no ar lado a lado; embaixo as versões. Cada informação
  // aparece uma vez: o estado do domínio só no Endereço, o "no ar" só na coluna No ar.
  const graves = resumoDaChecagem ? resumoDaChecagem.graves : 0;
  const pendentesDaTela = pendentes.filter((p) => ["dominio", "dns"].indexOf(p.id) < 0);
  const enderecoNoAr = e ? (e.dominio && e.estado === "certificado" ? `https://${e.dominio}/` : e.deploy_url) : null;
  const avisos = pendentesDaTela.length + graves;
  const estadoGeral: { pronto: boolean; texto: string } = !e
    ? { pronto: false, texto: "Lendo a publicação" }
    : faltas.length || !e.vercel_ligada
      ? { pronto: false, texto: "Publicação desligada: dá para baixar o zip" }
      : !trava.ok
        ? { pronto: false, texto: trava.codigo === "conferencia_com_problemas" ? "Publica só com a sua decisão" : "Ainda não dá para publicar" }
        : avisos
          ? { pronto: true, texto: `Pronto para publicar, com ${avisos} ${avisos === 1 ? "aviso" : "avisos"}` }
          : { pronto: true, texto: noAr ? "No ar · pronto para publicar de novo" : "Pronto para publicar" };
  const [modoDoEndereco, setModoDoEndereco] = useState<"padrao" | "proprio">("padrao");
  const dominioSalvo = e ? e.dominio : null;
  useEffect(() => {
    setModoDoEndereco(dominioSalvo ? "proprio" : "padrao");
  }, [dominioSalvo]);
  const usarEnderecoPadrao = () => {
    setModoDoEndereco("padrao");
    if (e && e.dominio) {
      setDominio("");
      dominioPedido.current = { valor: null };
      void gravarPublicacao({ dominio: null }, "O domínio não foi tirado");
    }
  };

  // A barra de baixo diz onde o site está (ou o estado geral), sem repetir o estado do domínio.
  useBarraDaEtapa({ estado: e ? (noAr && enderecoNoAr ? `No ar em ${enderecoNoAr.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : estadoGeral.texto) : null });

  // Primeira leitura: esqueleto; erro sem dado nenhum: o que houve e "Tentar de novo". Depois, o dado velho fica na tela.
  if (!e && estadoQ.isLoading) return <Carregando forma="lista" linhas={3} rotulo="Lendo a publicação" />;
  if (!e && estadoQ.isError)
    return (
      <EstadoDeErro
        titulo="A publicação não foi lida."
        acao={
          <button type="button" className={botao.discreto} onClick={() => void estadoQ.refetch()}>
            Tentar de novo
          </button>
        }
      />
    );

  return (
    <div className="min-w-0" data-etapa-publicacao="">
      <Secao
        titulo="Publicar"
        ajuda="Publicar leva a versão salva do site para a Vercel da agência (um projeto por site; as páginas ficam em caminhos, como / e /obrigado/), sem custo de IA. Antes, o Confirmar mostra o que entra, o que muda e o que sai do ar. O endereço padrão é o da Vercel; com domínio próprio, a mesa liga o domínio no projeto e mostra os registros de DNS do registrador. O deploy roda no motor (chave VERCEL_TOKEN no worker); domínio, DNS e tirar do ar passam pelo servidor (VERCEL_TOKEN nos segredos do Supabase ou em Chaves e custos). Tirar do ar remove os endereços do site publicado; as prévias por versão continuam. O zip é um projeto Vite completo, pronto para qualquer hospedagem."
        recolher={false}
        acao={
          <>
            {/* 16/10/2026: só ícone (nome no aria-label e no title). O Publicar ao lado mantém o texto: é a ação principal única da etapa. */}
            <button type="button" className={juntar(botao.icone, "mr-2")} aria-label={zipAberto ? "Guardando o código" : pediuZip && zipPronto ? "Baixar agora" : "Baixar o site (zip)"} title={zipAberto ? "Guardando o código" : pediuZip && zipPronto ? "Baixar agora" : "Baixar o site (zip)"} disabled={!!ocupado || !!zipAberto} onClick={() => void baixar()} data-baixar-zip="">
              {ocupado === "O zip não saiu" || zipAberto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </button>
            {noAr && (
              <button type="button" className={juntar(botao.icone, "mr-2")} aria-label="Tirar do ar" title={servidorLigado ? "Tirar do ar" : "Tirar do ar pede a chave da Vercel no servidor"} disabled={!!ocupado || !servidorLigado} onClick={() => setTirando(true)} data-tirar-do-ar="">
                {ocupado === "O site não saiu do ar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudOff className="h-4 w-4" />}
              </button>
            )}
            <button type="button" className={botao.primario} disabled={!podePublicar || !!ocupado || travaFixa} onClick={() => setConfirmando(true)} title={faltas.length ? `Falta: ${faltas.join("; ")}` : travaFixa ? trava.motivo || undefined : "Publicar a versão salva (sem custo de IA)"} data-publicar="" data-trava-da-publicacao={trava.codigo || "livre"}>
              {ocupado === "A publicação não entrou na fila" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1 h-3.5 w-3.5" />}
              {noAr ? "Publicar de novo" : "Publicar"}
            </button>
          </>
        }
      >
        {/* O estado, uma vez, e o que falta com a ação de cada item. */}
        <div className="mb-5 min-w-0" data-estado-da-publicacao={estadoGeral.pronto ? "pronto" : "falta"}>
          <p className={juntar(texto.corpo, "flex min-w-0 items-center font-medium")}>
            {estadoGeral.pronto ? <CheckCircle2 className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <AlertTriangle className="mr-2 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
            <span className="min-w-0 truncate">{estadoGeral.texto}</span>
          </p>
          {(faltas.length > 0 || !trava.ok || pendentesDaTela.length > 0 || (pediuZip && zipFalhou && !!ultimoZip) || motorDesligado) && (
            <ul className={juntar(lista.aberta, "mt-1")} data-pendencias-da-publicacao="">
              {faltas.length > 0 && (
                <li className={juntar(lista.linha, "py-1")} data-faltas-da-publicacao="">
                  <span className={juntar(texto.auxiliar, "mr-1 min-w-0 flex-1 whitespace-normal")}>Falta: {faltas.join("; ")}.</span>
                  <AjudaRecolhida rotulo="O que falta para publicar">
                    A publicação usa a Vercel da agência. O deploy roda no motor desta máquina (VERCEL_TOKEN no cofre do supervisor); domínio, DNS e tirar do ar usam a mesma chave no servidor (segredo VERCEL_TOKEN do Supabase ou Configurações › Chaves e custos; com conta de time, também VERCEL_TEAM_ID). Enquanto faltar, o zip resolve.
                  </AjudaRecolhida>
                </li>
              )}
              {!trava.ok && (
                <li className={juntar(lista.linha, "py-1")}>
                  <span className={juntar(texto.auxiliar, "min-w-0 flex-1 whitespace-normal", trava.codigo === "conferencia_com_problemas" ? "text-amber-700 dark:text-amber-400" : "text-destructive")} data-motivo-da-trava={trava.codigo || ""}>
                    {trava.motivo}
                  </span>
                </li>
              )}
              {motorDesligado && (
                <li className={juntar(lista.linha, "py-1")}>
                  <span className={juntar(texto.auxiliar, "min-w-0 flex-1 whitespace-normal")}>Motor desligado: o zip sai quando ele voltar.</span>
                </li>
              )}
              {pediuZip && zipFalhou && ultimoZip && (
                <li className={juntar(lista.linha, "py-1")}>
                  <span className={juntar(texto.auxiliar, "min-w-0 flex-1 whitespace-normal text-destructive")}>O último pedido do zip ficou {ultimoZip.estado === "falhou" ? "com falha" : ultimoZip.estado}: peça de novo.</span>
                </li>
              )}
              {pendentesDaTela.map((p) => (
                <li key={p.id} className={juntar(lista.linha, "py-1")} data-pendente-do-checklist={p.id}>
                  <span className={juntar(texto.auxiliar, "mr-2 min-w-0 flex-1 truncate")} title={p.detalhe || undefined}>
                    Falta no checklist: {p.rotulo.toLowerCase()}
                  </span>
                  {onIrPara && (
                    <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => onIrPara(p.etapa)} data-ir-para-pendente={p.etapa}>
                      Resolver
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={juntar(espaco.colunas, "lg:grid-cols-2 desk:grid-cols-3")}>
          {/* 1. Checagens: o que está ok e o que falta, com Ir até e Pedir ao diretor em cada item. */}
          <div className="min-w-0">
            <ChecagensAntesDePublicar embutida site={site} urlDoMotor={previaDoMotor ? previaDoMotor.preview_url : null} onPedirAoDiretor={onPedirAoDiretor} onResultado={setChecagens} conferenciaDoMotor={conferenciaDoMotor} trabalhos={trabalhos} />
          </div>

          {/* 2. Endereço: o padrão (Vercel) ou um domínio próprio, com o DNS do registrador. */}
          <div className="min-w-0" data-endereco-do-site={modoDoEndereco}>
            <h3 className="mb-2 text-[13px] font-semibold leading-5 text-foreground">Endereço</h3>
            <SeletorCompacto
              rotulo="Endereço do site"
              opcoes={[
                { valor: "padrao", rotulo: "Endereço padrão" },
                { valor: "proprio", rotulo: "Domínio próprio" },
              ]}
              valor={modoDoEndereco}
              onEscolher={(v) => (v === "padrao" ? usarEnderecoPadrao() : setModoDoEndereco("proprio"))}
              listaQuandoNaoCabe
            />
            {modoDoEndereco === "padrao" ? (
              <p className={juntar(texto.auxiliar, "mt-2 whitespace-normal")} data-endereco-padrao="">
                {e && e.deploy_url ? (
                  <a className="break-all text-primary underline-offset-2 hover:underline" href={e.deploy_url} target="_blank" rel="noopener noreferrer">
                    {e.deploy_url}
                  </a>
                ) : (
                  "O endereço da Vercel sai na primeira publicação. Dá para ligar um domínio próprio depois."
                )}
              </p>
            ) : (
              <div className="mt-2 min-w-0 space-y-2" data-dominio-proprio="">
                {/* Grava ao sair do campo e no Enter, como o registrador: um jeito só. */}
                <form
                  className="flex min-w-0 items-center"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    salvarDominio();
                  }}
                >
                  <input value={dominio} onChange={(ev) => setDominio(ev.target.value)} onBlur={salvarDominio} placeholder="cliente.com.br" className={juntar(campo, "mr-2 min-w-0 flex-1")} aria-label="Domínio do cliente" disabled={ocupado === "O domínio não foi salvo"} />
                  {ocupado === "O domínio não foi salvo" || ocupado === "O registrador não foi salvo" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Salvando" /> : null}
                  {e && e.dominio && servidorLigado && (
                    <button type="button" className={juntar(botao.icone, "shrink-0")} aria-label={e.dominio_ligado ? "Ligar o domínio de novo na Vercel" : "Ligar o domínio na Vercel"} title={e.dominio_ligado ? "Domínio ligado na Vercel (ligar de novo)" : "Ligar o domínio na Vercel e ver o DNS"} disabled={!!ocupado} onClick={() => void ligarDominio()} data-ligar-dominio={e.dominio_ligado ? "ligado" : "nao"}>
                      {ocupado === "O domínio não foi ligado" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    </button>
                  )}
                </form>
                <SeletorCompacto rotulo="Registrador do domínio" opcoes={REGISTRADORES.map((r) => ({ valor: r.id, rotulo: r.rotulo }))} valor={registrador} onEscolher={salvarRegistrador} listaQuandoNaoCabe />
                {e && e.dominio && (
                  <div className={juntar(texto.auxiliar, "flex min-w-0 items-center")} data-estado-do-dominio={e.estado}>
                    <span className="mr-1 min-w-0 flex-1 truncate">{e.cartao ? ROTULO_DO_DOMINIO[e.estado] : "Ligue o domínio para ver os registros de DNS"}</span>
                    {e.cartao && servidorLigado && (
                      // 16/10/2026: só ícone (nome no aria-label e no title).
                      <button type="button" className={botao.icone} aria-label="Verificar" title="Verificar o DNS" disabled={!!ocupado} onClick={() => void verificar()}>
                        <RefreshCw className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
                {e && e.cartao && (
                  <div className="min-w-0" data-registros-dns="">
                    <p className={texto.auxiliar}>Onde: {e.cartao.onde}</p>
                    <ul className={juntar(lista.aberta, lista.divisoria)} data-cartao-dns={e.cartao.registrador}>
                      {e.cartao.registros.map((r, i) => (
                        <li key={i} className={lista.linha}>
                          <span className={juntar(etiqueta, "mr-2 w-14 justify-center bg-muted")}>{r.tipo}</span>
                          <span className={juntar(texto.corpo, "mr-3 w-20 shrink-0 truncate font-medium")}>{r.nome}</span>
                          <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", !r.valor && "text-muted-foreground")} title={r.apoio || undefined}>
                            {r.valor || "aparece quando a Vercel responder"}
                          </span>
                          {r.valor && (
                            <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={`Copiar ${r.tipo} ${r.nome}`} onClick={() => copiar(String(r.valor))}>
                              <Copy className="h-4 w-4" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {/* Os cuidados continuam à vista, uma linha cada. */}
                    <ul className="list-disc space-y-0.5 pl-5">
                      {e.cartao.cuidados.map((c) => (
                        <li key={c} className={juntar(texto.auxiliar, "whitespace-normal")}>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. No ar: o link, a última publicação, a versão que sobe e a conferência no navegador. */}
          <div className="min-w-0" data-no-ar-da-publicacao="">
            <h3 className="mb-2 text-[13px] font-semibold leading-5 text-foreground">No ar</h3>
            {e && e.deploy_url && (
              <a className={juntar(texto.corpo, "block min-w-0 truncate text-primary underline")} href={enderecoNoAr || e.deploy_url} target="_blank" rel="noopener noreferrer" data-no-ar="">
                {enderecoNoAr || e.deploy_url}
              </a>
            )}
            {e && e.publicado ? (
              <p className={juntar(texto.auxiliar, "whitespace-normal")} data-publicado={e.publicado.no_ar ? "no_ar" : "fora_do_ar"}>
                {e.publicado.no_ar
                  ? `Desde ${dataEHora(e.publicado.publicado_em)}${e.publicado.commit ? ` · versão ${e.publicado.commit.slice(0, 8)}` : ""}${e.publicado.paginas.length ? ` · ${e.publicado.paginas.join(", ")}` : ""}`
                  : `Fora do ar desde ${dataEHora(e.publicado.tirado_em)}. Publicar põe de volta.`}
              </p>
            ) : (
              <p className={texto.auxiliar}>Ainda não publicado.</p>
            )}
            {e && e.versao && (
              <div className="mt-1 flex min-w-0 items-center" data-versao-a-publicar={e.versao.commit.slice(0, 8)}>
                <span className={juntar(texto.auxiliar, "mr-1 min-w-0 flex-1 truncate")}>Sobe a versão salva de {dataEHora(e.versao.em)} ({e.versao.commit.slice(0, 8)})</span>
                {e.versao.previa_url && (
                  <a className={botao.icone} href={e.versao.previa_url} target="_blank" rel="noopener noreferrer" aria-label="Abrir a prévia na nuvem da versão que sobe" title="Abrir prévia desta versão">
                    <Cloud className="h-4 w-4" />
                  </a>
                )}
              </div>
            )}
            {e && e.zip && <p className={texto.auxiliar}>Último código guardado: {dataEHora(e.zip.em)}</p>}
            {e && (e.dominio || e.deploy_url) && (
              <div className="min-w-0 pt-2" data-conferir-site-publicado="">
                <BotaoDoNavegador caso="conferir_site" clientId={clientId} origem="mesa_site" url={e.dominio ? `https://${e.dominio}/` : String(e.deploy_url)} rotulo="Conferir o site no ar" compacto />
              </div>
            )}
            <TarefasDoNavegador clientId={clientId} origem="mesa_site" titulo="Conferências do site publicado" casos={["conferir_site"]} />
          </div>
        </div>

        {/* As versões (o que já subiu e para onde voltar), embaixo, recolhíveis como no resto da mesa. */}
        <div className="mt-6 min-w-0 border-t border-border pt-4" data-versoes-da-publicacao="">
          <Versoes site={site} trabalhos={trabalhos} />
        </div>
      </Secao>
      <AlertDialog
        open={confirmando}
        onOpenChange={(v) => {
          setConfirmando(v);
          if (!v) setMesmoAssim(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar o site?</AlertDialogTitle>
            <AlertDialogDescription>
              O motor faz o build da versão salva{e && e.versao ? ` de ${dataEHora(e.versao.em)}` : ""} e publica na Vercel{e && e.dominio ? `, ligando ${e.dominio}` : ""}. O site fica público. Dá para publicar de novo depois de cada ajuste.
              {pendentes.length ? ` Ainda falta no checklist: ${pendentes.map((p) => p.rotulo.toLowerCase()).join("; ")}.` : " O checklist obrigatório está completo."}
              {resumoDaChecagem
                ? resumoDaChecagem.total
                  ? ` As checagens acharam ${resumoDaChecagem.total} ${resumoDaChecagem.total === 1 ? "problema" : "problemas"}${resumoDaChecagem.graves ? ` (${resumoDaChecagem.graves} ${resumoDaChecagem.graves === 1 ? "grave" : "graves"})` : ""}.`
                  : " As checagens não acharam problema."
                : " As checagens ainda não terminaram."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {comparacao.length > 0 && (
            <ul className="min-w-0 space-y-0.5" data-comparacao-com-o-ar="">
              {comparacao.map((l) => (
                <li key={l} className={juntar(texto.corpo, "whitespace-normal", l.indexOf("Sai do ar") === 0 && "text-amber-700 dark:text-amber-400")}>
                  {l}
                </li>
              ))}
              {e && e.comparacao && e.comparacao.estimada && <li className={juntar(texto.auxiliar, "whitespace-normal")}>Sem a prévia na nuvem desta versão: "pode mudar" é toda página que já está no ar.</li>}
            </ul>
          )}
          {trava.codigo === "conferencia_com_problemas" && (
            <label className={juntar(texto.corpo, "flex min-w-0 cursor-pointer items-start")} data-publicar-mesmo-assim="">
              <input type="checkbox" className="mr-2 mt-1 shrink-0" checked={mesmoAssim} onChange={(ev) => setMesmoAssim(ev.target.checked)} />
              <span className="min-w-0 whitespace-normal">{`Publicar mesmo assim: a conferência no navegador achou ${trava.graves} ${trava.graves === 1 ? "problema grave" : "problemas graves"} e a decisão é minha.`}</span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={trava.codigo === "conferencia_com_problemas" && !mesmoAssim} onClick={() => void publicar()} data-confirmar-publicar="">
              {pendentes.length || trava.codigo === "conferencia_com_problemas" ? "Publicar mesmo assim" : "Confirmar e publicar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={tirando} onOpenChange={setTirando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tirar o site do ar?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Os endereços do site publicado${e && e.dominio ? ` (${e.dominio} e o endereço da Vercel)` : ""} deixam de abrir. O código, as versões e as prévias na nuvem continuam; Publicar põe de volta.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void tirarDoAr()} data-confirmar-tirar-do-ar="">
              Confirmar e tirar do ar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
