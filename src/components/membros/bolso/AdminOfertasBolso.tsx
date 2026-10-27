import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Coins, Plus, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  arquivarOferta,
  erroDoBolso,
  lerOfertasAdmin,
  publicarOferta,
  salvarOferta,
  type OfertaAdminBolso,
  type VisaoAdmin,
} from "@/lib/bolso/api";
import { centavosDoCampo, reais } from "@/lib/bolso/recargas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const VAZIO = {
  codigo: "",
  nome: "",
  descricao: "",
  preco: "",
  creditos: "",
  validade: "365",
  provisao: "",
  politica: "",
};
export default function AdminOfertasBolso({
  politicas,
}: {
  politicas: VisaoAdmin["politicas"];
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: ["bolso", "ofertas-admin", user?.id],
    queryFn: lerOfertasAdmin,
    retry: false,
    enabled: !!user,
  });
  const [form, setForm] = useState(VAZIO);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<{
    oferta: OfertaAdminBolso;
    acao: "publicar" | "arquivar";
  } | null>(null);
  const trava = useRef(false);
  const reaisAprovadas = politicas.filter(
    (p) => !p.teste && p.estado === "aprovado",
  );
  const preco = centavosDoCampo(form.preco);
  const provisao = centavosDoCampo(form.provisao);
  const valido =
    form.nome.trim() &&
    form.codigo.length >= 3 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.codigo) &&
    preco !== null &&
    preco > 0 &&
    provisao !== null &&
    provisao > 0 &&
    provisao < preco &&
    /^\d+$/.test(form.creditos) &&
    Number(form.creditos) > 0 &&
    /^\d+$/.test(form.validade) &&
    Number(form.validade) > 0 &&
    Number(form.validade) <= 730 &&
    reaisAprovadas.some((p) => p.id === form.politica);
  const campo = (id: keyof typeof VAZIO, valor: string) =>
    setForm((a) => ({ ...a, [id]: valor }));
  const agir = async (fn: () => Promise<unknown>, mensagem: string) => {
    if (trava.current) return false;
    trava.current = true;
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["bolso"] });
      setAviso(mensagem);
      return true;
    } catch (e) {
      setErro(erroDoBolso(e));
      return false;
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  };
  return (
    <section
      className="bolso-admin-ofertas space-y-5"
      aria-labelledby="admin-ofertas-titulo"
    >
      <div className="bolso-cabecalho-secao">
        <div>
          <span className="bolso-sobrelinha">Créditos avulsos</span>
          <h3 id="admin-ofertas-titulo">Ofertas de recarga</h3>
        </div>
        <button
          type="button"
          className="membros-acao"
          onClick={() => {
            setAberto(!aberto);
            setErro("");
          }}
        >
          <Plus size={16} aria-hidden="true" /> Nova oferta
        </button>
      </div>
      <div className="bolso-admin-financeiro">
        <Wallet size={22} aria-hidden="true" />
        <p>
          <strong>Uma carteira para cada pessoa.</strong> Cada cliente usa apenas
          o próprio saldo do Bolso. O custo do OpenRouter fica na operação da
          Aceleriq, registrado separadamente do Mesa Ads.
        </p>
        <span className="bolso-etiqueta">Pagamentos desligados</span>
      </div>
      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="text-sm">
          {aviso}
        </p>
      )}
      {aberto && (
        <form
          className="bolso-cartao space-y-5"
          aria-label="Criar oferta de recarga"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!valido || preco === null || provisao === null) {
              setErro(
                "Confira os campos. A provisão para IA deve ser maior que zero e menor que o preço.",
              );
              return;
            }
            if (
              await agir(
                () =>
                  salvarOferta({
                    codigo: form.codigo,
                    nome: form.nome.trim(),
                    descricao: form.descricao.trim(),
                    preco_centavos: preco,
                    provisao_ia_centavos: provisao,
                    creditos: Number(form.creditos),
                    validade_dias: Number(form.validade),
                    politica_id: form.politica,
                  }),
                "Rascunho salvo. Revise antes de publicar.",
              )
            ) {
              setForm(VAZIO);
              setAberto(false);
            }
          }}
        >
          <div className="bolso-oferta-formulario">
            <label>
              Nome do pacote
              <input
                className="membros-campo"
                maxLength={80}
                required
                value={form.nome}
                onChange={(e) => campo("nome", e.target.value)}
              />
            </label>
            <label>
              Código da oferta
              <input
                className="membros-campo"
                maxLength={64}
                placeholder="recarga-essencial"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={form.codigo}
                onChange={(e) => campo("codigo", e.target.value)}
              />
            </label>
            <label>
              Preço em reais
              <input
                className="membros-campo"
                inputMode="decimal"
                placeholder="0,00"
                required
                value={form.preco}
                onChange={(e) => campo("preco", e.target.value)}
              />
            </label>
            <label>
              Quantidade de créditos
              <input
                className="membros-campo"
                inputMode="numeric"
                required
                value={form.creditos}
                onChange={(e) => campo("creditos", e.target.value)}
              />
            </label>
            <label>
              Provisão para IA em reais
              <input
                className="membros-campo"
                inputMode="decimal"
                placeholder="0,00"
                required
                value={form.provisao}
                onChange={(e) => campo("provisao", e.target.value)}
              />
            </label>
            <label>
              Validade em dias
              <input
                className="membros-campo"
                inputMode="numeric"
                required
                value={form.validade}
                onChange={(e) => campo("validade", e.target.value)}
              />
            </label>
            <label>
              Política do acesso
              <select
                className="membros-campo"
                required
                value={form.politica}
                onChange={(e) => campo("politica", e.target.value)}
              >
                <option value="">Selecione</option>
                {reaisAprovadas.map((p) => (
                  <option key={p.id} value={p.id}>
                    V{p.versao}: texto {p.dados.tarifa_texto} / imagem{" "}
                    {p.dados.tarifa_imagem} créditos
                  </option>
                ))}
              </select>
            </label>
            <label>
              Descrição curta
              <input
                className="membros-campo"
                maxLength={240}
                value={form.descricao}
                onChange={(e) => campo("descricao", e.target.value)}
              />
            </label>
          </div>
          {preco !== null &&
            preco > 0 &&
            provisao !== null &&
            provisao >= 0 &&
            provisao < preco && (
              <div className="bolso-provisao-resumo">
                <span>
                  Venda <strong>{reais(preco)}</strong>
                </span>
                <span>
                  Provisão para IA <strong>{reais(provisao)}</strong>
                </span>
                <span>
                  Restante antes de taxas{" "}
                  <strong>{reais(preco - provisao)}</strong>
                </span>
              </div>
            )}
          <p className="bolso-nota">
            A provisão é um planejamento do orçamento. Não transfere dinheiro ao
            OpenRouter. O restante ainda cobre taxas, impostos e operação.
          </p>
          <button
            className="membros-acao bg-primary text-primary-foreground"
            type="submit"
            disabled={ocupado || !valido}
          >
            {ocupado ? "Salvando…" : "Salvar rascunho"}
          </button>
        </form>
      )}
      {consulta.isPending ? (
        <p role="status">Carregando ofertas…</p>
      ) : consulta.isError ? (
        <div role="alert" className="bolso-cartao">
          <p>Não foi possível carregar as ofertas.</p>
          <button
            className="membros-acao"
            type="button"
            onClick={() => void consulta.refetch()}
          >
            Tentar novamente
          </button>
        </div>
      ) : !consulta.data?.length ? (
        <div className="bolso-recargas-vazio">
          <Coins size={28} aria-hidden="true" />
          <div>
            <h4>Monte seus pacotes de créditos</h4>
            <p>
              Salve a proposta como rascunho e publique quando os valores
              estiverem aprovados.
            </p>
          </div>
        </div>
      ) : (
        <div className="bolso-ofertas-grade">
          {consulta.data.map((o) => (
            <article key={o.id} className="bolso-oferta">
              <div className="bolso-cabecalho-secao">
                <span className="bolso-sobrelinha">{o.nome}</span>
                <span className="bolso-etiqueta">
                  {o.estado === "publicado"
                    ? "Publicada"
                    : o.estado === "arquivado"
                      ? "Arquivada"
                      : "Rascunho"}
                </span>
              </div>
              <h4>
                {o.creditos}
                <small> créditos</small>
              </h4>
              <p className="bolso-oferta-preco">
                {reais(o.preco_centavos)}
                <span>
                  V{o.versao} · {o.validade_dias} dias
                </span>
              </p>
              <dl className="bolso-oferta-conta">
                <div>
                  <dt>Provisão para IA</dt>
                  <dd>{reais(o.provisao_ia_centavos)}</dd>
                </div>
                <div>
                  <dt>Antes de taxas</dt>
                  <dd>{reais(o.preco_centavos - o.provisao_ia_centavos)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {o.estado === "rascunho" && (
                  <button
                    className="membros-acao"
                    type="button"
                    disabled={ocupado}
                    onClick={() =>
                      setConfirmar({ oferta: o, acao: "publicar" })
                    }
                  >
                    Publicar oferta{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                )}
                {o.estado !== "arquivado" && (
                  <button
                    className="membros-acao"
                    type="button"
                    disabled={ocupado}
                    onClick={() =>
                      setConfirmar({ oferta: o, acao: "arquivar" })
                    }
                  >
                    Arquivar
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <AlertDialog
        open={!!confirmar}
        onOpenChange={(open) => {
          if (!open && !ocupado) setConfirmar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar?.acao === "publicar"
                ? "Publicar esta oferta?"
                : "Arquivar esta oferta?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar &&
                `${confirmar.oferta.nome}: ${confirmar.oferta.creditos} créditos por ${reais(confirmar.oferta.preco_centavos)}. ${confirmar.acao === "publicar" ? "A oferta ficará visível aos membros com a política correspondente. Os pagamentos continuam desligados." : "A oferta deixará de aparecer para os membros. Créditos já concedidos são preservados."}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={ocupado}
              onClick={async (e) => {
                e.preventDefault();
                if (!confirmar) return;
                if (
                  await agir(
                    () =>
                      confirmar.acao === "publicar"
                        ? publicarOferta(confirmar.oferta.id)
                        : arquivarOferta(confirmar.oferta.id),
                    confirmar.acao === "publicar"
                      ? "Oferta publicada. Pagamentos continuam desligados."
                      : "Oferta arquivada.",
                  )
                )
                  setConfirmar(null);
              }}
            >
              {ocupado ? "Salvando…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
