import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileInput, Loader2, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import MenuMais from "@/components/sistema/MenuMais";
import Secao from "@/components/sistema/Secao";
import { botao, campo, campoTexto, foco, juntar, lista, rolagem, texto, toqueCompacto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, CHAVES_DOS_CONTRATOS, type PayloadDoContrato, type RespostaDoDiff } from "@/lib/contratos/api";
import { LinhasDoDiff, PartesDoDiff } from "./DiffDeTexto";
// Frente CON2: Preencher com IA (peça comum), ficha fiscal e sugestão de cláusula com a diferença antes de gravar.
import { PreencherComIA, type ResultadoDoPreenchimento } from "@/components/sistema";
import { campoDaClausula, camposDasVariaveis, valoresDaIA } from "@/lib/contratos/preencher";
import DadosFiscaisDoCliente from "./DadosFiscaisDoCliente";
import {
  diffDeTexto,
  ROTULO_DO_SERVICO,
  SERVICOS_DO_CONTRATO,
  type ServicoDoContrato,
  type VariavelDoModelo,
} from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * As partes do contrato aberto na tela /contratos (frente CON, 30/09):
 * dados (variáveis e serviços), cláusulas (com a diferença antes de mudar),
 * histórico (versões com a diferença entre elas e os eventos) e a janela de
 * assinar pela agência. A janela de envio mora em JanelaDeEnvio.tsx.
 *
 * UXS (30/09): Dados não guarda mais o que foi digitado só na memória da
 * parte. O DetalheDoContrato guarda o rascunho (rascunhoDoContrato.ts) e a
 * barra de baixo salva; "Puxar da ficha" e a ficha fiscal gravam direto, com
 * Desfazer no aviso.
 */

const ROTULO_DO_GRUPO: Record<string, string> = { aditivo: "O que muda", cliente: "Contratante", quadro: "Quadro-resumo", servico: "Serviços", extras: "Cláusulas extras" };
const ORDEM_DOS_GRUPOS = ["aditivo", "cliente", "quadro", "servico", "extras"];

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

// ------------------------------------------------------------------ dados

export function DadosDoContrato({
  p,
  editavel,
  aoMudar,
  valores,
  servicos,
  aoMudarValor,
  aoMudarServicos,
  aoSoltar,
}: {
  p: PayloadDoContrato;
  editavel: boolean;
  aoMudar: (novo: PayloadDoContrato) => void;
  /** O que a tela mostra: o do servidor com o que a pessoa mudou e não salvou. */
  valores: Record<string, string>;
  servicos: string[];
  aoMudarValor: (chave: string, valor: string) => void;
  aoMudarServicos: (lista: string[]) => void;
  /** Campos gravados por outro caminho (IA, ficha): saem do que falta salvar. */
  aoSoltar: (chaves: string[]) => void;
}) {
  const [fichaAberta, setFichaAberta] = useState(false);
  const [gravandoFicha, setGravandoFicha] = useState(false);
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
  const contextoDaTela = `Contrato ${p.contrato.numero || ""} "${p.contrato.title}", ${aditivo ? "termo aditivo" : p.contrato.tipo_documento === "renovacao" ? "renovação" : "contrato"} dos serviços: ${(p.contrato.servicos || []).map((s) => ROTULO_DO_SERVICO[s as ServicoDoContrato] || s).join(", ") || "nenhum"}.`;

  /** A IA mostrou a prévia e a pessoa aplicou: grava na hora (o Desfazer da peça volta os anteriores). */
  const gravarDaIA = async (vindos: Record<string, unknown>, r: ResultadoDoPreenchimento) => {
    const novos = valoresDaIA(p.variaveis, vindos);
    if (!Object.keys(novos).length) return;
    // Só o que a IA trouxe: o que a pessoa digitou e não salvou continua esperando o Salvar.
    const novo = await chamarContratos("salvar", { contract_id: p.contrato.id, variaveis: novos, preenchido_ia: { modelo_id: r.modelo_id, fontes: r.fontes } });
    aoSoltar(Object.keys(novos));
    aoMudar(novo);
  };
  const desfazerDaIA = async (anteriores: Record<string, unknown>) => {
    const volta: Record<string, string> = {};
    Object.keys(anteriores).forEach((k) => (volta[k] = anteriores[k] === null || anteriores[k] === undefined ? "" : String(anteriores[k])));
    aoSoltar(Object.keys(volta));
    aoMudar(await chamarContratos("salvar", { contract_id: p.contrato.id, variaveis: volta }));
  };

  const desfazerDaFicha = async (antes: Record<string, string>) => {
    try {
      aoMudar(await chamarContratos("salvar", { contract_id: p.contrato.id, variaveis: antes }));
      toast.success("Desfeito");
    } catch (e) {
      toast.error("Não foi desfeito", { description: textoDoErro(e) });
    }
  };

  /** Grava o que veio da ficha por cima do que está salvo (não das edições por salvar), com Desfazer. */
  const puxarDaFicha = async (vindos: Record<string, string>) => {
    const chaves = Object.keys(vindos);
    const mudar = chaves.filter((k) => String(p.valores[k] || "") !== vindos[k]);
    if (!mudar.length) {
      aoSoltar(chaves.filter((k) => (valores[k] || "") !== vindos[k]));
      toast.info("O contrato já está com os dados da ficha");
      return;
    }
    const envio: Record<string, string> = {};
    const antes: Record<string, string> = {};
    mudar.forEach((k) => {
      envio[k] = vindos[k];
      antes[k] = String(p.valores[k] || "");
    });
    setGravandoFicha(true);
    try {
      const novo = await chamarContratos("salvar", { contract_id: p.contrato.id, variaveis: envio });
      aoSoltar(chaves);
      aoMudar(novo);
      toast.success(`${mudar.length} ${mudar.length === 1 ? "campo do contratante veio" : "campos do contratante vieram"} da ficha`, { action: { label: "Desfazer", onClick: () => void desfazerDaFicha(antes) } });
    } catch (e) {
      toast.error("Os dados da ficha não foram gravados", { description: textoDoErro(e) });
    } finally {
      setGravandoFicha(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6" data-dados-do-contrato="">
      {editavel && (
        <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
          <button
            type="button"
            className={botao.secundario}
            onClick={() => void puxarDaFicha((p.ficha && p.ficha.valores) || {})}
            disabled={!p.ficha || !p.ficha.existe || gravandoFicha}
            title={p.ficha && p.ficha.existe ? undefined : "O cliente ainda não tem ficha fiscal"}
          >
            {gravandoFicha ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <FileInput className="mr-1.5 h-4 w-4" aria-hidden="true" />} Puxar da ficha
          </button>
          <button type="button" className={botao.discreto} onClick={() => setFichaAberta(true)}>
            Ficha fiscal e CNPJ
          </button>
          <span className="flex-1" />
          <PreencherComIA
            papel="contrato"
            clientId={p.contrato.client_id}
            campos={camposDasVariaveis(p.variaveis, valores)}
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
                  onCheckedChange={(v) => aoMudarServicos(v ? servicos.filter((x) => x !== s).concat([s]) : servicos.filter((x) => x !== s))}
                  className={juntar(toqueCompacto, "mr-2")}
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
                    campos={camposDasVariaveis(g.vars, valores)}
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
              const mudar = (x: string) => aoMudarValor(v.nome, x);
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
                void puxarDaFicha(vindos);
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
  const [ocupado, setOcupado] = useState(false);
  const clausulas = p.montado ? p.montado.clausulas : [];
  const alteradas: Record<string, string> = {};
  (p.contrato.clausulas_alteradas || []).forEach((a) => (alteradas[a.chave] = a.texto));
  if (!clausulas.length) return <EstadoVazio compacto titulo={p.contrato.congelado_em ? "Contrato assinado pela agência: as cláusulas estão no documento." : "Sem cláusulas."} />;

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
        const podeConfirmar = mudou && rascunho.trim().length >= 10 && !ocupado;
        return (
          <li key={c.chave} className="min-w-0 px-2 py-3">
            <div className="flex min-w-0 items-center">
              {editavel && !aberta ? (
                // O título abre a edição (UXS): a linha cabe no celular sem o botão "Editar" separado.
                <button
                  type="button"
                  className={juntar(toqueCompacto, texto.corpo, "relative -left-1 min-w-0 flex-1 rounded-md px-1 text-left font-medium transition-colors hover:bg-muted/40", foco)}
                  aria-label={`Editar cláusula ${c.numero} ${c.titulo}`}
                  aria-expanded={false}
                  title="Editar"
                  onClick={() => {
                    setEditando(c.chave);
                    setRascunho(atual);
                    setDaIA(false);
                  }}
                >
                  <span className="block truncate">
                    {c.numero} {c.titulo}
                  </span>
                </button>
              ) : (
                <p className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>
                  {c.numero} {c.titulo}
                </p>
              )}
              {c.alterada && <span className="ml-2 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">alterada</span>}
              {editavel && !aberta && (
                <div className="ml-1 flex shrink-0 items-center [&>*+*]:ml-1">
                  {/* Sugestão da IA nunca grava: abre a edição com a diferença e pede Confirmar. */}
                  <PreencherComIA
                    papel="contrato"
                    clientId={p.contrato.client_id}
                    campos={[campoDaClausula(c, atual)]}
                    contexto={`Contrato ${p.contrato.numero || ""} "${p.contrato.title}". Texto atual da cláusula: ${atual.slice(0, 1500)}`}
                    fontes={["contexto", "briefing", "dossie", "conversa"]}
                    compacto
                    rotulo={`Sugerir texto da cláusula ${c.numero}`}
                    substituirInicial
                    onAplicar={(v) => {
                      const novo = String(v[c.chave] == null ? "" : v[c.chave]).trim();
                      if (!novo) return;
                      setEditando(c.chave);
                      setRascunho(novo);
                      setDaIA(true);
                    }}
                  />
                  {c.alterada && (
                    <MenuMais
                      rotulo={`Mais ações da cláusula ${c.numero}`}
                      itens={[{ rotulo: "Voltar ao modelo", icone: <RotateCcw className="h-4 w-4" />, aoEscolher: () => void gravar(c.chave, null), desativado: ocupado }]}
                    />
                  )}
                </div>
              )}
            </div>
            {!aberta && <p className={juntar(texto.auxiliar, "mt-1 line-clamp-2 whitespace-normal")}>{c.texto}</p>}
            {aberta && (
              <div className="mt-2 min-w-0 space-y-3">
                {daIA && <p className={juntar(texto.auxiliar, "text-primary")}>Sugestão da IA. Nada foi gravado: confira a diferença.</p>}
                <textarea value={rascunho} onChange={(e) => setRascunho(e.target.value)} rows={6} className={campoTexto} aria-label={`Texto da cláusula ${c.numero}`} />
                {mudou && (
                  <div className="min-w-0 rounded-md bg-muted/50 p-3" data-diff-da-clausula="">
                    <p className={juntar(texto.rotulo, "mb-1.5")}>Diferença em relação ao texto atual</p>
                    <PartesDoDiff partes={partes} />
                  </div>
                )}
                {/* Um clique só (UXS): a diferença já está à vista logo acima e o aviso traz o Desfazer. */}
                <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:ml-2 [&>*]:mt-1">
                  <button type="button" className={botao.discreto} onClick={() => { setEditando(null); setDaIA(false); }} disabled={ocupado}>
                    Cancelar
                  </button>
                  <button type="button" className={botao.primario} disabled={!podeConfirmar} onClick={() => void gravar(c.chave, rascunho)}>
                    {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                    Confirmar a diferença
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ histórico (versões e eventos)

const STATUS_DA_VERSAO: Record<string, string> = { substituido: "substituída", completed: "assinada", sent: "enviada", cancelled: "cancelada" };

export function VersoesDoContrato({ p, aoAbrir }: { p: PayloadDoContrato; aoAbrir: (id: string) => void }) {
  const temAnterior = !!p.contrato.versao_de;
  const diff = useQuery({
    queryKey: CHAVES_DOS_CONTRATOS.diff(p.contrato.id),
    enabled: temAnterior,
    queryFn: () => chamarContratos<RespostaDoDiff>("diff", { contract_id: p.contrato.id }),
  });
  if (!p.versoes.length && !temAnterior) return <EstadoVazio compacto titulo="Só esta versão." />;
  return (
    <div className="min-w-0 space-y-5" data-versoes-do-contrato="">
      <ul className={juntar(lista.aberta, lista.divisoria)}>
        {p.versoes.map((v) => (
          <li key={v.id} className={juntar(lista.linha, v.id === p.contrato.id && lista.destaque)}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => aoAbrir(v.id)}>
              <span className={juntar(texto.corpo, "font-medium")}>Versão {v.versao}</span>
              <span className={juntar(texto.auxiliar, "ml-2")}>
                {STATUS_DA_VERSAO[v.status] || "rascunho"}
                {v.congelado_em ? ` · travada em ${dataCurta(v.congelado_em)}` : ""}
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

/** Versões e eventos numa parte só (UXS): contam a mesma história. As duas seções recolhem e nascem abertas. */
export function HistoricoDoContrato({ p, aoAbrir }: { p: PayloadDoContrato; aoAbrir: (id: string) => void }) {
  return (
    <div className="min-w-0 space-y-6" data-historico-do-contrato="">
      <Secao titulo="Versões" nivel={3} recolher="contratos:historico:versoes" descricao={p.versoes.length > 1 ? `${p.versoes.length} versões` : undefined}>
        <VersoesDoContrato p={p} aoAbrir={aoAbrir} />
      </Secao>
      <Secao titulo="Eventos" nivel={3} recolher="contratos:historico:eventos" descricao={p.eventos.length ? `${p.eventos.length} ${p.eventos.length === 1 ? "evento" : "eventos"}` : undefined}>
        <TrilhaDoContrato p={p} />
      </Secao>
    </div>
  );
}

// ------------------------------------------------------------------ assinar pela agência (trava o texto)

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
      toast.error("O contrato não foi assinado", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assinar pela agência</DialogTitle>
          <DialogDescription>Depois de assinar, o texto fica travado e mudar vira versão nova. Nada é enviado agora.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <CampoDeFormulario rotulo="Seu nome completo" obrigatorio>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} autoComplete="name" />
          </CampoDeFormulario>
          <label className={juntar(texto.corpo, "flex cursor-pointer items-start")}>
            <Checkbox checked={aceite} onCheckedChange={(v) => setAceite(!!v)} className={juntar(toqueCompacto, "mr-2 mt-0.5")} />
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
            Assinar pela agência
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
