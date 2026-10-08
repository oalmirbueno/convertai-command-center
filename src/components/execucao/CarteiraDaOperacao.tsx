import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { gravarCarteira, lerCarteira, blocoDaCampanha } from '@/lib/carteiraOperacao';
import { botao, campo, juntar } from '@/components/sistema';
import type { carteiraPerformance } from '@/lib/performanceMeta';

export const ROLAGEM_OPERACAO = 'overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:hsl(var(--border))_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border';
type Cliente = { id: string; company_name?: string | null; full_name?: string | null; plan_status?: string | null };
type Projeto = { id: string; scope: string | null; updated_at: string };
export const nomeCliente = (c: Cliente) => c.company_name || c.full_name || 'Cliente sem nome';

export function OrganizarCarteira({ clientes, projeto, selecionados }: { clientes: Cliente[]; projeto?: Projeto; selecionados: string[] }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [versaoAberta, setVersaoAberta] = useState<Projeto>();
  const qc = useQueryClient();
  const salvar = useMutation({
    mutationFn: async () => {
      if (!versaoAberta) throw new Error('A frente de acompanhamento não foi encontrada.');
      const scope = gravarCarteira(versaoAberta.scope, ids);
      const r = await supabase.from('projects').update({ scope }).eq('id', versaoAberta.id).eq('updated_at', versaoAberta.updated_at).select('id,scope').maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) throw new Error('A carteira mudou enquanto você editava. Atualize a leitura e tente novamente.');
      if (JSON.stringify(lerCarteira(r.data.scope)) !== JSON.stringify(lerCarteira(scope))) throw new Error('Não foi possível confirmar a seleção salva.');
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['execucao-performance-meta'] }); setAberto(false); toast.success('Carteira salva. O Hermes usará esta seleção na próxima leitura.'); },
    onError: e => toast.error(e.message),
  });
  return <div className="space-y-3">
    <button className={botao.secundario} disabled={!projeto || salvar.isPending} onClick={() => { setIds([...selecionados]); setVersaoAberta(projeto); setAberto(!aberto); }}>Organizar clientes</button>
    {aberto && <section aria-label="Organizar clientes da carteira" className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">Quem acompanhar</h3><span className="text-xs text-muted-foreground">{ids.length} selecionados</span></div>
      <input className={campo} aria-label="Buscar cliente para acompanhamento" placeholder="Buscar cliente do painel" value={busca} onChange={e => setBusca(e.target.value)} />
      <div className={juntar(ROLAGEM_OPERACAO, 'max-h-64 grid gap-1 sm:grid-cols-2 lg:grid-cols-3')}>
        {clientes.filter(c => nomeCliente(c).toLowerCase().includes(busca.toLowerCase())).map(c => <label key={c.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/40 cursor-pointer"><input type="checkbox" disabled={salvar.isPending || c.id === '14f72d12-a00b-4673-99c6-4dabbcc8aad1'} className="accent-primary" checked={ids.includes(c.id)} onChange={e => setIds(a => e.target.checked ? [...a, c.id] : a.filter(id => id !== c.id))} /><span className="text-sm">{nomeCliente(c)}{(c.id === "14f72d12-a00b-4673-99c6-4dabbcc8aad1" || !["active", "onboarding", "standby"].includes(c.plan_status || "")) && <span className="block text-xs text-muted-foreground">Cadastro fora da carteira padrão</span>}{c.id === "20c96cea-6ada-4db5-a408-25a3b0c978ba" && <span className="block text-xs text-muted-foreground">Contexto disponível · anúncios restritos</span>}</span></label>)}
      </div>
      <div className="flex flex-wrap items-center gap-2"><button className={botao.primario} disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Salvar carteira'}</button><button className={botao.discreto} disabled={salvar.isPending} onClick={() => setAberto(false)}>Cancelar</button><span className="text-xs text-muted-foreground">Retirar daqui mantém o cadastro, as campanhas e o histórico.</span></div>
    </section>}
  </div>;
}

export default function CarteiraDaOperacao({ clientes, linhas, aoConversar, aoVerCampanhas }: {
  clientes: Cliente[]; linhas: ReturnType<typeof carteiraPerformance>;
  aoConversar: (cliente: Cliente, criativo?: boolean) => void; aoVerCampanhas: (id: string) => void;
}) {
  const cards = clientes.map(c => {
    const campanhas = linhas.filter(x => x.campanha.client_id === c.id);
    const ativo = campanhas.filter(x => blocoDaCampanha(x) === 'ativo').length;
    const conferir = campanhas.filter(x => blocoDaCampanha(x) === 'trabalhar' || x.divergencia).length;
    return { c, campanhas, ativo, conferir, bloco: ativo ? 'ativo' : conferir || !campanhas.length ? 'trabalhar' : 'inativo' };
  });
  return <div className="grid min-w-0 gap-4 lg:grid-cols-3">
    {([['ativo', 'Em atividade', 'Campanhas com entrega observada'], ['inativo', 'Sem entrega observada', 'Campanhas sem entrega no período observado'], ['trabalhar', 'Próximos trabalhos', 'Preparar ou conferir antes de avançar']] as const).map(([id, titulo, ajuda]) => <section key={id} className="min-w-0 rounded-xl border border-border bg-card flex flex-col" aria-label={titulo}>
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border"><h3 className="text-sm font-semibold" title={ajuda}>{titulo}</h3><span className="text-xs text-muted-foreground">{cards.filter(x => x.bloco === id).length}</span></header>
      <div tabIndex={0} aria-label={`Clientes: ${titulo}`} className={juntar(ROLAGEM_OPERACAO, 'h-[min(52vh,580px)] min-h-64 p-3 space-y-3')}>
        {cards.filter(x => x.bloco === id).map(({ c, campanhas, ativo, conferir }) => <article key={c.id} className="rounded-lg border border-border p-3 space-y-3">
          <div><h4 className="text-sm font-semibold">{nomeCliente(c)}</h4><p className="mt-1 text-xs text-muted-foreground">{campanhas.length ? `${campanhas.length} campanhas · ${ativo} com entrega` : 'Ainda sem campanha registrada'}</p></div>
          {conferir > 0 && <p className="text-xs text-warning">{conferir} campanhas precisam de conferência</p>}
          <p className="text-xs leading-5">{!campanhas.length ? 'Sugestão: alinhar objetivo e preparar os primeiros criativos.' : conferir ? 'Sugestão: conferir dados e pendências com o agente.' : ativo ? 'Sugestão: acompanhar resultados e preparar a próxima variação.' : 'Sugestão: conversar sobre a próxima ação deste cliente.'}</p>
          <div className="flex flex-wrap gap-1"><button className={botao.secundario} onClick={() => aoConversar(c)}>Conversar</button><button className={botao.discreto} onClick={() => aoConversar(c, true)}>Pedir criativo</button>{campanhas.length > 0 && <button className={botao.discreto} onClick={() => aoVerCampanhas(c.id)}>Campanhas</button>}</div>
        </article>)}
        {!cards.some(x => x.bloco === id) && <p className="py-8 text-center text-xs text-muted-foreground">Nenhum cliente neste grupo.</p>}
      </div>
    </section>)}
  </div>;
}
