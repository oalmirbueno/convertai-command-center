import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, BellRing, Check, Download, FileSignature, Loader2, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCelular } from "@/hooks/useCelular";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import Etapas from "@/components/sistema/Etapas";
import MenuMais from "@/components/sistema/MenuMais";
import BarraDeAcoes from "@/components/sistema/BarraDeAcoes";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, CHAVES_DOS_CONTRATOS, type PayloadDoContrato } from "@/lib/contratos/api";
import DocumentoDoContrato from "./DocumentoDoContrato";
import { ClausulasDoContrato, DadosDoContrato, HistoricoDoContrato, JanelaDeAssinar } from "./PartesDoContrato";
import { JanelaDeEnvio } from "./JanelaDeEnvio";
// Frente CON2: quem assina, lembrete, aditivo e renovação.
import AssinantesDoContrato from "./AssinantesDoContrato";
import { JanelaDeAditivo, JanelaDeLembrete } from "./JanelasDoCiclo";
import {
  assinantesNaTela,
  comAssinantes,
  comServicos,
  comValor,
  conflitos,
  pendencias,
  rascunhoValido,
  semAssinantes,
  semServicos,
  semValores,
  servicosNaTela,
  textoDasPendencias,
  valoresNaTela,
  type LinhaDeAssinante,
  type RascunhoDoContrato,
} from "./rascunhoDoContrato";
import { validarSignatarios } from "../../../supabase/functions/contratos/modulos/contrato-ciclo";
import { mensagensProntas, nomeDoArquivoDoContrato, STATUS_DO_CONTRATO } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * O contrato de modelo aberto em /contratos?client=<id>&contrato=<id>
 * (frente CON, 30/09). Documento (prévia HTML ou o texto travado com o
 * código), dados, cláusulas, assinantes e histórico (versões e eventos).
 * Ações: assinar pela agência (trava o texto), enviar (mensagem pronta, a
 * pessoa envia), nova versão (o link anterior deixa de valer), cancelar
 * (arquivar) e baixar o PDF.
 *
 * UXS (30/09): o que a pessoa muda em Dados e em Assinantes fica guardado
 * (rascunhoDoContrato.ts) ao trocar de parte, de contrato ou sair; a barra
 * de baixo mostra "Tudo salvo" ou "n alterações · Salvar"; com alteração
 * pendente o primário do cabeçalho vira "Salvar e assinar" (salva e só
 * depois abre a assinatura). No celular, Lembrete e PDF vão para o "...".
 */

const PARTES = [
  { valor: "documento", rotulo: "Documento" },
  { valor: "dados", rotulo: "Dados" },
  { valor: "clausulas", rotulo: "Cláusulas" },
  { valor: "assinantes", rotulo: "Assinantes" },
  { valor: "historico", rotulo: "Histórico" },
];
/** Quem tinha "Versões" ou "Trilha" guardado cai no Histórico (as duas viraram uma parte). */
const PARTES_ANTIGAS: Record<string, string> = { versoes: "historico", trilha: "historico" };

const COR_DO_STATUS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
  substituido: "bg-muted text-muted-foreground",
};

function baixar(bytes: Uint8Array, nome: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function DetalheDoContrato({
  contratoId,
  aoVoltar,
  aoAbrir,
  nomeDoCliente,
  emailDoCliente,
}: {
  contratoId: string;
  aoVoltar: () => void;
  aoAbrir: (id: string) => void;
  nomeDoCliente: string;
  /** Para quem vai o "Enviar por e-mail" (null: o cliente não tem e-mail). */
  emailDoCliente?: string | null;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const celular = useCelular();
  const [parteGuardada, setParte] = useEstadoDaTela<string>(`contratos:parte:${contratoId}`, "documento", {
    validar: (v) => typeof v === "string" && (PARTES.some((p) => p.valor === v) || !!PARTES_ANTIGAS[v]),
  });
  const parte = PARTES_ANTIGAS[parteGuardada] || parteGuardada;
  // O que a pessoa mudou e ainda não salvou (Dados e Assinantes): sobrevive à troca de parte, de contrato e à volta à página.
  const [rascunhoGuardado, setRascunho, esquecerRascunho] = useEstadoDaTela<RascunhoDoContrato | null>(`contratos:rascunho:${contratoId}`, null, { validar: rascunhoValido, esperaMs: 300 });
  const [assinando, setAssinando] = useState(false);
  const [envio, setEnvio] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [lembrando, setLembrando] = useState(false);
  const [aditivo, setAditivo] = useState(false);
  const consulta = useQuery({ queryKey: CHAVES_DOS_CONTRATOS.um(contratoId), queryFn: () => chamarContratos("ler", { contract_id: contratoId }) });
  const p = consulta.data;
  const editavel = !!p && p.contrato.status === "draft" && !p.contrato.congelado_em;

  // Deixou de ser rascunho (assinado, cancelado): o guardado não vale mais.
  useEffect(() => {
    if (p && !editavel && rascunhoGuardado) esquecerRascunho();
  }, [p, editavel, rascunhoGuardado, esquecerRascunho]);

  const aplicar = (novo: PayloadDoContrato) => {
    qc.setQueryData(CHAVES_DOS_CONTRATOS.um(novo.contrato.id), novo);
    void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
    void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.diff(novo.contrato.id) });
  };

  if (consulta.isLoading) return <Carregando forma="aba" rotulo="Abrindo o contrato" />;
  if (consulta.isError || !p) {
    return (
      <EstadoDeErro
        titulo={textoDoErro(consulta.error, "Não foi possível abrir o contrato.")}
        acao={
          <button type="button" className={botao.secundario} onClick={() => consulta.refetch()}>
            Tentar de novo
          </button>
        }
      />
    );
  }

  const c = p.contrato;
  const rascunho = editavel;
  const enviado = c.status === "sent";
  const assinado = c.status === "completed";
  const encerrado = c.status === "cancelled" || c.status === "substituido";
  const faltam = p.montado ? p.montado.faltando.length : 0;
  const numerosAlterados = p.montado ? p.montado.clausulas.filter((x) => x.alterada).map((x) => x.numero.replace(/\.$/, "")) : [];
  const link = c.sign_url || (enviado ? `${window.location.origin}/contrato/${c.sign_token}` : null);
  const mensagens = p.mensagens || (enviado && c.documento_hash && link ? mensagensProntas({ cliente: nomeDoCliente || "cliente", titulo: c.title, link, hash: c.documento_hash, agencia: "Aceleriq" }) : null);

  // ---------------------------------------------------------------- rascunho (o que falta salvar)
  const r = rascunho ? rascunhoGuardado : null;
  const valores = valoresNaTela(p, r);
  const servicos = servicosNaTela(p, r);
  const linhas = assinantesNaTela(p, r);
  const pend = pendencias(p, r);
  const errosDeAssinantes = pend.assinantes ? validarSignatarios(linhas).erros : [];
  const emConflito = conflitos(p, r);
  const pendente = rascunho && pend.total > 0;
  const soAssinantesComErro = pend.total === (pend.assinantes ? 1 : 0) && errosDeAssinantes.length > 0;

  const mudarValor = (chave: string, valor: string) => setRascunho((x) => comValor(p, x, chave, valor));
  const mudarServicos = (lista: string[]) => setRascunho((x) => comServicos(p, x, lista));
  const mudarAssinantes = (l: LinhaDeAssinante[]) => setRascunho((x) => comAssinantes(p, x, l));
  const soltar = (chaves: string[]) => setRascunho((x) => semValores(x, chaves));

  /**
   * Salva o que falta, na ordem serviços, dados e quem assina. Cada parte que
   * salvou sai do rascunho; se uma falha, o resto continua guardado. Quem
   * assina com erro fica para depois (o resto salva). `completo`: nada ficou.
   */
  const salvarTudo = async (): Promise<{ novo: PayloadDoContrato; completo: boolean } | null> => {
    const agora = rascunhoGuardado;
    if (!agora) return { novo: p, completo: true };
    const falta = pendencias(p, agora);
    let novo = p;
    setSalvando(true);
    try {
      if (falta.servicos && agora.servicos) {
        const lista = agora.servicos;
        novo = await chamarContratos("servicos_mudar", { contract_id: c.id, servicos: lista });
        aplicar(novo);
        setRascunho((x) => semServicos(x, lista));
      }
      if (falta.valores.length) {
        const envio: Record<string, string> = {};
        falta.valores.forEach((k) => (envio[k] = agora.valores[k]));
        novo = await chamarContratos("salvar", { contract_id: c.id, variaveis: envio });
        aplicar(novo);
        setRascunho((x) => semValores(x, Object.keys(envio), envio));
      }
      let completo = true;
      if (falta.assinantes && agora.assinantes) {
        const lista = agora.assinantes;
        const erros = validarSignatarios(lista).erros;
        if (erros.length) {
          completo = false;
          if (falta.valores.length || falta.servicos) toast.error("Quem assina ficou para depois", { description: erros[0] });
        } else {
          novo = await chamarContratos("signatarios_salvar", { contract_id: c.id, signatarios: lista });
          aplicar(novo);
          setRascunho((x) => semAssinantes(x, lista));
        }
      }
      // Campo tocado que ficou igual ao salvo não é pendência: sai também.
      const salvo = novo;
      setRascunho((x) => (x && pendencias(salvo, x).total === 0 ? null : x));
      return { novo, completo };
    } catch (e) {
      toast.error("Não foi salvo", { description: textoDoErro(e) });
      return null;
    } finally {
      setSalvando(false);
    }
  };

  const salvar = async () => {
    const feito = await salvarTudo();
    if (feito && feito.completo) toast.success("Contrato salvo");
  };

  /** Com alteração pendente: salva e só abre a assinatura se o servidor liberar (o texto assinado é o salvo). */
  const salvarEAssinar = async () => {
    const feito = await salvarTudo();
    if (!feito || !feito.completo) return;
    if (feito.novo.pode_congelar.pode) {
      setParte("documento"); // quem marca "Li o contrato" vê por trás o texto que vai assinar
      setAssinando(true);
    } else {
      toast.error("Ainda não dá para assinar", { description: feito.novo.pode_congelar.motivo || undefined });
      setParte("dados");
    }
  };

  const descartar = () => {
    const antes = rascunhoGuardado;
    esquecerRascunho();
    toast("Alterações descartadas", { action: { label: "Desfazer", onClick: () => setRascunho(antes) } });
  };

  const baixarPrevia = async () => {
    if (!p.texto) return;
    try {
      const { gerarPdfDoContrato } = await import("../../../supabase/functions/_shared/pdf-contrato");
      baixar(gerarPdfDoContrato({ texto: p.texto, numero: c.numero || "", versao: c.versao }), nomeDoArquivoDoContrato(`${c.numero || ""}-previa`, nomeDoCliente, c.versao));
    } catch (e) {
      toast.error("A prévia não foi gerada", { description: textoDoErro(e) });
    }
  };
  const abrirPdf = async () => {
    try {
      const resposta = await chamarContratos<{ url: string }>("pdf_link", { contract_id: c.id });
      window.open(resposta.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error("O PDF não abriu", { description: textoDoErro(e) });
    }
  };
  const novaVersao = async () => {
    setOcupado(true);
    try {
      const novo = await chamarContratos("nova_versao", { contract_id: c.id });
      aplicar(novo);
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.um(c.id) });
      toast.success(`Versão ${novo.contrato.versao} criada`, { description: enviado ? "O link da versão anterior deixou de valer." : undefined });
      aoAbrir(novo.contrato.id);
    } catch (e) {
      toast.error("A versão nova não foi criada", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };
  const renovar = async () => {
    setOcupado(true);
    try {
      const novo = await chamarContratos("renovar", { contract_id: c.id });
      aplicar(novo);
      toast.success(novo.ja_existia ? "A renovação já estava pronta" : `Renovação ${novo.contrato.numero || ""} em rascunho`, { description: novo.ja_existia ? undefined : "Começa no dia seguinte ao fim deste contrato. Confira os valores." });
      aoAbrir(novo.contrato.id);
    } catch (e) {
      toast.error("A renovação não foi preparada", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };
  const cancelar = async () => {
    setCancelando(false);
    try {
      await chamarContratos<{ resultado: unknown }>("cancelar", { contract_id: c.id });
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.um(c.id) });
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
      toast.success(assinado ? "Contrato arquivado" : "Contrato cancelado", { description: enviado ? "O link de assinatura deixou de valer." : undefined });
    } catch (e) {
      toast.error("Não foi possível", { description: textoDoErro(e) });
    }
  };

  const tipo = c.tipo_documento === "aditivo" ? "aditivo" : c.tipo_documento === "renovacao" ? "renovação" : null;
  const fim = p.vigencia && p.vigencia.fim ? p.vigencia.fim.split("-").reverse().join("/") : null;
  const ligados = p.ligados || { aditivos: [], renovacao: null, mae: null, renova: null };
  const rotuloDoStatus = STATUS_DO_CONTRATO[c.status] || c.status;
  // Estado curto (UXS): número, tipo, versão só a partir da 2, o status só no celular (a etiqueta some lá) e vigência ou faltas. O código fica no Documento e no Histórico.
  const antes = [c.numero, tipo, c.versao > 1 ? `versão ${c.versao}` : null].filter(Boolean) as string[];
  const depois = [fim && !rascunho ? `vigência até ${fim}` : null, rascunho && faltam ? `${faltam} ${faltam === 1 ? "campo falta" : "campos faltam"}` : null].filter(Boolean) as string[];
  const estado: ReactNode = (
    <>
      {antes.join(" · ")}
      <span className="sm:hidden">
        {antes.length ? " · " : ""}
        {rotuloDoStatus}
      </span>
      {depois.length ? (
        <>
          {antes.length ? " · " : <span className="sm:hidden"> · </span>}
          {depois.join(" · ")}
        </>
      ) : null}
    </>
  );

  const motivoDeNaoAssinar = !p.agencia.completa ? "Faltam os dados da agência." : pendente ? errosDeAssinantes[0] || undefined : p.pode_congelar.motivo || undefined;
  const podeAssinar = pendente ? p.agencia.completa && !errosDeAssinantes.length : p.pode_congelar.pode && p.agencia.completa;

  const estadoDaBarra: ReactNode = salvando ? (
    "Salvando..."
  ) : !pend.total ? (
    "Tudo salvo"
  ) : (
    <>
      <span className="font-medium text-foreground">{textoDasPendencias(pend.total)}</span>
      {emConflito.length > 0 && (
        <span className="text-warning">
          {" · "}
          {emConflito.length === 1
            ? `o agente também mudou ${emConflito[0] === "servicos" ? "os serviços" : `"${(p.variaveis.find((v) => v.nome === emConflito[0]) || { rotulo: emConflito[0] }).rotulo}"`}; ficou o seu`
            : `o agente também mudou ${emConflito.length} campos que você editou; ficou o seu`}
        </span>
      )}
      {/* O erro inteiro aparece em Assinantes e no "Assinar" (title); aqui só onde mexer. */}
      {errosDeAssinantes.length > 0 && <span className="text-warning"> · falta ajustar quem assina</span>}
    </>
  );

  return (
    <div className="min-w-0 space-y-5" data-detalhe-do-contrato={c.id}>
      <div className="flex min-w-0 items-center">
        <button type="button" onClick={aoVoltar} className={juntar(botao.icone, "mr-1")} aria-label="Voltar para a lista">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <CabecalhoDeSecao
          className="min-w-0 flex-1"
          titulo={c.title}
          descricao={estado}
          ajuda={`Modelo ${p.revisao_juridica || "sem revisão registrada"}. Só a equipe vê esta marca; o cliente nunca. O rascunho muda à vontade; ao assinar pela agência, o texto trava com um código SHA-256 e qualquer mudança depois vira versão nova, com link novo.`}
          acao={
            <div className="flex min-w-0 items-center [&>*+*]:ml-1.5">
              <span className={juntar(etiqueta, "hidden sm:inline-flex", COR_DO_STATUS[c.status] || COR_DO_STATUS.draft)}>{rotuloDoStatus}</span>
              {rascunho && (
                <button
                  type="button"
                  className={botao.primario}
                  disabled={!podeAssinar || salvando}
                  title={motivoDeNaoAssinar}
                  aria-label={pendente ? "Salvar e assinar pela agência" : "Assinar pela agência"}
                  onClick={() => (pendente ? void salvarEAssinar() : setAssinando(true))}
                >
                  {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <FileSignature className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  {/* No celular o texto é curto (o título precisa de lugar); o nome inteiro fica no aria-label e a barra de baixo mostra o que falta salvar. */}
                  <span className="sm:hidden">Assinar</span>
                  <span className="hidden sm:inline">{pendente ? "Salvar e assinar" : "Assinar pela agência"}</span>
                </button>
              )}
              {enviado && (
                <button type="button" className={botao.primario} onClick={() => setEnvio(true)} aria-label={c.sent_at ? "Reenviar" : "Enviar"}>
                  <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {c.sent_at ? "Reenviar" : "Enviar"}
                </button>
              )}
              {/* No celular, Lembrete e PDF vão para o "..." (mesma flag de largura para os dois lugares). */}
              {enviado && !celular && (
                <button type="button" className={botao.secundario} onClick={() => setLembrando(true)} aria-label="Lembrete de assinatura">
                  <BellRing className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Lembrete
                </button>
              )}
              {(enviado || assinado) && !celular && (
                <button type="button" className={botao.secundario} onClick={() => void abrirPdf()} aria-label="Abrir o PDF">
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {assinado ? "PDF assinado" : "PDF"}
                </button>
              )}
              <MenuMais
                itens={[
                  enviado && celular && { rotulo: "Lembrete de assinatura", icone: <BellRing className="h-4 w-4" />, aoEscolher: () => setLembrando(true) },
                  (enviado || assinado) && celular && { rotulo: assinado ? "PDF assinado" : "PDF", icone: <Download className="h-4 w-4" />, aoEscolher: () => void abrirPdf() },
                  rascunho && { rotulo: "Baixar prévia em PDF", aoEscolher: () => void baixarPrevia() },
                  (enviado || assinado) && { rotulo: assinado ? "Versão nova (aditivo)" : "Versão nova", aoEscolher: () => void novaVersao(), desativado: ocupado },
                  !!c.substituido_por && { rotulo: "Abrir a versão nova", aoEscolher: () => aoAbrir(String(c.substituido_por)) },
                  assinado && c.tipo_documento !== "aditivo" && { rotulo: "Criar aditivo", aoEscolher: () => setAditivo(true) },
                  assinado && c.tipo_documento !== "aditivo" && !!fim && { rotulo: ligados.renovacao ? "Abrir a renovação" : "Preparar renovação", aoEscolher: () => (ligados.renovacao ? aoAbrir(String(ligados.renovacao.id)) : void renovar()), desativado: ocupado },
                  !encerrado && !c.arquivado_em && { rotulo: assinado ? "Arquivar" : "Cancelar contrato", aoEscolher: () => setCancelando(true), perigo: true, separadorAntes: true },
                ]}
              />
            </div>
          }
        />
      </div>

      {!p.agencia.completa && rascunho && (
        <p className={juntar(texto.corpo, "flex min-w-0 items-start text-warning")} role="alert" data-agencia-incompleta="">
          <AlertTriangle className="mr-1.5 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            Sem os dados da agência o contrato não é gerado. Falta: {p.agencia.faltando.join(", ")}.{" "}
            <Link to="/config" className="underline">
              Preencher
            </Link>
          </span>
        </p>
      )}
      {c.status === "substituido" && <p className={juntar(texto.auxiliar, "text-warning")}>Esta versão foi substituída; o link dela não vale mais.</p>}
      {(ligados.mae || ligados.renova || ligados.aditivos.length > 0 || ligados.renovacao) && (
        <p className={juntar(texto.auxiliar, "flex min-w-0 flex-wrap items-center [&>*]:mr-3")} data-documentos-ligados="">
          {ligados.mae && (
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => aoAbrir(String(ligados.mae!.id))}>
              Aditivo do contrato {ligados.mae.numero}
            </button>
          )}
          {ligados.renova && (
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => aoAbrir(String(ligados.renova!.id))}>
              Renova o contrato {ligados.renova.numero}
            </button>
          )}
          {ligados.aditivos.map((a) => (
            <button key={a.id} type="button" className="underline-offset-2 hover:underline" onClick={() => aoAbrir(a.id)}>
              Aditivo {a.numero} ({STATUS_DO_CONTRATO[a.status] || a.status})
            </button>
          ))}
          {ligados.renovacao && (
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => aoAbrir(String(ligados.renovacao!.id))}>
              Renovação {ligados.renovacao.numero} ({STATUS_DO_CONTRATO[ligados.renovacao.status] || ligados.renovacao.status})
            </button>
          )}
        </p>
      )}

      <Etapas
        rotulo="Partes do contrato"
        itens={PARTES.map((x) => ({ ...x, contador: x.valor === "dados" && rascunho ? faltam || null : x.valor === "assinantes" && enviado ? (p.signatarios || []).filter((s) => s.obrigatorio && !s.assinado_em).length || null : null }))}
        valor={parte}
        onEscolher={setParte}
      />

      {parte === "documento" && (p.texto ? <DocumentoDoContrato texto={p.texto} hash={c.documento_hash} alteradas={numerosAlterados} /> : <EstadoDeErro titulo="Contrato de arquivo: abra o PDF pela lista." />)}
      {parte === "dados" && (
        <DadosDoContrato p={p} editavel={rascunho} aoMudar={aplicar} valores={valores} servicos={servicos} aoMudarValor={mudarValor} aoMudarServicos={mudarServicos} aoSoltar={soltar} />
      )}
      {parte === "clausulas" && <ClausulasDoContrato p={p} editavel={rascunho} aoMudar={aplicar} />}
      {parte === "assinantes" && <AssinantesDoContrato p={p} editavel={rascunho} aoMudar={aplicar} linhas={linhas} aoMudarLinhas={mudarAssinantes} valores={valores} />}
      {parte === "historico" && <HistoricoDoContrato p={p} aoAbrir={aoAbrir} />}

      {/* Sempre à vista no rascunho (sem salto). Abaixo de 1024 px fica acima do botão flutuante do agente (bottom 84 px + 44 px). */}
      {rascunho && (
        <BarraDeAcoes fixa className="bottom-[68px] md:bottom-[80px] lg:bottom-0" inicio={<span data-estado-do-rascunho="">{estadoDaBarra}</span>}>
          {pend.total > 0 && !salvando && (
            <button type="button" className={botao.discreto} onClick={descartar}>
              Descartar
            </button>
          )}
          <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || !pend.total || soAssinantesComErro}>
            {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Salvar
          </button>
        </BarraDeAcoes>
      )}

      <JanelaDeAssinar
        aberta={assinando}
        aoFechar={() => setAssinando(false)}
        p={p}
        nomeInicial={profile?.full_name || ""}
        aoAssinar={(novo) => {
          aplicar(novo);
          setAssinando(false);
          setEnvio(true);
          toast.success("Contrato assinado pela agência", { description: "Agora escolha como enviar ao cliente." });
        }}
      />
      <JanelaDeEnvio
        aberta={envio}
        aoFechar={() => setEnvio(false)}
        contrato={{ id: c.id, title: c.title, sent_at: c.sent_at, documento_hash: c.documento_hash }}
        signatarios={p.signatarios}
        eventos={p.eventos}
        mensagens={mensagens}
        link={link}
        emailDoCliente={emailDoCliente}
        aoEnviado={() => {
          void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.um(c.id) });
          void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
        }}
      />
      {enviado && <JanelaDeLembrete aberta={lembrando} aoFechar={() => setLembrando(false)} contratoId={c.id} />}
      {assinado && (
        <JanelaDeAditivo
          aberta={aditivo}
          aoFechar={() => setAditivo(false)}
          p={p}
          aoCriar={(novo) => {
            setAditivo(false);
            aplicar(novo);
            aoAbrir(novo.contrato.id);
          }}
        />
      )}
      <ConfirmModal
        open={cancelando}
        onCancel={() => setCancelando(false)}
        title={assinado ? "Arquivar o contrato?" : "Cancelar o contrato?"}
        description={enviado ? "O link de assinatura deixa de valer. O contrato fica arquivado." : "O contrato fica arquivado."}
        confirmLabel={assinado ? "Arquivar" : "Cancelar contrato"}
        onConfirm={() => void cancelar()}
      />
    </div>
  );
}
