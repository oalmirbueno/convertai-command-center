import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, Sparkles, Undo2, X } from "lucide-react";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { parametrosComPadrao, proporSkill, SKILLS_DO_EDITOR, type ContextoDaSkill, type IdDaSkill, type PropostaDaSkill, type Skill, type ValorDoParametro } from "@/lib/editor/skills";
import { apelidosDoProjeto, rotuloDaOperacao } from "@/lib/editor/apelidos";
import { provaDaMudanca } from "@/lib/editor/agente";
import { temFala } from "@/lib/editor/transcricao";

/**
 * Painel de skills do editor (frente V-B; refeito em 02/10, dono: "Skills
 * está muito travado, abre um pop-up gigante e fica com cara de falso").
 *
 * Agora: busca em cima, skills agrupadas pelo objetivo, cada uma com o nome,
 * uma linha do que faz e UM botão "Aplicar". Aplicar monta a proposta pelo
 * código (sem IA) e mostra, logo embaixo da skill, quantas mudanças e o que
 * muda na duração, com Confirmar e Cancelar; a lista completa fica recolhida
 * em "Ver a lista". Confirmar é um passo só no Ctrl+Z, e o Desfazer fica ali.
 * Nada de cartão grande nem janela por cima.
 */

export interface ControleDePropostas {
  aplicar: (p: PropostaDaSkill, rotulo: string) => boolean;
  desfazer: (p: PropostaDaSkill) => boolean;
  /** Frente EDT: grava o projeto agora (antes de pôr uma amostra na fila). */
  salvarAgora?: () => Promise<void>;
}

/** Grupos pelo objetivo de quem edita (a ordem é a do trabalho). */
export const GRUPOS_DE_SKILLS: { titulo: string; ids: IdDaSkill[] }[] = [
  { titulo: "Cortar e limpar", ids: ["brabo", "cortar_pela_onda", "ficar_com_melhor_tomada", "cortar_silencios", "remover_duplicados", "fechar_buracos"] },
  { titulo: "Ordem e transições", ids: ["organizar_por_roteiro", "transicoes_suaves", "antes_depois"] },
  { titulo: "Legenda e som", ids: ["legendas", "efeitos_sonoros"] },
  { titulo: "Imagem e ritmo", ids: ["punch_in", "zoom_nos_momentos", "reenquadrar", "cor"] },
];

const MAX_LINHAS_DA_LISTA = 80;

/** Primeira frase da descrição (a tela mostra uma linha; o resto vai no title). */
export const linhaDaSkill = (d: string) => String(d || "").split(/\.\s|;\s/)[0].replace(/\.$/, "");

const sem = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

interface PropostaNaTela {
  id: string;
  skill: IdDaSkill;
  p: PropostaDaSkill;
  estado: "aberta" | "feita" | "desfeita";
  /** Lista do que muda, montada UMA vez com os apelidos de antes. */
  lista: string[];
  prova: string;
  erro: string | null;
}

function Parametros({ s, valores, mudar }: { s: Skill; valores: Record<string, ValorDoParametro>; mudar: (k: string, v: ValorDoParametro) => void }) {
  if (!s.parametros.length) return null;
  return (
    <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-2 pl-5">
      {s.parametros.map((d) => (
        <label key={d.chave} className="block min-w-0">
          <span className={texto.rotulo}>{d.rotulo}</span>
          {d.tipo === "numero" ? (
            <input type="number" className={juntar(campo, "mt-1 h-8")} min={d.min} max={d.max} step={d.passo} value={String(valores[d.chave])} onChange={(e) => mudar(d.chave, Number(e.target.value))} />
          ) : d.tipo === "sim_nao" ? (
            <select className={juntar(campo, "mt-1 h-8")} value={valores[d.chave] ? "sim" : "nao"} onChange={(e) => mudar(d.chave, e.target.value === "sim")}>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </select>
          ) : (
            <select className={juntar(campo, "mt-1 h-8")} value={String(valores[d.chave])} onChange={(e) => mudar(d.chave, e.target.value)}>
              {(d.opcoes || []).map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          )}
        </label>
      ))}
    </div>
  );
}

/** A proposta logo embaixo da skill: resumo, Confirmar/Cancelar, lista recolhida, depois Desfazer. */
function PropostaEmLinha({ x, confirmar, cancelar, desfazer }: { x: PropostaNaTela; confirmar: () => void; cancelar: () => void; desfazer: () => void }) {
  const [verLista, setVerLista] = useState(false);
  const n = x.lista.length;
  if (!x.p.operacoes.length) {
    return (
      <div className="mt-1.5 border-l-2 border-border pl-3 text-[12.5px]" data-proposta-da-skill="vazia">
        <p className="text-muted-foreground">{x.p.resumo}</p>
        {x.p.avisos.map((a) => (
          <p key={a} className="text-muted-foreground">
            {a}
          </p>
        ))}
        <button type="button" className={juntar(botao.discreto, "mt-0.5 h-7 px-2 text-[12px]")} onClick={cancelar}>
          Fechar
        </button>
      </div>
    );
  }
  return (
    <div className={juntar("mt-1.5 border-l-2 pl-3 text-[12.5px]", x.estado === "feita" ? "border-success" : x.estado === "desfeita" ? "border-border" : "border-primary")} data-proposta-da-skill={x.estado} role="status" aria-live="polite">
      <p className="[overflow-wrap:anywhere]">
        <span className="font-medium">
          {n} {n === 1 ? "mudança" : "mudanças"}
        </span>
        {x.prova ? ` · ${x.prova.replace(/^Muda: /, "").replace(/\.$/, "")}` : ""}
      </p>
      <p className="text-muted-foreground [overflow-wrap:anywhere]">{x.p.resumo}</p>
      {x.p.avisos.map((a) => (
        <p key={a} className="text-amber-600 dark:text-amber-400 [overflow-wrap:anywhere]">
          {a}
        </p>
      ))}
      {x.erro && (
        <p className="text-destructive" role="alert">
          {x.erro}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {x.estado === "aberta" && (
          <>
            <button type="button" className={juntar(botao.primario, "h-8 px-3")} onClick={confirmar}>
              <Check className="mr-1 h-3.5 w-3.5" />
              Confirmar
            </button>
            <button type="button" className={juntar(botao.discreto, "h-8 px-2")} onClick={cancelar}>
              Cancelar
            </button>
          </>
        )}
        {x.estado === "feita" && (
          <>
            <span className={juntar(etiqueta, "bg-success/15 text-foreground")}>
              <Check className="mr-1 h-3 w-3" />
              Feito
            </span>
            <button type="button" className={juntar(botao.secundario, "h-8 px-2.5")} onClick={desfazer}>
              <Undo2 className="mr-1 h-3.5 w-3.5" />
              Desfazer
            </button>
          </>
        )}
        {x.estado === "desfeita" && <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>Desfeito: voltou como estava</span>}
        <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => setVerLista((v) => !v)} aria-expanded={verLista}>
          {verLista ? "Esconder a lista" : "Ver a lista"}
          <ChevronDown className={juntar("ml-1 h-3.5 w-3.5 transition-transform", verLista && "rotate-180")} />
        </button>
        {x.estado !== "aberta" && (
          <button type="button" className={botao.icone} onClick={cancelar} aria-label="Fechar">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {verLista && (
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[12px] text-muted-foreground">
          {x.lista.slice(0, MAX_LINHAS_DA_LISTA).map((l, k) => (
            <li key={k} className="[overflow-wrap:anywhere]">
              {l}
            </li>
          ))}
          {n > MAX_LINHAS_DA_LISTA && <li className="list-none">e mais {n - MAX_LINHAS_DA_LISTA} iguais</li>}
        </ol>
      )}
    </div>
  );
}

const LinhaDaSkill = memo(function LinhaDaSkill({ s, semFala, abertoAjuste, alternarAjuste, aplicar }: { s: Skill; semFala: boolean; abertoAjuste: boolean; alternarAjuste: (id: string) => void; aplicar: (s: Skill) => void }) {
  return (
    <div className="flex min-w-0 items-center">
      <Sparkles className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1" title={`${s.descricao} Base: ${s.referencia}.`}>
        <span className="block truncate text-[13px] font-medium">{s.rotulo}</span>
        <span className={juntar(texto.auxiliar, "block truncate")}>{linhaDaSkill(s.descricao)}</span>
      </span>
      {semFala && <span className={juntar(etiqueta, "ml-1 bg-muted text-muted-foreground")}>sem fala</span>}
      {s.parametros.length > 0 && (
        <button type="button" className={botao.icone} onClick={() => alternarAjuste(s.id)} aria-expanded={abertoAjuste} aria-label={`Ajustes de ${s.rotulo}`}>
          <ChevronDown className={juntar("h-3.5 w-3.5 transition-transform", abertoAjuste && "rotate-180")} />
        </button>
      )}
      <button type="button" className={juntar(botao.secundario, "ml-1 h-8 px-2.5")} onClick={() => aplicar(s)} disabled={semFala} title={semFala ? "Precisa da fala: use Timestamp primeiro." : "Mostra o que muda; nada muda antes de Confirmar"}>
        Aplicar
      </button>
    </div>
  );
});

export default function PainelDeSkills({ projeto, contexto, controle, ids }: { projeto: ProjetoDeEdicao; contexto: ContextoDaSkill; controle: ControleDePropostas; /** Rodada 2: só estas skills (painéis por área). */ ids?: IdDaSkill[] }) {
  const [ajuste, setAjuste] = useState<string | null>(null);
  const [valores, setValores] = useState<Record<string, Record<string, ValorDoParametro>>>({});
  const [proposta, setProposta] = useState<PropostaNaTela | null>(null);
  const [busca, setBusca] = useState("");
  const [fechados, setFechados] = useState<Record<string, boolean>>({});
  const fala = useMemo(() => temFala(projeto), [projeto]);

  // O contexto e o projeto mais novos, sem redesenhar as linhas (que são memo).
  const atual = { projeto, contexto, valores };
  const aplicar = (s: Skill) => {
    const params = parametrosComPadrao(s, atual.valores[s.id]);
    const p = proporSkill(s.id, atual.projeto, atual.contexto, params);
    const a = apelidosDoProjeto(atual.projeto);
    const lista = p.operacoes.filter((o) => o.op !== "registrar_skill").map((o) => rotuloDaOperacao(o, atual.projeto, a));
    setProposta({ id: `${s.id}-${Date.now().toString(36)}`, skill: s.id, p, estado: "aberta", lista, prova: provaDaMudanca(atual.projeto, p.resultado), erro: null });
  };
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;
  const aplicarEstavel = useCallback((s: Skill) => aplicarRef.current(s), []);
  const alternarAjuste = useCallback((id: string) => setAjuste((x) => (x === id ? null : id)), []);

  const confirmar = () => {
    if (!proposta) return;
    const ok = controle.aplicar(proposta.p, proposta.p.titulo);
    setProposta({ ...proposta, estado: ok ? "feita" : "aberta", erro: ok ? null : "O projeto mudou enquanto a proposta estava aberta. Aplique de novo." });
  };
  const desfazer = () => {
    if (!proposta) return;
    // AG2: Desfazer que não voltou diz o motivo (nunca "voltou como estava" sem ter voltado).
    const ok = controle.desfazer(proposta.p);
    setProposta({ ...proposta, estado: ok ? "desfeita" : "feita", erro: ok ? null : "Mudou depois de aplicar: use Ctrl+Z para voltar passo a passo." });
  };

  const visiveis = SKILLS_DO_EDITOR.filter((s) => !ids || ids.indexOf(s.id) >= 0);
  const q = sem(busca).trim();
  const batem = q ? visiveis.filter((s) => q.split(/\s+/).every((p) => sem(`${s.rotulo} ${s.descricao}`).indexOf(p) >= 0)) : visiveis;
  const nosGrupos = new Set(GRUPOS_DE_SKILLS.reduce((l, g) => l.concat(g.ids), [] as string[]));
  const grupos = GRUPOS_DE_SKILLS.map((g) => ({ titulo: g.titulo, skills: batem.filter((s) => g.ids.indexOf(s.id) >= 0).sort((a, b) => g.ids.indexOf(a.id) - g.ids.indexOf(b.id)) }))
    .concat([{ titulo: "Outras", skills: batem.filter((s) => !nosGrupos.has(s.id)) }])
    .filter((g) => g.skills.length);
  const comTitulos = !ids || grupos.length > 1;

  return (
    <div className="space-y-2" data-painel-de-skills="">
      {visiveis.length > 5 && (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input type="search" className={juntar(campo, "h-8 pl-7 text-[12.5px]")} placeholder="Buscar skill (ex.: silêncio, legenda)" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar skill" />
        </label>
      )}
      {!batem.length && <p className={juntar(texto.auxiliar, "py-2")}>Nenhuma skill com esse nome.</p>}
      {grupos.map((g) => {
        const fechado = !q && !!fechados[g.titulo];
        return (
          <section key={g.titulo} className="min-w-0" data-grupo-de-skills={g.titulo}>
            {comTitulos && (
              <button type="button" className="flex w-full items-center py-1 text-left" onClick={() => setFechados((x) => ({ ...x, [g.titulo]: !x[g.titulo] }))} aria-expanded={!fechado}>
                <span className={juntar(texto.rotulo, "flex-1")}>{g.titulo}</span>
                <ChevronDown className={juntar("h-3.5 w-3.5 text-muted-foreground transition-transform", fechado && "-rotate-90")} />
              </button>
            )}
            {!fechado && (
              <ul className="divide-y divide-border">
                {g.skills.map((s) => {
                  const vals = parametrosComPadrao(s, valores[s.id]);
                  return (
                    <li key={s.id} className="py-2" data-skill={s.id}>
                      <LinhaDaSkill s={s} semFala={s.precisaDeFala && !fala} abertoAjuste={ajuste === s.id} alternarAjuste={alternarAjuste} aplicar={aplicarEstavel} />
                      {ajuste === s.id && <Parametros s={s} valores={vals} mudar={(k, v) => setValores((x) => ({ ...x, [s.id]: { ...vals, [k]: v } }))} />}
                      {proposta && proposta.skill === s.id && <PropostaEmLinha key={proposta.id} x={proposta} confirmar={confirmar} cancelar={() => setProposta(null)} desfazer={desfazer} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
