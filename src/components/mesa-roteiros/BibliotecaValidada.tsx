import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, ChevronDown, ChevronRight, Loader2, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { padraoPara } from "@/lib/mesa/api";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, etiqueta, foco, juntar, superficie, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import {
  candidatosPorObjetivo,
  DICA_DO_OBJETIVO,
  ehObjetivoDaBase,
  MODELOS_VALIDADOS,
  normalizarFichaPropria,
  OBJETIVOS_DA_BASE,
  ROTULO_DA_ORIGEM,
  ROTULO_DO_OBJETIVO,
  type FichaDoModelo,
  type ObjetivoDaBase,
} from "../../../supabase/functions/mesa-roteiros/modulos/roteiros-validados";
import { chamarRoteiros, CHAVES, useBiblioteca } from "./roteirosApi";
import { BlocoRecolhivel } from "./Comuns";

/**
 * Frente ROT (30/09): a biblioteca "Roteiros validados" na etapa Modelos.
 * Escolha por objetivo (Autoridade, Produto, Presença de marca, Venda,
 * Conexão, Engajamento) e por modelo: cada ficha mostra quando usar, os
 * blocos com a função de cada um, gatilhos, o exemplo (paráfrase) e a
 * adaptação por nicho. "Usar" abre um roteiro novo com o modelo; o agente
 * segue a mesma base sozinho quando ninguém escolhe.
 *
 * Os modelos próprios (outros nichos: advogado, conteúdo direto...) entram
 * por "Novo modelo": colar um roteiro de exemplo e Preencher com IA (custo
 * antes), conferir e salvar. Retirar é arquivar, com Desfazer.
 */

export const TODOS = "todos";

function linhasDe(t: string) {
  return t.split("\n").map((x) => x.trim()).filter(Boolean);
}

/** "Gancho: frase que..." por linha vira bloco; sem dois pontos, a linha é a função. */
export function blocosDoTexto(t: string) {
  return linhasDe(t).map((l) => {
    const i = l.indexOf(":");
    return i > 0 ? { funcao: l.slice(0, i).trim(), faz: l.slice(i + 1).trim() } : { funcao: l, faz: "" };
  });
}

type Rascunho = {
  nome: string;
  objetivo: ObjetivoDaBase;
  escopo: "agencia" | "cliente";
  quando_usar: string;
  blocos: string;
  gatilhos: string;
  exemplo: string;
  cuidados: string;
  duracao_min: number;
  duracao_max: number;
  formato: string;
};

const VAZIO: Rascunho = { nome: "", objetivo: "autoridade", escopo: "agencia", quando_usar: "", blocos: "", gatilhos: "", exemplo: "", cuidados: "", duracao_min: 30, duracao_max: 60, formato: "" };

function rascunhoDaFicha(f: FichaDoModelo, escopo: "agencia" | "cliente"): Rascunho {
  return {
    nome: f.nome,
    objetivo: f.objetivo,
    escopo,
    quando_usar: f.quando_usar,
    blocos: f.blocos.map((b) => (b.faz ? `${b.funcao}: ${b.faz}` : b.funcao)).join("\n"),
    gatilhos: f.gatilhos.join(", "),
    exemplo: f.exemplo,
    cuidados: f.cuidados.join("\n"),
    duracao_min: f.duracao_s[0],
    duracao_max: f.duracao_s[1],
    formato: f.formato,
  };
}

export function fichaDoRascunho(r: Rascunho): FichaDoModelo | null {
  return normalizarFichaPropria({
    nome: r.nome,
    objetivo: r.objetivo,
    quando_usar: r.quando_usar,
    blocos: blocosDoTexto(r.blocos),
    gatilhos: r.gatilhos.split(",").map((x) => x.trim()).filter(Boolean),
    exemplo: r.exemplo,
    cuidados: linhasDe(r.cuidados),
    duracao_s: [r.duracao_min, r.duracao_max],
    formato: r.formato,
  });
}

function FichaAberta({ m }: { m: FichaDoModelo }) {
  return (
    <div className={juntar(superficie.poco, "mt-2 min-w-0 space-y-2 px-3 py-3")} data-ficha-do-modelo={m.id}>
      <p className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>
        <span className="font-medium">Quando usar: </span>
        {m.quando_usar}
      </p>
      <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>
        {m.formato} · {m.duracao_s[0]} a {m.duracao_s[1]}s{m.referencia ? ` · estrutura de: ${m.referencia}` : ""}
      </p>
      <ol className="space-y-1 text-[12px] leading-5">
        {m.blocos.map((b, i) => (
          <li key={i} className="[overflow-wrap:anywhere]">
            <span className="font-medium">
              {i + 1}. {b.funcao}
            </span>
            {b.faz ? `: ${b.faz}` : ""}
          </li>
        ))}
      </ol>
      {m.gatilhos.length > 0 && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>Gatilhos: {m.gatilhos.join(", ")}</p>}
      {m.exemplo && <p className={juntar(texto.auxiliar, "italic [overflow-wrap:anywhere]")}>Exemplo de tom: {m.exemplo}</p>}
      {m.nichos.length > 0 && (
        <ul className="space-y-0.5 text-[12px] leading-5 text-muted-foreground">
          {m.nichos.map((n) => (
            <li key={n.nicho} className="[overflow-wrap:anywhere]">
              <span className="font-medium text-foreground">{n.nicho}:</span> {n.como}
            </li>
          ))}
        </ul>
      )}
      {m.cuidados.length > 0 && <p className="text-[12px] leading-5 text-amber-700 [overflow-wrap:anywhere] dark:text-amber-400">Cuidados: {m.cuidados.join(" ")}</p>}
    </div>
  );
}

export default function BibliotecaValidada({ onUsarBase }: { onUsarBase: (id: string) => void }) {
  const mesa = useMesa();
  const { clientId } = mesa;
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const bibliotecaQ = useBiblioteca(clientId);
  const proprios = bibliotecaQ.data ? bibliotecaQ.data.lista : [];
  const [filtro, setFiltro] = useEstadoDaTela<string>(`mesa-roteiros:biblioteca:filtro:${clientId}`, TODOS, { validar: (v) => typeof v === "string" });
  const [aberto, setAberto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [rascunho, setRascunho] = useEstadoDaTela<Rascunho>(`mesa-roteiros:biblioteca:novo:${clientId}`, VAZIO, { validar: (v) => !!v && typeof v === "object" });
  const [exemplo, setExemplo] = useEstadoDaTela<string>(`mesa-roteiros:biblioteca:exemplo:${clientId}`, "");
  const [nicho, setNicho] = useEstadoDaTela<string>(`mesa-roteiros:biblioteca:nicho:${clientId}`, "");
  const [editando, setEditando] = useState<string | null>(null);
  const padrao = padraoPara(mesa.catalogo, "estrategista");
  const objetivo = ehObjetivoDaBase(filtro) ? filtro : null;

  const fichasProprias = proprios.map((p) => p.ficha);
  const escopoDe = (id: string) => (proprios.filter((p) => p.ficha.id === id)[0] || { escopo: "agencia" as const }).escopo;
  const lista = useMemo(() => candidatosPorObjetivo(objetivo, fichasProprias), [objetivo, bibliotecaQ.data]);
  const contagem = (o: ObjetivoDaBase | null) => candidatosPorObjetivo(o, fichasProprias).length;
  const ficha = fichaDoRascunho(rascunho);

  const salvar = async () => {
    if (!ficha) return;
    setOcupado("salvar");
    try {
      const { id: _i, origem: _o, ...corpoDaFicha } = ficha;
      await chamarRoteiros("biblioteca_salvar", { client_id: clientId, escopo: rascunho.escopo, ficha: corpoDaFicha, id: editando || undefined });
      toast.success(editando ? "Modelo atualizado" : "Modelo salvo na biblioteca", { description: rascunho.escopo === "agencia" ? "Vale para todos os clientes." : "Vale só para este cliente." });
      setRascunho(VAZIO);
      setExemplo("");
      setEditando(null);
      void qc.invalidateQueries({ queryKey: CHAVES.biblioteca(clientId) });
    } catch (e) {
      avisarErro(e, "Não foi possível salvar o modelo");
    } finally {
      setOcupado(null);
    }
  };

  const arquivar = async (m: FichaDoModelo, arquivarIt = true) => {
    setOcupado(m.id);
    try {
      await chamarRoteiros("biblioteca_arquivar", { id: m.id, arquivar: arquivarIt });
      void qc.invalidateQueries({ queryKey: CHAVES.biblioteca(clientId) });
      if (arquivarIt) {
        toast.success("Modelo retirado da biblioteca", {
          description: m.nome,
          duration: 9000,
          action: { label: "Desfazer", onClick: () => void arquivar(m, false) },
        });
      } else toast.success("Modelo de volta na biblioteca");
    } catch (e) {
      avisarErro(e, "Não foi possível retirar o modelo");
    } finally {
      setOcupado(null);
    }
  };

  const linha = (m: FichaDoModelo) => {
    const estaAberto = aberto === m.id;
    return (
      <li key={m.id} className="min-w-0 py-2.5" data-modelo-da-base={m.id} data-origem={m.origem}>
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            className={juntar("mr-2 flex min-w-0 flex-1 items-center rounded-sm text-left", foco)}
            onClick={() => setAberto(estaAberto ? null : m.id)}
            aria-expanded={estaAberto}
            aria-label={`${estaAberto ? "Fechar" : "Ver"} a ficha de ${m.nome}`}
          >
            {estaAberto ? <ChevronDown className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{m.nome}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{m.quando_usar}</span>
            </span>
          </button>
          <span className={juntar(etiqueta, "mr-1 hidden bg-primary/10 text-primary sm:inline-flex")}>{ROTULO_DO_OBJETIVO[m.objetivo]}</span>
          {m.origem !== "roteiros_magicos" && <span className={juntar(etiqueta, "mr-1 hidden bg-muted text-muted-foreground md:inline-flex")}>{ROTULO_DA_ORIGEM[m.origem]}</span>}
          <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => onUsarBase(m.id)} aria-label={`Usar ${m.nome} num roteiro novo`}>
            Usar
          </button>
          {m.origem === "proprio" && (
            <>
              <button
                type="button"
                className={juntar(botao.discreto, "ml-1 h-8 px-2 text-[12px]")}
                onClick={() => {
                  setEditando(m.id);
                  setRascunho(rascunhoDaFicha(m, escopoDe(m.id)));
                }}
                aria-label={`Editar ${m.nome}`}
              >
                Editar
              </button>
              <button type="button" className={juntar(botao.icone, "ml-1 hover:text-destructive")} disabled={ocupado === m.id} onClick={() => void arquivar(m)} aria-label={`Retirar ${m.nome}`}>
                {ocupado === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </>
          )}
        </div>
        {estaAberto && <FichaAberta m={m} />}
      </li>
    );
  };

  const mudar = (parte: Partial<Rascunho>) => setRascunho((r) => ({ ...r, ...parte }));

  return (
    <BlocoRecolhivel
      chave={`mesa-roteiros:modelos:validados:${clientId}`}
      nivel={2}
      divisoria={false}
      icone={<BookOpenCheck className="h-4 w-4" />}
      titulo="Roteiros validados"
      ajuda="A base que o agente segue em todo roteiro. Escolha o objetivo e o modelo, ou deixe no automático: o agente escolhe pelo objetivo e pelo contexto da marca e diz qual usou. Os 23 modelos vêm do material Roteiros Mágicos (só estrutura e técnica); os da casa cobrem conteúdo direto, advogado, produto e bastidor."
      estado={`${MODELOS_VALIDADOS.length + proprios.length} modelos`}
      resumo={`${MODELOS_VALIDADOS.length + proprios.length} modelos`}
      data-biblioteca-validada=""
    >
      <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1" role="radiogroup" aria-label="Objetivo do vídeo">
        {[TODOS as string].concat(OBJETIVOS_DA_BASE as unknown as string[]).map((o) => {
          const ativo = filtro === o;
          const rotulo = o === TODOS ? "Todos" : ROTULO_DO_OBJETIVO[o as ObjetivoDaBase];
          return (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={ativo}
              title={o === TODOS ? undefined : DICA_DO_OBJETIVO[o as ObjetivoDaBase]}
              onClick={() => setFiltro(o)}
              className={juntar("inline-flex h-8 items-center rounded-md border px-2.5 text-[12px] transition-colors", ativo ? "border-primary bg-primary/5 font-medium text-foreground" : "border-border text-muted-foreground hover:border-primary/40", foco)}
            >
              {rotulo}
              <span className="ml-1 tabular-nums text-muted-foreground">{o === TODOS ? contagem(null) : contagem(o as ObjetivoDaBase)}</span>
            </button>
          );
        })}
      </div>
      {objetivo && <p className={juntar(texto.auxiliar, "leading-5 [overflow-wrap:anywhere]")}>{DICA_DO_OBJETIVO[objetivo]} Primeiro os que têm este objetivo como principal.</p>}
      {bibliotecaQ.isLoading && <Carregando forma="lista" linhas={2} rotulo="Lendo os modelos próprios" />}
      <ul className="divide-y divide-border" data-lista-da-base="">
        {lista.map(linha)}
      </ul>
      {!lista.length && <EstadoVazio compacto titulo="Nenhum modelo com este objetivo." />}

      <BlocoRecolhivel
        chave={`mesa-roteiros:modelos:novo-da-base:${clientId}`}
        nivel={3}
        recolhidoDeInicio
        icone={<Plus className="h-4 w-4" />}
        titulo={editando ? "Editar modelo próprio" : "Novo modelo próprio"}
        ajuda="Para outros nichos e formatos (advogado, conteúdo mais direto...). Cole um ou mais roteiros que funcionaram e use Preencher com IA: vem a estrutura e a técnica, sem copiar o texto. Confira e salve. Da agência vale para todos os clientes; deste cliente, só para ele."
        data-novo-modelo=""
      >
        {bibliotecaQ.data && bibliotecaQ.data.indisponivel && (
          <p className={juntar(superficie.poco, "px-3 py-2 text-[12px]")}>O banco ainda não guarda modelos próprios. A base validada funciona normalmente.</p>
        )}
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="Roteiro de exemplo" ajuda="Opcional. Um ou mais roteiros que deram certo; a IA tira a estrutura." largo>
            <textarea value={exemplo} onChange={(e) => setExemplo(e.target.value)} rows={4} maxLength={12000} placeholder="Cole aqui o roteiro que funcionou" className={campoTexto} aria-label="Roteiro de exemplo" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Nicho">
            <input value={nicho} onChange={(e) => setNicho(e.target.value)} maxLength={200} placeholder="Ex.: advocacia previdenciária" className={campo} />
          </CampoDeFormulario>
          <div className="flex min-w-0 items-end">
            <BotaoComCusto
              rotulo={
                <>
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Preencher com IA
                </>
              }
              titulo="Ficha montada"
              variant="outline"
              className="h-9"
              disabled={exemplo.trim().length < 80 || !padrao}
              descricao="Lê o exemplo e monta a ficha (blocos, gatilhos, quando usar). Nada é salvo antes de você conferir."
              partes={() => [{ modeloId: padrao ? padrao.id : "", tipo: "texto", tokensEntrada: 5_000, tokensSaida: 1_800 }]}
              executar={() => chamarRoteiros<{ ficha: FichaDoModelo }>("biblioteca_extrair", { client_id: clientId, texto: exemplo, nicho: nicho.trim() || undefined })}
              aoConcluir={(d) => {
                if (d && d.ficha) setRascunho(rascunhoDaFicha(d.ficha, rascunho.escopo));
              }}
            />
          </div>
        </GrupoDeCampos>
        <GrupoDeCampos colunas={3}>
          <CampoDeFormulario rotulo="Nome do modelo" obrigatorio>
            <input value={rascunho.nome} onChange={(e) => mudar({ nome: e.target.value })} maxLength={120} placeholder="Ex.: Advogado responde em 40s" className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Objetivo">
            <select value={rascunho.objetivo} onChange={(e) => mudar({ objetivo: e.target.value as ObjetivoDaBase })} className={campo}>
              {OBJETIVOS_DA_BASE.map((o) => (
                <option key={o} value={o}>
                  {ROTULO_DO_OBJETIVO[o]}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Vale para">
            <select value={rascunho.escopo} onChange={(e) => mudar({ escopo: e.target.value === "cliente" ? "cliente" : "agencia" })} className={campo} disabled={!!editando}>
              <option value="agencia">Todos os clientes (agência)</option>
              <option value="cliente">Só {mesa.clientName || "este cliente"}</option>
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Quando usar" largo>
            <input value={rascunho.quando_usar} onChange={(e) => mudar({ quando_usar: e.target.value })} maxLength={300} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Blocos" apoio="Um por linha: Função: o que o bloco faz. Mínimo 2." obrigatorio largo>
            <textarea value={rascunho.blocos} onChange={(e) => mudar({ blocos: e.target.value })} rows={5} className={campoTexto} placeholder={"Pergunta real: a dúvida como o público fala\nRegra geral: a resposta curta\nRessalva: cada caso é analisado"} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Duração mínima (s)">
            <input type="number" min={10} max={300} value={rascunho.duracao_min} onChange={(e) => mudar({ duracao_min: Math.max(10, Math.min(300, Number(e.target.value) || 10)) })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Duração máxima (s)">
            <input type="number" min={10} max={300} value={rascunho.duracao_max} onChange={(e) => mudar({ duracao_max: Math.max(10, Math.min(300, Number(e.target.value) || 10)) })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Gatilhos" apoio="Separados por vírgula.">
            <input value={rascunho.gatilhos} onChange={(e) => mudar({ gatilhos: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Exemplo de tom" apoio="Paráfrase curta; o roteirista não copia." largo>
            <input value={rascunho.exemplo} onChange={(e) => mudar({ exemplo: e.target.value })} maxLength={400} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Cuidados" apoio="Um por linha. Ex.: sem promessa de resultado (OAB)." largo>
            <textarea value={rascunho.cuidados} onChange={(e) => mudar({ cuidados: e.target.value })} rows={2} className={juntar(campoTexto, "min-h-[64px]")} />
          </CampoDeFormulario>
        </GrupoDeCampos>
        <div className="-m-1 flex min-w-0 flex-wrap items-center justify-end [&>*]:m-1">
          {(editando || rascunho.nome || rascunho.blocos) && (
            <button
              type="button"
              className={botao.discreto}
              onClick={() => {
                setRascunho(VAZIO);
                setEditando(null);
              }}
            >
              Limpar
            </button>
          )}
          <button type="button" className={botao.primario} disabled={!ficha || ocupado === "salvar"} onClick={() => void salvar()}>
            {ocupado === "salvar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            {editando ? "Salvar mudanças" : "Salvar na biblioteca"}
          </button>
        </div>
      </BlocoRecolhivel>
    </BlocoRecolhivel>
  );
}
