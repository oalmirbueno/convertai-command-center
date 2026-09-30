import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, BookOpen, Pencil, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAvisarErro } from "@/components/mesa/Custo";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import { botao, campo, campoTexto, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { lerValor, reais } from "../../../supabase/functions/_shared/proposta-modelo";
import {
  custoDaHora,
  normalizarParametros,
  precoDaHora,
  provaPodeEntrar,
  ROTULO_DA_UNIDADE,
  UNIDADES_DO_SERVICO,
  type ParametrosDaHora,
  type ProvaDaAgencia,
  type ServicoDaBiblioteca,
  type UnidadeDoServico,
} from "../../../supabase/functions/_shared/proposta-comercial";
import { CHAVES, chamarBiblioteca, useHoraTecnica, useProvas, useServicos } from "./propostaApi";

/**
 * Biblioteca comercial da agência (frente PRO2), numa gaveta aberta pela
 * Mesa Proposta: os serviços com preço, unidade, horas e entregáveis (viram
 * item da proposta com um clique), os cases e depoimentos com a autorização
 * registrada (só o autorizado entra na proposta) e os parâmetros da hora
 * técnica (custos do Financeiro, horas produtivas, impostos e margem).
 * Apagar é arquivar. A escrita vai pela função proposta-biblioteca.
 */

export type AbaDaBiblioteca = "servicos" | "provas" | "hora";
const ABAS: Array<{ valor: AbaDaBiblioteca; rotulo: string }> = [
  { valor: "servicos", rotulo: "Serviços" },
  { valor: "provas", rotulo: "Cases e depoimentos" },
  { valor: "hora", rotulo: "Hora técnica" },
];

const linhas = (v: string[]) => v.join("\n");
const deLinhas = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

type ServicoNaTela = { id: string; nome: string; categoria: string; descricao: string; unidade: UnidadeDoServico; preco: string; recorrencia: "unico" | "mensal"; horas: string; entregaveis: string };
const servicoVazio: ServicoNaTela = { id: "", nome: "", categoria: "", descricao: "", unidade: "projeto", preco: "", recorrencia: "unico", horas: "", entregaveis: "" };
const servicoParaTela = (s: ServicoDaBiblioteca): ServicoNaTela => ({ id: s.id, nome: s.nome, categoria: s.categoria, descricao: s.descricao, unidade: s.unidade, preco: String(s.preco).replace(".", ","), recorrencia: s.recorrencia, horas: s.horas === null ? "" : String(s.horas).replace(".", ","), entregaveis: linhas(s.entregaveis) });

function Servicos() {
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const servicos = useServicos();
  const [edicao, setEdicao] = useState<ServicoNaTela | null>(null);
  const [verArquivados, setVerArquivados] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const todos = servicos.data ? servicos.data.lista : [];
  const vivos = todos.filter((s) => verArquivados || !s.arquivado);

  const salvar = async () => {
    if (!edicao) return;
    const preco = lerValor(edicao.preco);
    if (!edicao.nome.trim() || preco === null) {
      toast.error("O serviço precisa de nome e preço.");
      return;
    }
    setSalvando(true);
    try {
      await chamarBiblioteca("servico_salvar", {
        servico: { id: edicao.id || undefined, nome: edicao.nome, categoria: edicao.categoria, descricao: edicao.descricao, unidade: edicao.unidade, preco, recorrencia: edicao.recorrencia, horas: edicao.horas ? Number(edicao.horas.replace(",", ".")) : null, entregaveis: deLinhas(edicao.entregaveis) },
      });
      void qc.invalidateQueries({ queryKey: CHAVES.servicos() });
      setEdicao(null);
      toast.success("Serviço salvo.");
    } catch (e) {
      avisarErro(e, "O serviço não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  const arquivar = async (s: ServicoDaBiblioteca) => {
    try {
      await chamarBiblioteca("servico_arquivar", { id: s.id, arquivar: !s.arquivado });
      void qc.invalidateQueries({ queryKey: CHAVES.servicos() });
    } catch (e) {
      avisarErro(e, "Não foi possível arquivar");
    }
  };

  if (servicos.data && servicos.data.semTabela) return <EstadoVazio compacto titulo="O banco ainda não tem a biblioteca." descricao="Falta aplicar a migration da proposta." />;
  return (
    <div className="space-y-4" data-biblioteca="servicos">
      <div className="flex items-center justify-between">
        <p className={texto.auxiliar}>{vivos.length} serviço(s)</p>
        <button type="button" className={botao.secundario} onClick={() => setEdicao({ ...servicoVazio })}>
          <Plus className="mr-1.5 h-4 w-4" /> Serviço
        </button>
      </div>
      {edicao && (
        <div className="space-y-3 border-y border-border py-4" aria-label="Editar serviço">
          <GrupoDeCampos colunas={2}>
            <CampoDeFormulario rotulo="Nome" obrigatorio>
              <input value={edicao.nome} onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })} maxLength={120} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Categoria">
              <input value={edicao.categoria} onChange={(e) => setEdicao({ ...edicao, categoria: e.target.value })} maxLength={60} className={campo} placeholder="Ex.: Redes, Site, Marca" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Preço (R$)" obrigatorio>
              <input value={edicao.preco} onChange={(e) => setEdicao({ ...edicao, preco: e.target.value })} inputMode="decimal" className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Unidade">
              <select value={edicao.unidade} onChange={(e) => setEdicao({ ...edicao, unidade: e.target.value as UnidadeDoServico, recorrencia: e.target.value === "mes" ? "mensal" : edicao.recorrencia })} className={campo}>
                {UNIDADES_DO_SERVICO.map((u) => (
                  <option key={u} value={u}>
                    {ROTULO_DA_UNIDADE[u]}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Cobrança">
              <select value={edicao.recorrencia} onChange={(e) => setEdicao({ ...edicao, recorrencia: e.target.value === "mensal" ? "mensal" : "unico" })} className={campo}>
                <option value="unico">Única</option>
                <option value="mensal">Mensal</option>
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Horas por unidade" apoio="A calculadora usa para a margem">
              <input value={edicao.horas} onChange={(e) => setEdicao({ ...edicao, horas: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Descrição" largo>
              <textarea value={edicao.descricao} onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })} maxLength={400} className={juntar(campoTexto, "min-h-[64px]")} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Entregáveis" apoio="Um por linha" largo>
              <textarea value={edicao.entregaveis} onChange={(e) => setEdicao({ ...edicao, entregaveis: e.target.value })} className={juntar(campoTexto, "min-h-[64px]")} />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className="flex justify-end">
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => setEdicao(null)}>
              Cancelar
            </button>
            <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar serviço"}
            </button>
          </div>
        </div>
      )}
      {vivos.length ? (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Serviços da agência">
          {vivos.map((s) => (
            <li key={s.id} className={lista.linha}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate", s.arquivado && "text-muted-foreground line-through")}>{s.nome}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {reais(s.preco)} {ROTULO_DA_UNIDADE[s.unidade]}
                  {s.horas ? ` · ${s.horas} h` : ""}
                  {s.categoria ? ` · ${s.categoria}` : ""}
                </span>
              </span>
              <button type="button" className={botao.icone} aria-label={`Editar ${s.nome}`} onClick={() => setEdicao(servicoParaTela(s))}>
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" className={botao.icone} aria-label={s.arquivado ? `Desarquivar ${s.nome}` : `Arquivar ${s.nome}`} onClick={() => void arquivar(s)}>
                <Archive className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !edicao && <EstadoVazio compacto titulo="Nenhum serviço ainda." descricao="Cadastre os serviços com preço e horas." />
      )}
      {todos.some((s) => s.arquivado) && (
        <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => setVerArquivados((v) => !v)}>
          {verArquivados ? "Esconder arquivados" : "Ver arquivados"}
        </button>
      )}
    </div>
  );
}

type ProvaNaTela = { id: string; tipo: "case" | "depoimento"; titulo: string; texto: string; nome: string; cargo: string; empresa: string; link: string; nicho: string; autorizado: boolean; autorizacao: string; autorizado_em: string };
const provaVazia: ProvaNaTela = { id: "", tipo: "case", titulo: "", texto: "", nome: "", cargo: "", empresa: "", link: "", nicho: "", autorizado: false, autorizacao: "", autorizado_em: "" };
const provaParaTela = (p: ProvaDaAgencia): ProvaNaTela => ({ id: p.id, tipo: p.tipo, titulo: p.titulo, texto: p.texto, nome: p.nome, cargo: p.cargo, empresa: p.empresa, link: p.link, nicho: p.nicho, autorizado: p.autorizado, autorizacao: p.autorizacao, autorizado_em: p.autorizado_em || "" });

function Provas() {
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const provas = useProvas();
  const [edicao, setEdicao] = useState<ProvaNaTela | null>(null);
  const [salvando, setSalvando] = useState(false);
  const vivas = (provas.data ? provas.data.lista : []).filter((p) => !p.arquivado);

  const salvar = async () => {
    if (!edicao) return;
    if (edicao.autorizado && edicao.autorizacao.trim().length < 3) {
      toast.error("Diga como a autorização foi dada.");
      return;
    }
    setSalvando(true);
    try {
      await chamarBiblioteca("prova_salvar", { prova: { ...edicao, id: edicao.id || undefined, autorizado_em: edicao.autorizado_em || undefined } });
      void qc.invalidateQueries({ queryKey: CHAVES.provas() });
      setEdicao(null);
      toast.success("Salvo.");
    } catch (e) {
      avisarErro(e, "Não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  const arquivar = async (p: ProvaDaAgencia) => {
    try {
      await chamarBiblioteca("prova_arquivar", { id: p.id });
      void qc.invalidateQueries({ queryKey: CHAVES.provas() });
    } catch (e) {
      avisarErro(e, "Não foi possível arquivar");
    }
  };

  if (provas.data && provas.data.semTabela) return <EstadoVazio compacto titulo="O banco ainda não tem a biblioteca." descricao="Falta aplicar a migration da proposta." />;
  return (
    <div className="space-y-4" data-biblioteca="provas">
      <div className="flex items-center justify-between">
        <p className={texto.auxiliar}>{vivas.filter((p) => provaPodeEntrar(p)).length} autorizado(s) de {vivas.length}</p>
        <button type="button" className={botao.secundario} onClick={() => setEdicao({ ...provaVazia })}>
          <Plus className="mr-1.5 h-4 w-4" /> Novo
        </button>
      </div>
      {edicao && (
        <div className="space-y-3 border-y border-border py-4" aria-label="Editar case ou depoimento">
          <GrupoDeCampos colunas={2}>
            <CampoDeFormulario rotulo="Tipo">
              <select value={edicao.tipo} onChange={(e) => setEdicao({ ...edicao, tipo: e.target.value === "depoimento" ? "depoimento" : "case" })} className={campo}>
                <option value="case">Case</option>
                <option value="depoimento">Depoimento</option>
              </select>
            </CampoDeFormulario>
            {edicao.tipo === "case" ? (
              <CampoDeFormulario rotulo="Título do case" obrigatorio>
                <input value={edicao.titulo} onChange={(e) => setEdicao({ ...edicao, titulo: e.target.value })} maxLength={120} className={campo} />
              </CampoDeFormulario>
            ) : (
              <CampoDeFormulario rotulo="Nome de quem falou" obrigatorio>
                <input value={edicao.nome} onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })} maxLength={80} className={campo} />
              </CampoDeFormulario>
            )}
            <CampoDeFormulario rotulo="Empresa">
              <input value={edicao.empresa} onChange={(e) => setEdicao({ ...edicao, empresa: e.target.value })} maxLength={120} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo={edicao.tipo === "case" ? "Nicho" : "Cargo"}>
              {edicao.tipo === "case" ? (
                <input value={edicao.nicho} onChange={(e) => setEdicao({ ...edicao, nicho: e.target.value })} maxLength={60} className={campo} />
              ) : (
                <input value={edicao.cargo} onChange={(e) => setEdicao({ ...edicao, cargo: e.target.value })} maxLength={80} className={campo} />
              )}
            </CampoDeFormulario>
            <CampoDeFormulario rotulo={edicao.tipo === "case" ? "O que foi feito e o resultado real" : "Depoimento"} largo obrigatorio={edicao.tipo === "depoimento"}>
              <textarea value={edicao.texto} onChange={(e) => setEdicao({ ...edicao, texto: e.target.value })} maxLength={800} className={juntar(campoTexto, "min-h-[80px]")} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Link do trabalho" largo>
              <input value={edicao.link} onChange={(e) => setEdicao({ ...edicao, link: e.target.value })} className={campo} placeholder="https://" />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <label className={juntar(texto.corpo, "inline-flex items-center")}>
            <input type="checkbox" className="mr-2" checked={edicao.autorizado} onChange={(e) => setEdicao({ ...edicao, autorizado: e.target.checked })} />
            O cliente autorizou o uso na proposta
          </label>
          {edicao.autorizado && (
            <GrupoDeCampos colunas={2}>
              <CampoDeFormulario rotulo="Como foi autorizado" obrigatorio apoio="Quem, por onde e quando">
                <input value={edicao.autorizacao} onChange={(e) => setEdicao({ ...edicao, autorizacao: e.target.value })} maxLength={300} className={campo} placeholder="Ex.: e-mail da Joana em 12/09" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Data da autorização">
                <input type="date" value={edicao.autorizado_em} onChange={(e) => setEdicao({ ...edicao, autorizado_em: e.target.value })} className={campo} />
              </CampoDeFormulario>
            </GrupoDeCampos>
          )}
          <div className="flex justify-end">
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => setEdicao(null)}>
              Cancelar
            </button>
            <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      )}
      {vivas.length ? (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Cases e depoimentos">
          {vivas.map((p) => (
            <li key={p.id} className={lista.linha}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate")}>{p.tipo === "case" ? p.titulo : `${p.nome}${p.empresa ? `, ${p.empresa}` : ""}`}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{p.tipo === "case" ? "Case" : "Depoimento"}</span>
              </span>
              <span className={juntar(etiqueta, "ml-2 shrink-0", provaPodeEntrar(p) ? "text-success" : "text-warning")}>
                {provaPodeEntrar(p) ? (
                  <span className="inline-flex items-center">
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Autorizado
                  </span>
                ) : (
                  "Sem autorização"
                )}
              </span>
              <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={`Editar ${p.titulo || p.nome}`} onClick={() => setEdicao(provaParaTela(p))}>
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" className={botao.icone} aria-label={`Arquivar ${p.titulo || p.nome}`} onClick={() => void arquivar(p)}>
                <Archive className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !edicao && <EstadoVazio compacto titulo="Nenhum case ainda." descricao="Só entra na proposta o que o cliente autorizou." />
      )}
    </div>
  );
}

type ParametrosNaTela = Record<keyof ParametrosDaHora, string>;
const paraTela = (p: ParametrosDaHora): ParametrosNaTela => ({
  custos_fixos_mes: String(p.custos_fixos_mes).replace(".", ","),
  pro_labore_mes: String(p.pro_labore_mes).replace(".", ","),
  horas_produtivas_mes: String(p.horas_produtivas_mes).replace(".", ","),
  impostos_pct: String(p.impostos_pct).replace(".", ","),
  margem_pct: String(p.margem_pct).replace(".", ","),
});
const daTela = (t: ParametrosNaTela): ParametrosDaHora =>
  normalizarParametros({
    custos_fixos_mes: lerValor(t.custos_fixos_mes) ?? 0,
    pro_labore_mes: lerValor(t.pro_labore_mes) ?? 0,
    horas_produtivas_mes: Number(t.horas_produtivas_mes.replace(",", ".")),
    impostos_pct: Number(t.impostos_pct.replace(",", ".")),
    margem_pct: Number(t.margem_pct.replace(",", ".")),
  });

function HoraTecnica() {
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const hora = useHoraTecnica(true);
  const [valores, setValores] = useState<ParametrosNaTela | null>(null);
  const [usar, setUsar] = useState(true);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (hora.data && !valores) {
      setValores(paraTela(hora.data.parametros));
      setUsar(hora.data.usar_financeiro);
    }
  }, [hora.data, valores]);
  if (hora.isLoading || !valores) return <p className={texto.auxiliar}>{hora.isError ? "A calculadora não foi lida agora." : "Lendo a calculadora..."}</p>;
  const p = daTela(valores);
  const doFinanceiro = usar && hora.data && hora.data.financeiro && hora.data.financeiro.regras > 0;
  const m = (k: keyof ParametrosNaTela) => (e: { target: { value: string } }) => setValores({ ...valores, [k]: e.target.value });

  const salvar = async () => {
    setSalvando(true);
    try {
      const d = await chamarBiblioteca<{ hora: unknown }>("calculadora_salvar", { parametros: p, usar_financeiro: usar });
      qc.setQueryData(CHAVES.hora(), d.hora);
      setValores(null);
      toast.success("Hora técnica salva.");
    } catch (e) {
      avisarErro(e, "A calculadora não foi salva");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4" data-biblioteca="hora">
      <FaixaDeNumeros
        colunas={2}
        semMoldura
        itens={[
          { rotulo: "Custo da hora", valor: reais(doFinanceiro && hora.data ? hora.data.custo_hora : custoDaHora(p)) },
          { rotulo: `Preço da hora (margem ${p.margem_pct}%)`, valor: reais(doFinanceiro && hora.data ? hora.data.preco_hora : precoDaHora(p)) },
        ]}
      />
      {hora.data && hora.data.aviso && <p className={juntar(texto.auxiliar, "text-warning")}>{hora.data.aviso}</p>}
      <label className={juntar(texto.corpo, "inline-flex items-center")}>
        <input type="checkbox" className="mr-2" checked={usar} onChange={(e) => setUsar(e.target.checked)} />
        Usar os custos do Financeiro
      </label>
      {doFinanceiro && hora.data && hora.data.financeiro && (
        <p className={texto.auxiliar}>
          Financeiro: {reais(hora.data.financeiro.custos_fixos_mes)} de custo fixo e {reais(hora.data.financeiro.pro_labore_mes)} de pró-labore por mês ({hora.data.financeiro.regras} regras).
        </p>
      )}
      <GrupoDeCampos colunas={2}>
        <CampoDeFormulario rotulo="Custos fixos por mês (R$)" apoio={doFinanceiro ? "Vale o do Financeiro" : undefined}>
          <input value={valores.custos_fixos_mes} onChange={m("custos_fixos_mes")} inputMode="decimal" className={campo} disabled={!!doFinanceiro} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Pró-labore por mês (R$)">
          <input value={valores.pro_labore_mes} onChange={m("pro_labore_mes")} inputMode="decimal" className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Horas vendáveis por mês" apoio="A equipe toda, sem o tempo interno">
          <input value={valores.horas_produtivas_mes} onChange={m("horas_produtivas_mes")} inputMode="decimal" className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Impostos (%)">
          <input value={valores.impostos_pct} onChange={m("impostos_pct")} inputMode="decimal" className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Margem desejada (%)">
          <input value={valores.margem_pct} onChange={m("margem_pct")} inputMode="decimal" className={campo} />
        </CampoDeFormulario>
      </GrupoDeCampos>
      <div className="flex justify-end">
        <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

export default function BibliotecaDaAgencia({ aberta, onAberta, aba, onAba }: { aberta: boolean; onAberta: (v: boolean) => void; aba: AbaDaBiblioteca; onAba: (a: AbaDaBiblioteca) => void }) {
  return (
    <Sheet open={aberta} onOpenChange={onAberta}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-biblioteca-da-agencia="">
        <SheetHeader className="text-left">
          <SheetTitle className="flex min-w-0 items-center truncate">
            <BookOpen className="mr-2 h-4 w-4 shrink-0" /> Biblioteca comercial
          </SheetTitle>
          <SheetDescription className="truncate">Serviços, provas e hora técnica da agência</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-wrap border-b border-border" role="tablist" aria-label="Partes da biblioteca">
          {ABAS.map((a) => (
            <button
              key={a.valor}
              type="button"
              role="tab"
              aria-selected={aba === a.valor}
              className={juntar("toque-compacto mr-4 -mb-px border-b-2 pb-2 text-[13px] font-medium", aba === a.valor ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              onClick={() => onAba(a.valor)}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <div className="mt-4" role="tabpanel">
          {aba === "servicos" && <Servicos />}
          {aba === "provas" && <Provas />}
          {aba === "hora" && <HoraTecnica />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
