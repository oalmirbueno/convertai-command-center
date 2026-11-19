import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { fraseDoErro, lerOfertasDaCasa, reais, salvarOferta, type OfertaDaCasa } from "@/lib/produto/api";
import { CampoDeFormulario, Carregando, EstadoDeErro, GrupoDeCampos, JanelaCentral, Secao, botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema";

const numeroDe = (v: string) => {
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const paraCampo = (n: number) => String(n).replace(".", ",");
const ONDE: Record<OfertaDaCasa["mostra_em"], string> = { ambos: "No e-mail novo e na migração", novo: "Só no e-mail novo", migracao: "Só na migração" };

/**
 * As ofertas do pedido de e-mail (order bumps): o que aparece marcado ou não no último passo de
 * /email/pedir. Mudar o preço vale para os próximos pedidos; quem já pediu fica com o preço que viu.
 */
export default function OfertasDoPedido() {
  const qc = useQueryClient();
  const ofertas = useQuery({ queryKey: ["produto", "ofertas", "casa"], queryFn: lerOfertasDaCasa });
  const [editando, setEditando] = useState<OfertaDaCasa | "nova" | null>(null);

  return (
    <Secao
      titulo="Ofertas no pedido"
      descricao={ofertas.data ? `${ofertas.data.filter((o) => o.ativo).length} à venda` : undefined}
      ajuda="Aparecem no último passo do pedido de e-mail, como caixinhas. As mensais entram no 1º pagamento e na mensalidade; as de uma vez, só no 1º pagamento."
      acao={
        <button type="button" className={botao.icone} onClick={() => setEditando("nova")} aria-label="Nova oferta" title="Nova oferta" data-nova-oferta="">
          <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
        </button>
      }
    >
      {ofertas.isLoading ? (
        <Carregando linhas={3} rotulo="Carregando as ofertas" />
      ) : ofertas.isError ? (
        <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void ofertas.refetch()}>Tentar de novo</button>} />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} data-ofertas-da-casa="">
          {(ofertas.data || []).map((o) => (
            <li key={o.id} className={lista.linha}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>{o.nome}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {ONDE[o.mostra_em]}
                  {o.marcada ? " · já vem marcada" : ""}
                </span>
              </span>
              {!o.ativo && <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Fora de venda</span>}
              <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>
                {reais(o.valor)} {o.cobranca === "mensal" ? "por mês" : "uma vez"}
              </span>
              <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setEditando(o)} aria-label={`Editar a oferta ${o.nome}`} title="Editar">
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editando && (
        <EditorDeOferta
          oferta={editando === "nova" ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            void qc.invalidateQueries({ queryKey: ["produto", "ofertas"] });
            setEditando(null);
          }}
        />
      )}
    </Secao>
  );
}

function EditorDeOferta({ oferta, onFechar, onSalvo }: { oferta: OfertaDaCasa | null; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({
    id: oferta ? oferta.id : "",
    nome: oferta ? oferta.nome : "",
    descricao: oferta ? oferta.descricao : "",
    valor: oferta ? paraCampo(oferta.valor) : "",
    cobranca: oferta ? oferta.cobranca : ("mensal" as OfertaDaCasa["cobranca"]),
    mostra_em: oferta ? oferta.mostra_em : ("ambos" as OfertaDaCasa["mostra_em"]),
    marcada: oferta ? oferta.marcada : false,
    ativo: oferta ? oferta.ativo : true,
    ordem: oferta ? String(oferta.ordem) : "50",
  });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const id = (oferta ? oferta.id : f.id.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")).slice(0, 40);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(id)) return void toast.error("Dê um código curto à oferta, começando com letra.");
    if (f.nome.trim().length < 2) return void toast.error("Dê um nome à oferta.");
    const valor = numeroDe(f.valor);
    if (!(valor > 0)) return void toast.error("Diga o valor da oferta.");
    setSalvando(true);
    try {
      await salvarOferta({ id, nome: f.nome.trim(), descricao: f.descricao.trim(), valor, cobranca: f.cobranca, mostra_em: f.mostra_em, marcada: f.marcada, ativo: f.ativo, ordem: Math.floor(Number(f.ordem) || 0) });
      toast.success("Oferta salva.");
      onSalvo();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar a oferta."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="md"
      titulo={oferta ? `Oferta ${oferta.nome}` : "Nova oferta"}
      ajuda="Mudar o preço vale para os próximos pedidos. Quem já pediu fica com o preço que viu."
      rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-oferta="">{salvando ? "Salvando..." : "Salvar"}</button>}
    >
      <GrupoDeCampos>
        {!oferta && (
          <CampoDeFormulario rotulo="Código" apoio="Não muda depois. Ex.: dominio_gerenciado">
            <input value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} className={campo} maxLength={40} autoCapitalize="none" />
          </CampoDeFormulario>
        )}
        <CampoDeFormulario rotulo="Nome" obrigatorio>
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={campo} maxLength={60} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Valor (R$)" obrigatorio>
          <input value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} className={campo} inputMode="decimal" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Cobrança">
          <select value={f.cobranca} onChange={(e) => setF({ ...f, cobranca: e.target.value === "unica" ? "unica" : "mensal" })} className={campo}>
            <option value="mensal">Todo mês</option>
            <option value="unica">Uma vez</option>
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Onde aparece">
          <select value={f.mostra_em} onChange={(e) => setF({ ...f, mostra_em: e.target.value === "novo" || e.target.value === "migracao" ? e.target.value : "ambos" })} className={campo}>
            <option value="ambos">No e-mail novo e na migração</option>
            <option value="novo">Só no e-mail novo</option>
            <option value="migracao">Só na migração</option>
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Frase que explica" largo>
          <input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} className={campo} maxLength={240} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Ordem na lista">
          <input value={f.ordem} onChange={(e) => setF({ ...f, ordem: e.target.value })} className={campo} inputMode="numeric" />
        </CampoDeFormulario>
        <div className="min-w-0 space-y-2 sm:col-span-2">
          <label className={juntar(texto.corpo, "flex min-w-0 items-center")}>
            <input type="checkbox" className="mr-2" checked={f.marcada} onChange={(e) => setF({ ...f, marcada: e.target.checked })} />
            Já vem marcada no pedido
          </label>
          <label className={juntar(texto.corpo, "flex min-w-0 items-center")}>
            <input type="checkbox" className="mr-2" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
            À venda
          </label>
        </div>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
