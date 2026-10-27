import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Megaphone, Play, ShieldAlert } from "lucide-react";
import TituloMembros from "@/components/membros/TituloMembros";
import { AjudaRecolhida } from "@/components/sistema";
import { useAuth } from "@/contexts/AuthContext";
import {
  aprovarPolitica,
  arquivarPolitica,
  concederAcesso,
  criarPolitica,
  erroDoBolso,
  lerVisaoAdmin,
  processarFila,
  reconciliar,
  salvarConfig,
  type VisaoAdmin,
} from "@/lib/bolso/api";
import { dataCurta, FORMATOS, type Formato } from "@/lib/bolso/modelo";

/**
 * Administração do Aceleriq de Bolso (26/10/2026). Tudo nasce desligado. As chaves e a política comercial
 * são decisões do dono: aprovar a política a transforma em contrato (não muda mais; uma nova versão
 * substitui). Créditos de teste usam carteira separada e nunca valem para o acesso real.
 */

type Pessoa = { id: string; full_name: string; email: string };

const CHAVES: { id: keyof VisaoAdmin["config"]; nome: string; dica: string; perigo?: boolean }[] = [
  { id: "modulo_exposto", nome: "Estúdio visível aos membros", dica: "Desligado: só a administração vê o estúdio." },
  { id: "modo_simulado", nome: "Modo demonstração", dica: "Provedor simulado para admin e contas com crédito de teste. Faixa de DEMONSTRAÇÃO sempre visível." },
  { id: "geracao_real", nome: "Geração real (OpenAI)", dica: "Exige política aprovada e a chave do servidor ligada. Gasta dinheiro.", perigo: true },
  { id: "pagamentos", nome: "Eventos de pagamento", dica: "Sem isto, eventos só são guardados. Kiwify e Asaas continuam desligados.", perigo: true },
  { id: "kill_switch", nome: "Pausar o estúdio", dica: "Para pedidos novos na hora. Consulta e download continuam." },
];

export default function AdminBolso({ pessoas }: { pessoas: Pessoa[] }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const visao = useQuery({ queryKey: ["bolso", "admin"], queryFn: lerVisaoAdmin, retry: false });
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [limites, setLimites] = useState({ paralelo_por_usuario: "", pedidos_por_dia_usuario: "", teto_global_dia: "" });
  const [pol, setPol] = useState({ creditos_iniciais: "", tarifa_texto: "", tarifa_imagem: "", validade_meses: "12", formatos: ["feed_1x1"] as Formato[], teste: true, nota: "" });
  const [pessoa, setPessoa] = useState("");
  const [politicaEscolhida, setPoliticaEscolhida] = useState("");

  const agir = async (fazer: () => Promise<unknown>, ok: string) => {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await fazer();
      setAviso(ok);
      await qc.invalidateQueries({ queryKey: ["bolso"] });
    } catch (e) {
      setErro(erroDoBolso(e));
    } finally {
      setOcupado(false);
    }
  };

  if (visao.isPending) return <p role="status">Carregando o estúdio…</p>;
  if (visao.isError) return <p role="alert">{erroDoBolso(visao.error)} (A migration do Aceleriq de Bolso já foi aplicada?)</p>;
  const v = visao.data;
  const c = v.config;
  const numero = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t) : NaN);
  const politicasUsaveis = v.politicas.filter((p) => p.estado !== "arquivado");

  return (
    <section className="space-y-6" aria-label="Aceleriq de Bolso">
      <TituloMembros titulo="Aceleriq de Bolso" icone={<Megaphone size={20} className="text-primary" aria-hidden="true" />}>
        Estúdio de campanhas em autoatendimento. Tudo nasce desligado; nada é vendido nem gerado de verdade sem uma política aprovada e as chaves
        ligadas aqui.
      </TituloMembros>
      {erro && <p role="alert" className="text-[13px] text-destructive">{erro}</p>}
      {aviso && <p role="status" className="text-[13px]">{aviso}</p>}

      <dl className="bolso-numeros">
        <div><dt>Na fila</dt><dd>{v.fila}</dd></div>
        <div><dt>Acessos ativos</dt><dd>{v.direitos}</dd></div>
        <div><dt>Em conferência</dt><dd>{v.incertos.length}</dd></div>
        <div><dt>Eventos guardados</dt><dd>{v.eventos_pendentes}</dd></div>
      </dl>

      <div className="bolso-cartao space-y-3">
        <h3 className="text-[15px] font-semibold">Chaves</h3>
        <ul className="space-y-2">
          {CHAVES.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">
                <strong className="block text-[13px]">
                  {k.perigo && <ShieldAlert size={14} className="mr-1 inline text-destructive" aria-hidden="true" />}
                  {k.nome}
                </strong>
                <span className="text-[12px] text-muted-foreground">{k.dica}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={!!c[k.id]}
                aria-label={k.nome}
                className="membros-acao border border-border"
                disabled={ocupado}
                onClick={() => {
                  const ligar = !c[k.id];
                  if (k.perigo && ligar && !window.confirm(`Ligar "${k.nome}"? ${k.dica}`)) return;
                  void agir(() => salvarConfig({ [k.id]: ligar }), `${k.nome}: ${ligar ? "ligado" : "desligado"}.`);
                }}
              >
                {c[k.id] ? "Ligado" : "Desligado"}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <form
        className="bolso-cartao space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const l = { paralelo_por_usuario: numero(limites.paralelo_por_usuario), pedidos_por_dia_usuario: numero(limites.pedidos_por_dia_usuario), teto_global_dia: numero(limites.teto_global_dia) };
          if (Object.values(l).some((x) => !(x >= 1))) return setErro("Preencha os três limites com números inteiros a partir de 1.");
          void agir(() => salvarConfig({ limites: l }), "Limites salvos.");
        }}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold">Limites</h3>
          <AjudaRecolhida rotulo="Sobre os limites">Sem os três limites, nenhum pedido passa (nem em demonstração). O teto global vale para a carteira real.</AjudaRecolhida>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Atual: {c.limites ? `${c.limites.paralelo_por_usuario} em paralelo, ${c.limites.pedidos_por_dia_usuario} por dia por pessoa, ${c.limites.teto_global_dia} por dia no total` : "não configurados"}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["paralelo_por_usuario", "Em paralelo por pessoa"],
            ["pedidos_por_dia_usuario", "Pedidos por dia por pessoa"],
            ["teto_global_dia", "Teto do dia (todos)"],
          ] as const).map(([id, nome]) => (
            <label key={id} className="space-y-1 text-[13px]">
              <span className="block font-medium">{nome}</span>
              <input className="membros-campo" inputMode="numeric" value={limites[id]} onChange={(e) => setLimites((a) => ({ ...a, [id]: e.target.value }))} />
            </label>
          ))}
        </div>
        <button type="submit" className="membros-acao border border-border" disabled={ocupado}>Salvar limites</button>
      </form>

      <div className="bolso-cartao space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold">Política comercial</h3>
          <AjudaRecolhida rotulo="Sobre a política">
            Quantidade de créditos, tarifas, validade e formatos. Nasce como rascunho. Aprovar é decisão do dono e vira contrato: não muda mais
            (crie uma nova versão). Política de teste só vale para créditos de teste.
          </AjudaRecolhida>
        </div>
        {v.politicas.length ? (
          <ul className="bolso-lista">
            {v.politicas.map((p) => (
              <li key={p.id} className="bolso-extrato-linha">
                <span className="min-w-0 text-[13px]">
                  <strong>V{p.versao} · {p.estado}{p.teste ? " · TESTE" : ""}</strong>
                  <span className="block text-[12px] text-muted-foreground">
                    {p.dados.creditos_iniciais} créditos · texto {p.dados.tarifa_texto} · arte {p.dados.tarifa_imagem} · {p.dados.validade_meses} meses ·{" "}
                    {p.dados.formatos.map((f) => FORMATOS[f].nome).join(", ")}
                    {p.aprovado_em ? ` · aprovada em ${dataCurta(p.aprovado_em)}` : ""}
                    {p.nota ? ` · ${p.nota}` : ""}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {p.estado === "rascunho" && (
                    <button
                      type="button"
                      className="membros-acao border border-border"
                      disabled={ocupado}
                      onClick={() => {
                        if (!p.teste && !window.confirm("Aprovar esta política comercial? Ela vira contrato e não muda mais.")) return;
                        void agir(() => aprovarPolitica(p.id), `Política V${p.versao} aprovada.`);
                      }}
                    >
                      <Check size={14} aria-hidden="true" />
                      Aprovar
                    </button>
                  )}
                  {p.estado !== "arquivado" && (
                    <button type="button" className="membros-acao" disabled={ocupado} onClick={() => void agir(() => arquivarPolitica(p.id), `Política V${p.versao} arquivada.`)}>
                      Arquivar
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Nenhuma política ainda. Sem política aprovada, o estúdio não concede acesso real nem gera de verdade.</p>
        )}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const dados = { creditos_iniciais: numero(pol.creditos_iniciais), tarifa_texto: numero(pol.tarifa_texto), tarifa_imagem: numero(pol.tarifa_imagem), validade_meses: numero(pol.validade_meses), formatos: pol.formatos };
            if ([dados.creditos_iniciais, dados.tarifa_imagem, dados.validade_meses].some((x) => !(x >= 1)) || !(dados.tarifa_texto >= 0) || !dados.formatos.length)
              return setErro("Preencha créditos, tarifas e validade com números inteiros e escolha ao menos um formato.");
            void agir(() => criarPolitica(dados, pol.teste, pol.nota), "Rascunho criado.");
          }}
        >
          <p className="text-[13px] font-medium">Novo rascunho</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {([
              ["creditos_iniciais", "Créditos iniciais"],
              ["tarifa_texto", "Créditos por texto"],
              ["tarifa_imagem", "Créditos por arte"],
              ["validade_meses", "Validade (meses)"],
            ] as const).map(([id, nome]) => (
              <label key={id} className="space-y-1 text-[13px]">
                <span className="block">{nome}</span>
                <input className="membros-campo" inputMode="numeric" value={pol[id]} onChange={(e) => setPol((a) => ({ ...a, [id]: e.target.value }))} />
              </label>
            ))}
          </div>
          <fieldset className="flex flex-wrap gap-3 text-[13px]">
            <legend className="mb-1">Formatos</legend>
            {(Object.keys(FORMATOS) as Formato[]).map((f) => (
              <label key={f} className="flex items-center gap-1.5">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={pol.formatos.includes(f)} onChange={(e) => setPol((a) => ({ ...a, formatos: e.target.checked ? [...a.formatos, f] : a.formatos.filter((x) => x !== f) }))} />
                {FORMATOS[f].nome}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={pol.teste} onChange={(e) => setPol((a) => ({ ...a, teste: e.target.checked }))} />
            Política de TESTE (só créditos de demonstração)
          </label>
          <label className="block space-y-1 text-[13px]">
            <span>Nota</span>
            <input className="membros-campo" value={pol.nota} onChange={(e) => setPol((a) => ({ ...a, nota: e.target.value }))} maxLength={2000} />
          </label>
          <button type="submit" className="membros-acao border border-border" disabled={ocupado}>Criar rascunho</button>
        </form>
      </div>

      <form
        className="bolso-cartao space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const p = politicasUsaveis.find((x) => x.id === politicaEscolhida);
          if (!pessoa || !p) return setErro("Escolha a pessoa e a política.");
          const tipo = p.teste ? "teste" : "anual";
          const referencia = `${tipo}-${pessoa.slice(0, 8)}-${Date.now()}`;
          if (tipo === "anual" && !window.confirm("Conceder acesso real de validação manual? Os créditos da política entram na carteira real.")) return;
          void agir(() => concederAcesso(pessoa, tipo, p.id, referencia), tipo === "teste" ? "Créditos de teste concedidos." : "Acesso concedido.");
        }}
      >
        <h3 className="text-[15px] font-semibold">Conceder acesso</h3>
        <p className="text-[12px] text-muted-foreground">Política de teste: créditos de demonstração. Política aprovada: acesso real por validação manual (sem cobrança).</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[13px]">
            <span className="block">Pessoa</span>
            <select className="membros-campo" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
              <option value="">Escolha</option>
              {user && <option value={user.id}>Eu mesmo</option>}
              {pessoas.filter((x) => !user || x.id !== user.id).map((x) => (
                <option key={x.id} value={x.id}>{x.full_name || x.email}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[13px]">
            <span className="block">Política</span>
            <select className="membros-campo" value={politicaEscolhida} onChange={(e) => setPoliticaEscolhida(e.target.value)}>
              <option value="">Escolha</option>
              {politicasUsaveis.filter((p) => p.teste || p.estado === "aprovado").map((p) => (
                <option key={p.id} value={p.id}>V{p.versao}{p.teste ? " · TESTE" : " · aprovada"}</option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" className="membros-acao border border-border" disabled={ocupado}>Conceder</button>
      </form>

      <div className="bolso-cartao space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold">Fila e conferência</h3>
          <button type="button" className="membros-acao border border-border" disabled={ocupado} onClick={() => void agir(processarFila, "Fila processada.")}>
            {ocupado ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            Processar fila
          </button>
        </div>
        {v.incertos.length ? (
          <ul className="bolso-lista">
            {v.incertos.map((j) => (
              <li key={j.id} className="bolso-extrato-linha">
                <span className="min-w-0 text-[13px]">
                  <AlertTriangle size={14} className="mr-1 inline text-destructive" aria-hidden="true" />
                  {j.tipo} · {j.provedor} · {j.carteira} · {dataCurta(j.atualizado_em)}
                  <span className="block text-[12px] text-muted-foreground">{j.erro}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  <button type="button" className="membros-acao border border-border" disabled={ocupado} onClick={() => window.confirm("Confirmou no fornecedor que NÃO houve entrega? Os créditos voltam.") && void agir(() => reconciliar(j.id, "liberar"), "Créditos devolvidos.")}>
                    Não houve entrega
                  </button>
                  <button type="button" className="membros-acao" disabled={ocupado} onClick={() => void agir(() => reconciliar(j.id, "reenfileirar"), "Pedido de volta à fila.")}>
                    Tentar de novo
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Nenhum pedido aguardando conferência.</p>
        )}
      </div>
    </section>
  );
}
