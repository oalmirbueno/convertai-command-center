import { useEffect, useRef, useState } from "react";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Administração do Aceleriq de Bolso (26/10/2026). Tudo nasce desligado. As chaves e a política comercial
 * são decisões do dono: aprovar a política a transforma em contrato (não muda mais; uma nova versão
 * substitui). Créditos de teste usam carteira separada e nunca valem para o acesso real.
 */

type Pessoa = { id: string; full_name: string; email: string };
type Politica = VisaoAdmin["politicas"][number];
type Confirmacao = { titulo: string; descricao: string; botao: string; executar: () => Promise<void> };

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
  const [erroNoAcesso, setErroNoAcesso] = useState(false);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const executando = useRef(false);
  const intencao = useRef<{ chave: string; referencia: string } | null>(null);
  const limitesIniciados = useRef(false);

  useEffect(() => {
    const atuais = visao.data?.config.limites;
    if (!atuais || limitesIniciados.current) return;
    limitesIniciados.current = true;
    setLimites({ paralelo_por_usuario: String(atuais.paralelo_por_usuario), pedidos_por_dia_usuario: String(atuais.pedidos_por_dia_usuario), teto_global_dia: String(atuais.teto_global_dia) });
  }, [visao.data?.config.limites]);

  const agir = async (fazer: () => Promise<unknown>, ok: string, noAcesso = false) => {
    if (executando.current) return false;
    executando.current = true;
    setOcupado(true);
    setErro(null);
    setErroNoAcesso(noAcesso);
    setAviso(null);
    try {
      await fazer();
      await qc.invalidateQueries({ queryKey: ["bolso"] });
      setAviso(ok);
      return true;
    } catch (e) {
      const mensagem = erroDoBolso(e);
      setErro(mensagem === "Esta referência já foi usada." || mensagem === "Esta referência já foi usada"
        ? "Este pedido já foi registrado. Confira o acesso da pessoa antes de fazer uma nova concessão."
        : mensagem);
      return false;
    } finally {
      executando.current = false;
      setOcupado(false);
    }
  };

  const confirmarPolitica = (p: Politica) => setConfirmacao({
    titulo: `Aprovar política V${p.versao}?`,
    descricao: `${p.dados.creditos_iniciais} créditos ${p.teste ? "de demonstração" : "reais"}, ${p.dados.validade_meses} meses de acesso e ${p.dados.formatos.map((f) => FORMATOS[f].nome).join(", ")}. Depois de aprovada, esta versão não pode ser editada. A aprovação não concede acessos nem ativa pagamentos.`,
    botao: "Aprovar política",
    executar: async () => {
      if (await agir(() => aprovarPolitica(p.id), `Política V${p.versao} aprovada.`)) setPoliticaEscolhida(p.id);
    },
  });

  if (visao.isPending) return <p role="status">Carregando o estúdio…</p>;
  if (visao.isError) return <div role="alert"><p>{erroDoBolso(visao.error)}</p><button type="button" className="membros-acao" onClick={() => void visao.refetch()}>Tentar novamente</button></div>;
  const v = visao.data;
  const c = v.config;
  const numero = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t) : NaN);
  const politicasUsaveis = v.politicas.filter((p) => p.estado !== "arquivado" && (p.teste || p.estado === "aprovado"));
  const politicaSelecionada = politicasUsaveis.find((p) => p.id === politicaEscolhida);
  const pessoaSelecionada = pessoa === user?.id
    ? { nome: "Minha conta", email: user.email ?? "" }
    : pessoas.find((p) => p.id === pessoa);
  const nomeSelecionado = pessoaSelecionada && ("nome" in pessoaSelecionada ? pessoaSelecionada.nome : pessoaSelecionada.full_name || pessoaSelecionada.email);
  const podeConceder = !!pessoaSelecionada && !!politicaSelecionada && !ocupado;

  return (
    <section className="space-y-6" aria-label="Aceleriq de Bolso">
      <TituloMembros titulo="Aceleriq de Bolso" icone={<Megaphone size={20} className="text-primary" aria-hidden="true" />}>
        Estúdio de campanhas em autoatendimento. Tudo nasce desligado; nada é vendido nem gerado de verdade sem uma política aprovada e as chaves
        ligadas aqui.
      </TituloMembros>
      {erro && !erroNoAcesso && <p role="alert" className="text-[13px] text-destructive">{erro}</p>}
      {aviso && <p role="status" className="text-[13px]">{aviso}</p>}

      <dl className="bolso-numeros">
        <div><dt>Na fila</dt><dd>{v.fila}</dd></div>
        <div><dt>Acessos ativos</dt><dd>{v.direitos}</dd></div>
        <div><dt>Em conferência</dt><dd>{v.incertos.length}</dd></div>
        <div><dt>Eventos guardados</dt><dd>{v.eventos_pendentes}</dd></div>
      </dl>

      <form
        className="bolso-cartao bolso-conceder space-y-4"
        aria-label="Conceder acesso ao Bolso"
        onSubmit={(e) => {
          e.preventDefault();
          const p = politicaSelecionada;
          if (executando.current || !podeConceder || !p || !pessoaSelecionada) return;
          const tipo = p.teste ? "teste" : "anual";
          const chave = `${tipo}:${pessoa}:${p.id}`;
          if (intencao.current?.chave !== chave) intencao.current = { chave, referencia: `manual-${crypto.randomUUID()}` };
          const referencia = intencao.current.referencia;
          setConfirmacao({
            titulo: "Confirmar concessão de acesso",
            descricao: `${nomeSelecionado}${pessoaSelecionada.email ? ` (${pessoaSelecionada.email})` : ""} receberá ${p.dados.creditos_iniciais} créditos ${p.teste ? "de demonstração" : "reais"} pela política V${p.versao}, com validade de ${p.dados.validade_meses} meses. Esta concessão é manual e não faz nenhuma cobrança.`,
            botao: "Confirmar acesso",
            executar: async () => {
              if (await agir(() => concederAcesso(pessoa, tipo, p.id, referencia), `Acesso ${p.teste ? "de demonstração " : ""}concedido a ${nomeSelecionado}.`, true)) {
                intencao.current = null;
                setPessoa("");
                setPoliticaEscolhida("");
              }
            },
          });
        }}
      >
        <h3 className="text-[15px] font-semibold">Conceder acesso</h3>
        <p className="text-[13px] text-muted-foreground">Escolha quem vai receber o acesso. A liberação é manual, sem cobrança.</p>
        {!politicasUsaveis.length && <div className="bolso-acesso-orientacao" role="status">
          <p>Aprove uma política para liberar o acesso real.</p>
          {v.politicas.filter((p) => !p.teste && p.estado === "rascunho").map((p) => <button key={p.id} type="button" className="membros-acao" disabled={ocupado} onClick={() => confirmarPolitica(p)}>Revisar política V{p.versao}</button>)}
          {!v.politicas.some((p) => p.estado === "rascunho") && <p>Crie a política na seção de políticas abaixo para continuar.</p>}
        </div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[13px]">
            <span className="block">Pessoa</span>
            <select className="membros-campo" value={pessoa} disabled={ocupado} onChange={(e) => { setPessoa(e.target.value); setErro(null); }}>
              <option value="">Escolha</option>
              {user && <option value={user.id}>Minha conta{user.email ? ` · ${user.email}` : ""}</option>}
              {pessoas.filter((x) => !user || x.id !== user.id).map((x) => (
                <option key={x.id} value={x.id}>{x.full_name || x.email}{x.full_name && x.email ? ` · ${x.email}` : ""}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[13px]">
            <span className="block">Política</span>
            <select className="membros-campo" value={politicaEscolhida} disabled={ocupado || !politicasUsaveis.length} onChange={(e) => { setPoliticaEscolhida(e.target.value); setErro(null); }}>
              <option value="">{politicasUsaveis.length ? "Escolha" : "Aprovação pendente"}</option>
              {politicasUsaveis.map((p) => (
                <option key={p.id} value={p.id}>V{p.versao} · {p.teste ? "demonstração" : "acesso real"} · {p.dados.creditos_iniciais} créditos</option>
              ))}
            </select>
          </label>
        </div>
        {politicaSelecionada && <p className="bolso-acesso-resumo text-[13px]">{politicaSelecionada.dados.creditos_iniciais} créditos {politicaSelecionada.teste ? "de demonstração" : "reais"} · {politicaSelecionada.dados.validade_meses} meses · sem cobrança</p>}
        {erro && erroNoAcesso && <p role="alert" className="text-[13px] text-destructive">{erro}</p>}
        <div className="bolso-acesso-acoes flex flex-wrap items-center gap-2">
        {user && <button type="button" className="membros-acao" disabled={ocupado} onClick={() => { setPessoa(user.id); setErro(null); }}>Usar minha conta</button>}
        <button type="submit" className="membros-acao bg-primary text-primary-foreground" disabled={!podeConceder}>{ocupado && erroNoAcesso ? "Concedendo…" : "Conceder acesso"}</button>
        </div>
      </form>

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
                  if (k.perigo && ligar) {
                    setConfirmacao({ titulo: `Ativar ${k.nome.toLowerCase()}?`, descricao: k.dica, botao: "Confirmar ativação", executar: async () => { await agir(() => salvarConfig({ [k.id]: true }), `${k.nome}: ligado.`); } });
                    return;
                  }
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
                      onClick={() => confirmarPolitica(p)}
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
                  <button type="button" className="membros-acao border border-border" disabled={ocupado} onClick={() => setConfirmacao({ titulo: "Devolver os créditos?", descricao: "Confirme no fornecedor que não houve entrega antes de devolver os créditos deste pedido.", botao: "Confirmar devolução", executar: async () => { await agir(() => reconciliar(j.id, "liberar"), "Créditos devolvidos."); } })}>
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
      <AlertDialog open={!!confirmacao} onOpenChange={(aberto) => { if (!aberto && !ocupado) setConfirmacao(null); }}>
        <AlertDialogContent className="membros-admin-confirmacao">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmacao?.titulo}</AlertDialogTitle>
            <AlertDialogDescription>{confirmacao?.descricao}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={ocupado} onClick={(e) => {
              e.preventDefault();
              if (!confirmacao || executando.current) return;
              const acao = confirmacao;
              setConfirmacao(null);
              void acao.executar();
            }}>{confirmacao?.botao ?? "Confirmar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
