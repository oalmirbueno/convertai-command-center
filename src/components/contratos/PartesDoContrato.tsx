import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, FileInput, Loader2, Mail, MessageCircle, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, juntar, lista, rolagem, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { supabase } from "@/integrations/supabase/client";
import { chamarContratos, CHAVES_DOS_CONTRATOS, type PayloadDoContrato, type RespostaDoDiff } from "@/lib/contratos/api";
import { LinhasDoDiff, PartesDoDiff } from "./DiffDeTexto";
// Frente CON2: Preencher com IA (peça comum), ficha fiscal e sugestão de cláusula com a diferença antes de gravar.
import { PreencherComIA, type ResultadoDoPreenchimento } from "@/components/sistema";
import { campoDaClausula, camposDasVariaveis, valoresDaIA } from "@/lib/contratos/preencher";
import DadosFiscaisDoCliente from "./DadosFiscaisDoCliente";
import {
  diffDeTexto,
  mensagensProntas,
  ROTULO_DO_SERVICO,
  SERVICOS_DO_CONTRATO,
  type ServicoDoContrato,
  type VariavelDoModelo,
} from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * As partes do contrato aberto na tela /contratos (frente CON, 30/09):
 * dados (variáveis e serviços), cláusulas (com a diferença antes de mudar),
 * versões (diferença entre elas), trilha, e as janelas de assinar pela
 * agência e de envio (mensagem pronta; nada sai sozinho).
 */

const ROTULO_DO_GRUPO: Record<string, string> = { aditivo: "O que muda", cliente: "Contratante", quadro: "Quadro-resumo", servico: "Serviços", extras: "Cláusulas extras" };
const ORDEM_DOS_GRUPOS = ["aditivo", "cliente", "quadro", "servico", "extras"];

// ------------------------------------------------------------------ dados

export function DadosDoContrato({ p, editavel, aoMudar }: { p: PayloadDoContrato; editavel: boolean; aoMudar: (novo: PayloadDoContrato) => void }) {
  const [valores, setValores] = useState<Record<string, string>>(p.valores || {});
  const [servicos, setServicos] = useState<string[]>(p.contrato.servicos || []);
  const [salvando, setSalvando] = useState(false);
  const [fichaAberta, setFichaAberta] = useState(false);
  useEffect(() => {
    setValores(p.valores || {});
    setServicos(p.contrato.servicos || []);
  }, [p.contrato.id, p.contrato.updated_at]);
  const faltando = useMemo(() => {
    const m: Record<string, string> = {};
    (p.montado ? p.montado.faltando : []).forEach((f) => (m[f.nome] = f.motivo === "invalida" ? f.detalhe || "inválido" : "falta"));
    return m;
  }, [p.montado]);
  const aditivo = p.contrato.tipo_documento === "aditivo";
  const fora = p.extras_fora || [];
  // Cláusula extra fora da biblioteca some com os campos dela (extra_x e extra_x_*).
  const visivel = (v: VariavelDoModelo) => !fora.some((k) => v.nome === k || v.nome.indexOf(`${k}_`) === 0);
  const grupos: Array<{ grupo: string; vars: VariavelDoModelo[] }> = ORDEM_DOS_GRUPOS.map((g) => ({ grupo: g, vars: p.variaveis.filter((v) => (v.grupo || "quadro") === g && visivel(v)) }));
  const mudou = Object.keys(valores).some((k) => (valores[k] || "") !== (p.valores[k] || "")) || Object.keys(p.valores).some((k) => (valores[k] || "") !== (p.valores[k] || ""));
  const servicosMudaram = servicos.slice().sort().join(",") !== (p.contrato.servicos || []).slice().sort().join(",");
  const contextoDaTela = `Contrato ${p.contrato.numero || ""} "${p.contrato.title}", ${aditivo ? "termo aditivo" : p.contrato.tipo_documento === "renovacao" ? "renovação" : "contrato"} dos serviços: ${(p.contrato.servicos || []).map((s) => ROTULO_DO_SERVICO[s as ServicoDoContrato] || s).join(", ") || "nenhum"}.`;

  const salvar = async () => {
    setSalvando(true);
    try {
      let novo = p;
      if (servicosMudaram) novo = await chamarContratos("servicos_mudar", { contract_id: p.contrato.id, servicos });
      if (mudou) novo = await chamarContratos("salvar", { contract_id: p.contrato.id, variaveis: valores });
      aoMudar(novo);
      toast.success("Contrato salvo");
    } catch (e) {
      toast.error("Não foi salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  /** A IA mostrou a prévia e a pessoa aplicou: grava na hora (o Desfazer da peça volta os anteriores). */
  const gravarDaIA = async (vindos: Record<string, unknown>, r: ResultadoDoPreenchimento) => {
    const novos = valoresDaIA(p.variaveis, vindos);
    if (!Object.keys(novos).length) return;
    const novo = await chamarContratos("salvar", { contract_id: p.contrato.id, variaveis: { ...valores, ...novos }, preenchido_ia: { modelo_id: r.modelo_id, fontes: r.fontes } });
    aoMudar(novo);
  };
  const desfazerDaIA = async (anteriores: Record<string, unknown>) => {
    const volta: Record<string, string> = { ...valores };
    Object.keys(anteriores).forEach((k) => (volta[k] = anteriores[k] === null || anteriores[k] === undefined ? "" : String(anteriores[k])));
    aoMudar(await chamarContratos("salvar", { contract_id: p.contrato.id, variaveis: volta }));
  };

  const puxarDaFicha = (vindos: Record<string, string>) => {
    const k = Object.keys(vindos).filter((x) => (valores[x] || "") !== vindos[x]);
    if (!k.length) {
      toast.info("O contrato já está com os dados da ficha");
      return;
    }
    setValores((o) => ({ ...o, ...vindos }));
    toast.success(`${k.length} campos do contratante vieram da ficha`, { description: "Confira e salve o contrato." });
  };

  return (
    <div className="min-w-0 space-y-6" data-dados-do-contrato="">
      {editavel && (
        <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
          <button type="button" className={botao.secundario} onClick={() => puxarDaFicha((p.ficha && p.ficha.valores) || {})} disabled={!p.ficha || !p.ficha.existe} title={p.ficha && p.ficha.existe ? undefined : "O cliente ainda não tem ficha fiscal"}>
            <FileInput className="mr-1.5 h-4 w-4" aria-hidden="true" /> Puxar da ficha
          </button>
          <button type="button" className={botao.discreto} onClick={() => setFichaAberta(true)}>
            Ficha fiscal e CNPJ
          </button>
          <span className="flex-1" />
          <PreencherComIA
            papel="contrato"
            clientId={p.contrato.client_id}
            campos={camposDasVariaveis(p.variaveis, p.valores)}
            contexto={contextoDaTela}
            fontes={["contexto", "briefing", "dossie", "arquivos", "conversa"]}
            onAplicar={gravarDaIA}
            onDesfazer={desfazerDaIA}
          />
        </div>
      )}
      {editavel && !aditivo && (
        <fieldset className="min-w-0">
          <legend className={juntar(texto.rotulo, "mb-2")}>Serviços do contrato</legend>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICOS_DO_CONTRATO.map((s) => (
              <label key={s} className={juntar(texto.corpo, "flex min-w-0 cursor-pointer items-center")}>
                <Checkbox
                  checked={servicos.indexOf(s) >= 0}
                  onCheckedChange={(v) => setServicos((l) => (v ? l.concat([s]) : l.filter((x) => x !== s)))}
                  className="mr-2"
                  aria-label={ROTULO_DO_SERVICO[s as ServicoDoContrato]}
                />
                <span className="truncate">{ROTULO_DO_SERVICO[s as ServicoDoContrato]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {grupos.map((g) =>
        g.vars.length ? (
          <GrupoDeCampos
            key={g.grupo}
            titulo={
              <span className="flex min-w-0 items-center">
                <span className="min-w-0 truncate">{ROTULO_DO_GRUPO[g.grupo] || g.grupo}</span>
                {editavel && g.grupo !== "extras" && (
                  <PreencherComIA
                    papel="contrato"
                    clientId={p.contrato.client_id}
                    campos={camposDasVariaveis(g.vars, p.valores)}
                    contexto={contextoDaTela}
                    fontes={["contexto", "briefing", "dossie", "arquivos", "conversa"]}
                    compacto
                    rotulo={`Preencher ${ROTULO_DO_GRUPO[g.grupo] || g.grupo} com IA`}
                    onAplicar={gravarDaIA}
                    onDesfazer={desfazerDaIA}
                  />
                )}
              </span>
            }
            colunas={2}
          >
            {g.vars.map((v) => {
              const erro = faltando[v.nome];
              const valor = valores[v.nome] || "";
              const mudar = (x: string) => setValores((o) => ({ ...o, [v.nome]: x }));
              return (
                <CampoDeFormulario key={v.nome} rotulo={v.rotulo} obrigatorio={!!v.obrigatoria} ajuda={v.ajuda} erro={erro ? (erro === "falta" ? "Falta preencher" : erro) : undefined} largo={v.tipo === "textoLongo"}>
                  {v.tipo === "escolha" ? (
                    <select value={valor} onChange={(e) => mudar(e.target.value)} disabled={!editavel} className={campo}>
                      <option value="">Escolha</option>
                      {(v.opcoes || []).map((o) => (
                        <option key={o.valor} value={o.valor}>
                          {o.rotulo}
                        </option>
                      ))}
                    </select>
                  ) : v.tipo === "textoLongo" ? (
                    <textarea value={valor} onChange={(e) => mudar(e.target.value)} disabled={!editavel} rows={2} className={juntar(campoTexto, "min-h-[64px]")} />
                  ) : (
                    <input
                      value={valor}
                      onChange={(e) => mudar(e.target.value)}
                      disabled={!editavel}
                      type={v.tipo === "data" ? "date" : "text"}
                      inputMode={v.tipo === "moeda" || v.tipo === "inteiro" || v.tipo === "percentual" ? "decimal" : undefined}
                      placeholder={v.tipo === "moeda" ? "Ex.: 5000 ou 5.000,00" : undefined}
                      className={campo}
                    />
                  )}
                </CampoDeFormulario>
              );
            })}
          </GrupoDeCampos>
        ) : null,
      )}
      {editavel && (
        <div className="flex min-w-0 items-center justify-end">
          <button type="button" className={botao.primario} disabled={salvando || (!mudou && !servicosMudaram)} onClick={() => void salvar()}>
            {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Salvar
          </button>
        </div>
      )}
      <Dialog open={fichaAberta} onOpenChange={(o) => !o && setFichaAberta(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ficha fiscal do cliente</DialogTitle>
            <DialogDescription>Fica na ficha do cliente e vale para todos os contratos dele.</DialogDescription>
          </DialogHeader>
          <div className={juntar("min-w-0", rolagem.janela)}>
            <DadosFiscaisDoCliente
              clientId={p.contrato.client_id}
              aoSalvar={(_f, vindos) => {
                setFichaAberta(false);
                puxarDaFicha(vindos);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------------ cláusulas

export function ClausulasDoContrato({ p, editavel, aoMudar }: { p: PayloadDoContrato; editavel: boolean; aoMudar: (novo: PayloadDoContrato) => void }) {
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [daIA, setDaIA] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const clausulas = p.montado ? p.montado.clausulas : [];
  const alteradas: Record<string, string> = {};
  (p.contrato.clausulas_alteradas || []).forEach((a) => (alteradas[a.chave] = a.texto));
  if (!clausulas.length) return <EstadoVazio compacto titulo={p.contrato.congelado_em ? "Contrato congelado: as cláusulas estão no documento." : "Sem cláusulas."} />;

  const atualDe = (chave: string, modelo: string) => (alteradas[chave] !== undefined ? alteradas[chave] : modelo);

  const desfazer = async (chave: string, anterior: { texto: string } | null | undefined) => {
    try {
      const novo = anterior ? await chamarContratos("clausula_alterar", { contract_id: p.contrato.id, chave, texto: anterior.texto, motivo: "desfeito" }) : await chamarContratos("clausula_restaurar", { contract_id: p.contrato.id, chave });
      aoMudar(novo);
      toast.success("Desfeito");
    } catch (e) {
      toast.error("Não foi desfeito", { description: textoDoErro(e) });
    }
  };

  const gravar = async (chave: string, novoTexto: string | null) => {
    setOcupado(true);
    try {
      const r = novoTexto === null
        ? await chamarContratos("clausula_restaurar", { contract_id: p.contrato.id, chave })
        : await chamarContratos("clausula_alterar", { contract_id: p.contrato.id, chave, texto: novoTexto, motivo: daIA ? "sugestão da IA, diferença confirmada" : undefined });
      aoMudar(r);
      setEditando(null);
      setConfirmando(false);
      setDaIA(false);
      toast.success(novoTexto === null ? "Cláusula voltou ao modelo" : "Cláusula alterada", { action: { label: "Desfazer", onClick: () => void desfazer(chave, r.anterior) } });
    } catch (e) {
      toast.error("A cláusula não mudou", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <ul className={juntar(lista.aberta, lista.divisoria)} data-clausulas-do-contrato="">
      {clausulas.map((c) => {
        const atual = atualDe(c.chave, c.texto_modelo);
        const aberta = editando === c.chave;
        const partes = aberta ? diffDeTexto(atual, rascunho) : [];
        const mudou = aberta && rascunho.trim() !== atual.trim();
        return (
          <li key={c.chave} className="min-w-0 px-2 py-3">
            <div className="flex min-w-0 items-center">
              <p className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>
                {c.numero} {c.titulo}
                {c.alterada && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">alterada</span>}
              </p>
              {editavel && !aberta && (
                <div className="ml-2 flex shrink-0 items-center [&>*+*]:ml-1">
                  {c.alterada && (
                    <button type="button" className={botao.barra} onClick={() => void gravar(c.chave, null)} disabled={ocupado}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Voltar ao modelo
                    </button>
                  )}
                  {/* Sugestão da IA nunca grava: abre a edição com a diferença e pede Confirmar. */}
                  <PreencherComIA
                    papel="contrato"
                    clientId={p.contrato.client_id}
                    campos={[campoDaClausula(c, atual)]}
                    contexto={`Contrato ${p.contrato.numero || ""} "${p.contrato.title}". Texto atual da cláusula: ${atual.slice(0, 1500)}`}
                    fontes={["contexto", "briefing", "dossie", "conversa"]}
                    compacto
                    rotulo={`Sugerir texto da cláusula ${c.numero}`}
                    onAplicar={(v) => {
                      const novo = String(v[c.chave] == null ? "" : v[c.chave]).trim();
                      if (!novo) return;
                      setEditando(c.chave);
                      setRascunho(novo);
                      setDaIA(true);
                      setConfirmando(false);
                    }}
                  />
                  <button
                    type="button"
                    className={botao.barra}
                    onClick={() => {
                      setEditando(c.chave);
                      setRascunho(atual);
                      setDaIA(false);
                      setConfirmando(false);
                    }}
                  >
                    Editar
                  </button>
                </div>
              )}
            </div>
            {!aberta && <p className={juntar(texto.auxiliar, "mt-1 line-clamp-2 whitespace-normal")}>{c.texto}</p>}
            {aberta && (
              <div className="mt-2 min-w-0 space-y-3">
                {daIA && <p className={juntar(texto.auxiliar, "text-primary")}>Sugestão da IA. Nada foi gravado: confira a diferença.</p>}
                <textarea value={rascunho} onChange={(e) => { setRascunho(e.target.value); setConfirmando(false); }} rows={6} className={campoTexto} aria-label={`Texto da cláusula ${c.numero}`} />
                {mudou && (
                  <div className="min-w-0 rounded-md bg-muted/50 p-3" data-diff-da-clausula="">
                    <p className={juntar(texto.rotulo, "mb-1.5")}>Diferença em relação ao texto atual</p>
                    <PartesDoDiff partes={partes} />
                  </div>
                )}
                <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:ml-2 [&>*]:mt-1">
                  <button type="button" className={botao.discreto} onClick={() => { setEditando(null); setDaIA(false); }} disabled={ocupado}>
                    Cancelar
                  </button>
                  {!confirmando ? (
                    <button type="button" className={botao.secundario} disabled={!mudou || rascunho.trim().length < 10} onClick={() => setConfirmando(true)}>
                      Ver e confirmar
                    </button>
                  ) : (
                    <button type="button" className={botao.primario} disabled={ocupado} onClick={() => void gravar(c.chave, rascunho)}>
                      {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                      Confirmar a diferença
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ versões e trilha

export function VersoesDoContrato({ p, aoAbrir }: { p: PayloadDoContrato; aoAbrir: (id: string) => void }) {
  const temAnterior = !!p.contrato.versao_de;
  const diff = useQuery({
    queryKey: CHAVES_DOS_CONTRATOS.diff(p.contrato.id),
    enabled: temAnterior,
    queryFn: () => chamarContratos<RespostaDoDiff>("diff", { contract_id: p.contrato.id }),
  });
  return (
    <div className="min-w-0 space-y-5">
      <ul className={juntar(lista.aberta, lista.divisoria)}>
        {p.versoes.map((v) => (
          <li key={v.id} className={juntar(lista.linha, v.id === p.contrato.id && lista.destaque)}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => aoAbrir(v.id)}>
              <span className={juntar(texto.corpo, "font-medium")}>Versão {v.versao}</span>
              <span className={juntar(texto.auxiliar, "ml-2")}>
                {v.status === "substituido" ? "substituída" : v.status === "completed" ? "assinada" : v.status === "sent" ? "enviada" : v.status === "cancelled" ? "cancelada" : "rascunho"}
                {v.documento_hash ? ` · ${v.documento_hash.slice(0, 12)}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {temAnterior && (
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-2")}>
            {diff.data ? `Da versão ${diff.data.antes.versao} para a ${diff.data.depois.versao}: ${diff.data.resumo.mudaram} linhas mudaram, ${diff.data.resumo.entraram} entraram, ${diff.data.resumo.sairam} saíram` : "Diferença para a versão anterior"}
          </p>
          {diff.isLoading ? <Carregando forma="lista" linhas={3} rotulo="Comparando versões" /> : diff.isError ? <EstadoDeErro titulo={textoDoErro(diff.error)} /> : diff.data ? <LinhasDoDiff linhas={diff.data.linhas} /> : null}
        </div>
      )}
    </div>
  );
}

export function TrilhaDoContrato({ p }: { p: PayloadDoContrato }) {
  if (!p.eventos.length) return <EstadoVazio compacto titulo="Sem eventos ainda." />;
  return (
    <ol className="min-w-0 space-y-2.5" data-trilha-do-contrato="">
      {p.eventos.map((e) => (
        <li key={e.id} className="flex min-w-0 items-start">
          <span className={juntar(texto.auxiliar, "w-[132px] shrink-0 tabular-nums")}>{new Date(e.criado_em).toLocaleString("pt-BR")}</span>
          <span className={juntar(texto.corpo, "min-w-0 flex-1")}>
            {e.resumo}
            {e.ip ? <span className={juntar(texto.auxiliar, "ml-1")}>IP {e.ip}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ assinar pela agência (congela)

export function JanelaDeAssinar({ aberta, aoFechar, p, nomeInicial, aoAssinar }: { aberta: boolean; aoFechar: () => void; p: PayloadDoContrato; nomeInicial: string; aoAssinar: (novo: PayloadDoContrato) => void }) {
  const [nome, setNome] = useState(nomeInicial);
  const [aceite, setAceite] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (aberta) {
      setNome(nomeInicial);
      setAceite(false);
    }
  }, [aberta, nomeInicial]);
  const assinar = async () => {
    setOcupado(true);
    try {
      const novo = await chamarContratos("congelar", { contract_id: p.contrato.id, nome_assinatura: nome.trim(), aceite: true });
      aoAssinar(novo);
    } catch (e) {
      toast.error("O contrato não foi congelado", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Congelar e assinar pela agência</DialogTitle>
          <DialogDescription>O texto fica congelado com um código SHA-256. Depois disso, mudar é criar uma versão nova. Nada é enviado agora.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <CampoDeFormulario rotulo="Seu nome completo" obrigatorio>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} autoComplete="name" />
          </CampoDeFormulario>
          <label className={juntar(texto.corpo, "flex cursor-pointer items-start")}>
            <Checkbox checked={aceite} onCheckedChange={(v) => setAceite(!!v)} className="mr-2 mt-0.5" />
            <span>Li o contrato e assino eletronicamente pela agência.</span>
          </label>
          {p.revisao_juridica && <p className={texto.auxiliar}>Modelo {p.revisao_juridica}.</p>}
        </div>
        <DialogFooter>
          <button type="button" className={botao.secundario} onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="button" className={botao.primario} onClick={() => void assinar()} disabled={ocupado || !aceite || !nome.trim()}>
            {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Congelar e assinar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ envio (mensagem pronta; a pessoa envia)

export function JanelaDeEnvio({ aberta, aoFechar, p, mensagens, link, aoEnviado }: {
  aberta: boolean;
  aoFechar: () => void;
  p: PayloadDoContrato;
  mensagens: { whatsapp: string; assunto: string; email: string; wa_me: string } | null;
  link: string | null;
  aoEnviado: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const copiar = (t: string, o: string) => {
    try {
      void navigator.clipboard.writeText(t);
      toast.success(`${o} copiado`);
    } catch {
      toast.error("Não deu para copiar; selecione e copie.");
    }
  };
  const porEmail = async () => {
    setEnviando(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-contract-email", { body: { contract_id: p.contrato.id } });
      if (error || (data && (data as { error?: string }).error)) throw new Error((data && (data as { error?: string }).error) || (error && error.message) || "Erro");
      toast.success("E-mail enviado ao cliente");
      aoEnviado();
    } catch (e) {
      toast.error("O e-mail não foi enviado", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };
  const porWhatsapp = async () => {
    if (!mensagens) return;
    window.open(mensagens.wa_me, "_blank", "noopener,noreferrer");
    try {
      await chamarContratos("marcar_enviado", { contract_id: p.contrato.id, canal: "whatsapp" });
      aoEnviado();
    } catch (e) {
      toast.error("O envio não ficou registrado", { description: textoDoErro(e) });
    }
  };
  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar para o cliente</DialogTitle>
          <DialogDescription>Escolha o canal. Nada sai sem o seu clique.</DialogDescription>
        </DialogHeader>
        <div className={juntar("min-w-0 space-y-3", rolagem.janela)}>
          {link && (
            <CampoDeFormulario rotulo="Link de assinatura">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={juntar(campo, "font-mono text-[12px]")} />
            </CampoDeFormulario>
          )}
          {mensagens && (
            <CampoDeFormulario rotulo="Mensagem para o WhatsApp">
              <textarea readOnly value={mensagens.whatsapp} rows={4} className={campoTexto} />
            </CampoDeFormulario>
          )}
          {/* Frente CON2: as outras pessoas que assinam recebem o link delas (a pessoa envia). */}
          {(p.signatarios || []).filter((s) => !s.principal && s.link && !s.assinado_em).map((s) => {
            const m = mensagensProntas({ cliente: s.nome, titulo: p.contrato.title, link: String(s.link), hash: String(p.contrato.documento_hash || ""), agencia: "Aceleriq" });
            return (
              <div key={s.id} className="flex min-w-0 items-center border-t border-border pt-2">
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {s.nome}
                  <span className={juntar(texto.auxiliar, "ml-2")}>{s.papel === "testemunha" ? "testemunha" : "contratante"}</span>
                </span>
                <button type="button" className={botao.barra} onClick={() => copiar(String(s.link), "Link")}>
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Link
                </button>
                <button type="button" className={botao.barra} onClick={() => window.open(m.wa_me, "_blank", "noopener,noreferrer")}>
                  <MessageCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> WhatsApp
                </button>
              </div>
            );
          })}
        </div>
        <DialogFooter className="flex-wrap [&>*]:mt-1">
          {link && (
            <button type="button" className={botao.discreto} onClick={() => copiar(link, "Link")}>
              <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /> Copiar link
            </button>
          )}
          {mensagens && (
            <button type="button" className={botao.secundario} onClick={() => void porWhatsapp()}>
              <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> Abrir no WhatsApp
            </button>
          )}
          <button type="button" className={botao.primario} onClick={() => void porEmail()} disabled={enviando}>
            {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Enviar por e-mail
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
