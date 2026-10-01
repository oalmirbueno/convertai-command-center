import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { parametrosComPadrao, proporSkill, SKILLS_DO_EDITOR, type ContextoDaSkill, type IdDaSkill, type PropostaDaSkill, type Skill, type ValorDoParametro } from "@/lib/editor/skills";
import { acaoDaProposta, acaoFeita } from "@/lib/editor/cartao";
import { temFala } from "@/lib/editor/transcricao";
import type { AcaoDoAgente, RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";

/**
 * Painel de skills do editor (frente V-B): "puxar uma skill" e aplicar no
 * projeto (ou no trecho selecionado). Cada cartão monta a PROPOSTA pelo código
 * (sem IA), mostra a lista exata no cartão de ação da casa e só muda com
 * Confirmar; depois dá para Desfazer.
 */

export interface ControleDePropostas {
  aplicar: (p: PropostaDaSkill, rotulo: string) => boolean;
  desfazer: (p: PropostaDaSkill) => boolean;
  /** Frente EDT: grava o projeto agora (antes de pôr uma amostra na fila). */
  salvarAgora?: () => Promise<void>;
}

function Parametros({ s, valores, mudar }: { s: Skill; valores: Record<string, ValorDoParametro>; mudar: (k: string, v: ValorDoParametro) => void }) {
  if (!s.parametros.length) return null;
  return (
    <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
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

export default function PainelDeSkills({ projeto, contexto, controle, ids }: { projeto: ProjetoDeEdicao; contexto: ContextoDaSkill; controle: ControleDePropostas; /** Rodada 2: só estas skills (painéis por área). */ ids?: IdDaSkill[] }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [valores, setValores] = useState<Record<string, Record<string, ValorDoParametro>>>({});
  const [proposta, setProposta] = useState<{ p: PropostaDaSkill; id: string; acao: AcaoDoAgente } | null>(null);
  const fala = temFala(projeto);

  const propor = (s: Skill) => {
    const params = parametrosComPadrao(s, valores[s.id]);
    const p = proporSkill(s.id, projeto, contexto, params);
    const id = `${s.id}-${Date.now().toString(36)}`;
    // A lista do cartão é montada UMA vez (com os apelidos de antes): o cartão não volta a "aberta" quando o projeto muda.
    setProposta({ p, id, acao: acaoDaProposta(id, "editor", p.resumo, p.operacoes, projeto, p.avisos) });
  };

  const aoPedido = async (pedido: "confirmar" | "descartar" | "desfazer"): Promise<RespostaDaAcao> => {
    if (!proposta) return {};
    const agora = new Date().toISOString();
    const acao = proposta.acao;
    if (pedido === "descartar") {
      setProposta(null);
      return { anexo: { ...acao, descartada_em: agora } };
    }
    if (pedido === "desfazer") {
      // AG2: Desfazer que não voltou não mostra mais "Voltou como estava, 0 itens" (o cartão mostra o motivo).
      if (!controle.desfazer(proposta.p)) throw new Error("Mudou depois de aplicar: use Ctrl+Z para voltar passo a passo.");
      return { anexo: { ...acaoFeita(acao, agora), desfeita_em: agora }, voltaram: acao.itens.length };
    }
    const ok = controle.aplicar(proposta.p, proposta.p.titulo);
    if (!ok) throw new Error("O projeto mudou enquanto a proposta estava aberta. Veja a proposta de novo.");
    return { anexo: acaoFeita(acao, agora), feitos: acao.itens.length, falhas: 0 };
  };

  return (
    <div className="space-y-1" data-painel-de-skills="">
      {proposta && (
        <div className="mb-3">
          {proposta.p.operacoes.length ? (
            <CartaoDeAcao
              key={proposta.id}
              acao={proposta.acao}
              titulo={proposta.p.titulo}
              onPedido={aoPedido}
              observacao="Nada muda até confirmar. Ctrl+Z também desfaz."
            />
          ) : (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-[13px]">
              <p className="font-medium">{proposta.p.titulo}</p>
              <p className="text-muted-foreground">{proposta.p.resumo}</p>
              {proposta.p.avisos.map((a) => (
                <p key={a} className="text-muted-foreground">
                  {a}
                </p>
              ))}
              <button type="button" className={juntar(botao.discreto, "mt-1 h-7 px-2")} onClick={() => setProposta(null)}>
                Fechar
              </button>
            </div>
          )}
        </div>
      )}
      <ul className="divide-y divide-border">
        {SKILLS_DO_EDITOR.filter((s) => !ids || ids.indexOf(s.id) >= 0).map((s) => {
          const aberto = aberta === s.id;
          const vals = parametrosComPadrao(s, valores[s.id]);
          const semFala = s.precisaDeFala && !fala;
          return (
            <li key={s.id} className="py-2" data-skill={s.id}>
              <div className="flex min-w-0 items-center">
                <Sparkles className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.rotulo}</span>
                <AjudaRecolhida titulo={s.rotulo}>
                  {s.descricao} Base: {s.referencia}.
                </AjudaRecolhida>
                {semFala && <span className={juntar(etiqueta, "ml-1 bg-muted text-muted-foreground")}>sem fala</span>}
                {s.parametros.length > 0 && (
                  <button type="button" className={botao.icone} onClick={() => setAberta(aberto ? null : s.id)} aria-expanded={aberto} aria-label={`Ajustes de ${s.rotulo}`}>
                    <ChevronDown className={juntar("h-3.5 w-3.5 transition-transform", aberto && "rotate-180")} />
                  </button>
                )}
                <button type="button" className={juntar(botao.secundario, "ml-1 h-8 px-2.5")} onClick={() => propor(s)} disabled={semFala} title={semFala ? "Precisa da fala: use Timestamp primeiro." : undefined}>
                  Ver proposta
                </button>
              </div>
              {aberto && <Parametros s={s} valores={vals} mudar={(k, v) => setValores((x) => ({ ...x, [s.id]: { ...vals, [k]: v } }))} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
