import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";
import { diaLegivel, fraseDoErro, listarContasDaCasa, reais } from "@/lib/produto/api";
import {
  extrasDeEmailDoCliente,
  FORMAS,
  ROTULO_DA_ORIGEM,
  ROTULO_DO_PEDIDO,
  esperaPagamento,
  listarPedidos,
  marcarPago,
  mudarPedido,
  novoPedidoPelaCasa,
  proximoPasso,
  semLancamento,
  valorSugerido,
  type FormaDePagamento,
  type PedidoDeEmail,
  type TipoDoPedido,
} from "@/lib/produto/email-pedidos";
import {
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  JanelaCentral,
  MenuMais,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  lista,
  texto,
} from "@/components/sistema";
import { chaveDasContas } from "./ContasDaCasa";

export const chaveDasEntradas = ["produto", "casa", "email", "pedidos"] as const;

const COR: Record<PedidoDeEmail["estado"], string> = {
  novo: "bg-warning-soft text-warning",
  aguardando_pagamento: "bg-warning-soft text-warning",
  pago: "bg-accent-soft text-primary",
  em_andamento: "bg-accent-soft text-primary",
  concluido: "bg-muted text-muted-foreground",
  cancelado: "bg-muted text-muted-foreground",
};

const hoje = () => {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

/**
 * As entradas do e-mail profissional: cada pedido (da página, do painel do cliente, da casa ou do
 * agente) numa lista só. O dono escolhe a entrada, marca como pago e a migração começa: o e-mail da
 * empresa liga, o domínio nasce com o passo a passo e o cliente cai na área de E-mail do /app.
 */
export default function EntradasDeEmail({ aoAbrirDominio }: { aoAbrirDominio: (dominioId: string) => void }) {
  const qc = useQueryClient();
  const [verTodos, setVerTodos] = useState(false);
  const pedidos = useQuery({ queryKey: [...chaveDasEntradas, verTodos ? "todos" : "abertos"], queryFn: () => listarPedidos(verTodos ? null : "abertos") });
  const [pagando, setPagando] = useState<PedidoDeEmail | null>(null);
  const [nova, setNova] = useState(false);
  const reler = () => qc.invalidateQueries({ queryKey: ["produto", "casa", "email"] });

  const mudar = async (p: PedidoDeEmail, estado: "aguardando_pagamento" | "concluido" | "cancelado" | "reabrir") => {
    try {
      await mudarPedido(p.id, estado);
      await reler();
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };

  const lista_ = pedidos.data || [];
  const esperando = lista_.filter(esperaPagamento).length;
  return (
    <Secao
      titulo="Entradas"
      descricao={pedidos.data ? `${lista_.length}${esperando ? ` · ${esperando} esperando pagamento` : ""}` : undefined}
      ajuda="Cada pedido de e-mail profissional chega aqui, venha da página /email, do painel do cliente ou da Aceleriq. Uma entrada aberta por empresa: pedir de novo completa a mesma. Marcar como pago lança o dinheiro num lugar só (no extra do cliente, quando o pedido está ligado a um, ou no faturamento do produto), liga o e-mail da empresa e cria o domínio com o passo a passo."
      acao={
        <span className="flex items-center">
          <button type="button" className={botao.icone} onClick={() => setNova(true)} aria-label="Nova entrada" title="Nova entrada" data-nova-entrada="">
            <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
          </button>
          <MenuMais rotulo="Mais" itens={[{ rotulo: verTodos ? "Só as abertas" : "Ver também concluídas e canceladas", aoEscolher: () => setVerTodos((v) => !v) }]} />
        </span>
      }
    >
      {pedidos.isLoading ? (
        <Carregando linhas={3} rotulo="Carregando as entradas" />
      ) : pedidos.isError ? (
        <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void pedidos.refetch()}>Tentar de novo</button>} />
      ) : lista_.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhuma entrada aberta." descricao="Os pedidos da página /email aparecem aqui." />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} data-entradas-de-email="">
          {lista_.map((p) => (
            <li key={p.id} className={juntar(lista.linha, "flex-wrap items-start")} data-entrada={p.estado}>
              <span className="min-w-0 flex-1 basis-full sm:basis-0">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>
                  {p.empresa || "Empresa"}
                  {p.dominio ? <span className="font-normal text-muted-foreground"> · {p.dominio}</span> : null}
                </span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {[p.tipo === "migracao" ? "Migração" : "E-mail novo", `${p.caixas} ${p.caixas === 1 ? "caixa" : "caixas"}`, ROTULO_DA_ORIGEM[p.origem], diaLegivel(p.criado_em), p.extra_nome ? `extra: ${p.extra_nome}` : ""].filter(Boolean).join(" · ")}
                </span>
                <span className={juntar(texto.auxiliar, "block")}>{proximoPasso(p)}</span>
              </span>
              <span className={juntar(etiqueta, "mt-1.5 sm:ml-2 sm:mt-0", COR[p.estado])}>{ROTULO_DO_PEDIDO[p.estado]}</span>
              <span className="ml-2 mt-1.5 flex shrink-0 items-center sm:mt-0">
                {esperaPagamento(p) && (
                  <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => setPagando(p)} data-marcar-pago="">
                    <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Marcar como pago
                  </button>
                )}
                {!esperaPagamento(p) && p.dominio_id && p.estado !== "cancelado" && (
                  <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => aoAbrirDominio(p.dominio_id!)}>
                    Abrir a migração
                  </button>
                )}
                <MenuMais
                  rotulo={`Mais ações de ${p.empresa || "entrada"}`}
                  itens={[
                    p.estado === "novo" && { rotulo: "Aguardando pagamento", aoEscolher: () => void mudar(p, "aguardando_pagamento") },
                    (p.estado === "em_andamento" || p.estado === "pago") && { rotulo: "Concluir", aoEscolher: () => void mudar(p, "concluido") },
                    p.email_contato && { rotulo: `Copiar ${p.email_contato}`, aoEscolher: () => void navigator.clipboard.writeText(String(p.email_contato)).then(() => toast.success("E-mail copiado.")) },
                    (p.estado === "cancelado" || p.estado === "concluido") && { rotulo: "Reabrir", aoEscolher: () => void mudar(p, "reabrir") },
                    p.estado !== "cancelado" && p.estado !== "concluido" && { rotulo: "Cancelar a entrada", perigo: true, separadorAntes: true, aoEscolher: () => void mudar(p, "cancelado") },
                  ]}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {pagando && (
        <JanelaDoPagamento
          pedido={pagando}
          onFechar={() => setPagando(null)}
          onPago={(dominioId) => {
            setPagando(null);
            void reler();
            if (dominioId) aoAbrirDominio(dominioId);
          }}
        />
      )}
      {nova && <NovaEntrada onFechar={() => setNova(false)} onCriada={() => { setNova(false); void reler(); }} />}
    </Secao>
  );
}

function JanelaDoPagamento({ pedido, onFechar, onPago }: { pedido: PedidoDeEmail; onFechar: () => void; onPago: (dominioId: string | null) => void }) {
  const [forma, setForma] = useState<FormaDePagamento>("pix");
  const [valor, setValor] = useState(String(valorSugerido(pedido) || ""));
  const [dia, setDia] = useState(hoje());
  const [salvando, setSalvando] = useState(false);
  const peloExtra = !!pedido.extra_id;
  const salvar = async () => {
    const v = Number(String(valor).replace(",", "."));
    if (!semLancamento(forma) && !peloExtra && !(v > 0)) return void toast.error("Diga o valor pago.");
    setSalvando(true);
    try {
      const r = await marcarPago({ pedido_id: pedido.id, forma, valor: semLancamento(forma) ? null : v || null, pago_em: dia });
      toast.success(r.jaEstavaPago ? "Já estava pago." : r.pedido.dominio_id ? "Pago. O e-mail da empresa está ligado e a migração começou." : "Pago. Falta o domínio para começar a migração.");
      onPago(r.pedido.dominio_id);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível marcar o pagamento."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="sm"
      titulo="Marcar como pago"
      ajuda={peloExtra ? "Este pedido está ligado ao extra do cliente: a cobrança aberta mais antiga do extra fica paga, e nada é lançado de novo no produto. Se a parcela já está paga no Financeiro, escolha Já está no Financeiro." : "O pagamento entra no faturamento do produto (e no Financeiro) uma vez. Cortesia e Já está no Financeiro não lançam valor."}
      rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-confirmar-pago="">{salvando ? "Salvando..." : "Marcar como pago"}</button>}
    >
      <p className={juntar(texto.corpo, "mb-3")}>
        {pedido.empresa}
        {pedido.dominio ? ` · ${pedido.dominio}` : ""} · {pedido.tipo === "migracao" ? `migração ${reais(pedido.valor_migracao)}` : `${reais(pedido.valor_mensal)} por mês`}
      </p>
      <GrupoDeCampos colunas={1}>
        <CampoDeFormulario rotulo="Como pagou">
          <SeletorCompacto rotulo="Forma de pagamento" opcoes={(peloExtra ? FORMAS.filter((f) => f.valor !== "cortesia") : FORMAS).map((f) => ({ valor: f.valor, rotulo: f.rotulo }))} valor={forma} onEscolher={(v) => setForma(v as FormaDePagamento)} listaQuandoNaoCabe />
        </CampoDeFormulario>
        {!semLancamento(forma) && (
          <CampoDeFormulario rotulo="Valor pago" apoio={peloExtra ? "Vazio usa o valor da cobrança do extra" : undefined}>
            <input value={valor} onChange={(e) => setValor(e.target.value)} className={campo} inputMode="decimal" data-campo="valor-pago" />
          </CampoDeFormulario>
        )}
        <CampoDeFormulario rotulo="Dia do pagamento">
          <input type="date" value={dia} max={hoje()} onChange={(e) => setDia(e.target.value)} className={campo} />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}

function NovaEntrada({ onFechar, onCriada }: { onFechar: () => void; onCriada: () => void }) {
  const contas = useQuery({ queryKey: chaveDasContas, queryFn: listarContasDaCasa });
  const [f, setF] = useState({ conta_id: "", dominio: "", caixas: "5", tipo: "migracao" as TipoDoPedido, observacao: "", extra_id: "" });
  const [salvando, setSalvando] = useState(false);
  const lista_ = contas.data || [];
  const conta = f.conta_id || (lista_[0] ? lista_[0].id : "");
  const clienteDoPainel = (lista_.filter((c) => c.id === conta)[0] || { client_id: null }).client_id;
  // Cliente da Aceleriq com extra de e-mail na ficha: o dinheiro mora lá, e a entrada aponta para ele.
  const extras = useQuery({ queryKey: ["produto", "casa", "email", "extras", clienteDoPainel], queryFn: () => extrasDeEmailDoCliente(String(clienteDoPainel)), enabled: !!clienteDoPainel });
  const salvar = async () => {
    if (!conta) return void toast.error("Escolha a empresa.");
    setSalvando(true);
    try {
      const r = await novoPedidoPelaCasa({ conta_id: conta, dominio: f.dominio.trim().toLowerCase(), caixas: Math.max(1, Math.floor(Number(f.caixas) || 1)), tipo: f.tipo, observacao: f.observacao.trim(), extra_id: f.extra_id || null });
      toast.success(r.novo ? "Entrada criada." : "A empresa já tinha uma entrada aberta: completei a mesma.");
      onCriada();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível criar a entrada."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="md"
      titulo="Nova entrada"
      ajuda="Para um cliente que pediu por fora (WhatsApp, reunião). A empresa precisa existir em Empresas; empresa nova, crie lá primeiro."
      rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || !conta}>{salvando ? "Salvando..." : "Criar"}</button>}
    >
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Empresa" obrigatorio largo>
          <select value={conta} onChange={(e) => setF({ ...f, conta_id: e.target.value })} className={campo}>
            {lista_.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="O que é">
          <SeletorCompacto rotulo="Tipo" opcoes={[{ valor: "migracao", rotulo: "Migração" }, { valor: "novo", rotulo: "E-mail novo" }]} valor={f.tipo} onEscolher={(v) => setF({ ...f, tipo: v as TipoDoPedido })} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Caixas">
          <input value={f.caixas} onChange={(e) => setF({ ...f, caixas: e.target.value })} className={campo} inputMode="numeric" maxLength={3} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Domínio" largo>
          <input value={f.dominio} onChange={(e) => setF({ ...f, dominio: e.target.value })} className={campo} placeholder="suaempresa.com.br" autoCapitalize="none" />
        </CampoDeFormulario>
        {clienteDoPainel && (extras.data || []).length > 0 && (
          <CampoDeFormulario rotulo="Onde cobrar" largo apoio="Ligado ao extra, o pagamento quita a cobrança do extra e não é lançado de novo no produto">
            <select value={f.extra_id} onChange={(e) => setF({ ...f, extra_id: e.target.value })} className={campo} data-campo="extra">
              <option value="">No faturamento do produto</option>
              {(extras.data || []).map((x) => <option key={x.id} value={x.id}>No extra da ficha: {x.nome} ({reais(x.valor)})</option>)}
            </select>
          </CampoDeFormulario>
        )}
        <CampoDeFormulario rotulo="Anotações" largo>
          <textarea value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} className={campoTexto} maxLength={1500} placeholder="Provedor de hoje, quem usa, o que foi combinado" />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
