import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { fraseDoErro, type EstadoDoProduto } from "@/lib/produto/api";
import { apagarCampo, chaveDosCampos, ligarCamposDoRamo, listarCampos, opcoesDoTexto, salvarCampo, type CampoDaEmpresa } from "@/lib/produto/campos";
import { ROTULO_DO_TIPO_DE_CAMPO, nichoPorId, type TipoDeCampo } from "@/lib/produto/nichos";
import { CampoDeFormulario, Carregando, EstadoVazio, GrupoDeCampos, JanelaCentral, Secao, botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema";

const TIPOS = Object.keys(ROTULO_DO_TIPO_DE_CAMPO) as TipoDeCampo[];

/**
 * Configurações, Campos: o que a empresa pede em cada negócio além do básico.
 * O ramo traz uma lista pronta que entra com um clique; o gestor cria os
 * próprios, escolhe o tipo, agrupa e decide o que aparece no cartão do funil.
 */
export default function CamposDaConta({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const qc = useQueryClient();
  const campos = useQuery({ queryKey: chaveDosCampos(conta.id), queryFn: listarCampos });
  const nicho = nichoPorId(conta.perfil.nicho);
  const sugeridos = nicho && nicho.campos ? nicho.campos : [];
  const existentes = campos.data || [];
  const faltam = sugeridos.filter((s) => !existentes.some((e) => e.chave === s.chave));
  const [editando, setEditando] = useState<Partial<CampoDaEmpresa> | null>(null);
  const [opcoes, setOpcoes] = useState("");
  const [apagando, setApagando] = useState<CampoDaEmpresa | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const reler = () => qc.invalidateQueries({ queryKey: chaveDosCampos(conta.id) });

  const abrir = (c: Partial<CampoDaEmpresa> | null) => {
    setEditando(c || { rotulo: "", tipo: "texto", grupo: "", no_cartao: false, obrigatorio: false, ativo: true });
    setOpcoes(c && c.opcoes ? c.opcoes.join("\n") : "");
  };

  const ligarDoRamo = async () => {
    setOcupado(true);
    try {
      const n = await ligarCamposDoRamo(sugeridos, existentes);
      await reler();
      toast.success(`${n} ${n === 1 ? "campo ligado" : "campos ligados"}. Eles já aparecem na ficha do negócio.`);
    } catch (e) {
      toast.error(fraseDoErro(e));
    } finally {
      setOcupado(false);
    }
  };

  const salvar = async () => {
    if (!editando || !editando.rotulo || editando.rotulo.trim().length < 2) return;
    setOcupado(true);
    try {
      await salvarCampo({ ...editando, rotulo: editando.rotulo, tipo: (editando.tipo || "texto") as TipoDeCampo, opcoes: opcoesDoTexto(opcoes) }, existentes);
      await reler();
      setEditando(null);
      toast.success("Campo salvo.");
    } catch (e) {
      toast.error(fraseDoErro(e));
    } finally {
      setOcupado(false);
    }
  };

  const apagar = async () => {
    if (!apagando) return;
    try {
      await apagarCampo(apagando.id);
      await reler();
      toast.success("Campo apagado. O que já foi preenchido nos negócios continua guardado.");
    } catch (e) {
      toast.error(fraseDoErro(e));
    } finally {
      setApagando(null);
    }
  };

  return (
    <Secao
      titulo="Campos do negócio"
      descricao={`${existentes.length} de 40`}
      ajuda="Tudo o que a sua empresa precisa saber de cada negócio além de nome, valor e responsável. Os campos aparecem na ficha do negócio, agrupados."
      acao={
        <button type="button" className={botao.primario} onClick={() => abrir(null)} data-novo-campo="">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Campo
        </button>
      }
    >
      <div data-campos-da-conta="">
        {nicho && faltam.length > 0 && (
          <div className="mb-4 flex min-w-0 flex-wrap items-center rounded-lg bg-primary/[0.07] px-3 py-2.5" data-campos-do-ramo="">
            <Sparkles className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <p className={juntar(texto.corpo, "mr-3 min-w-0 flex-1")}>
              {nicho.nome} costuma pedir: {faltam.map((f) => f.rotulo).join(", ")}.
            </p>
            <button type="button" className={juntar(botao.secundario, "mt-1 h-8 sm:mt-0")} onClick={() => void ligarDoRamo()} disabled={ocupado} data-ligar-campos-do-ramo="">
              Usar estes campos
            </button>
          </div>
        )}
        {campos.isLoading ? (
          <Carregando linhas={4} rotulo="Carregando os campos" />
        ) : existentes.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhum campo próprio ainda." descricao="Crie o primeiro ou use a lista pronta do seu ramo." />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {existentes.map((c) => (
              <li key={c.id} className={lista.linha} data-campo={c.chave}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium", !c.ativo && "text-muted-foreground line-through")}>{c.rotulo}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>
                    {ROTULO_DO_TIPO_DE_CAMPO[c.tipo]}
                    {c.grupo ? ` · ${c.grupo}` : ""}
                    {c.tipo === "lista" && c.opcoes.length ? ` · ${c.opcoes.length} opções` : ""}
                  </span>
                </span>
                {c.no_cartao && <span className={juntar(etiqueta, "ml-2 hidden bg-muted text-muted-foreground sm:inline-flex")}>No cartão</span>}
                {c.obrigatorio && <span className={juntar(etiqueta, "ml-2 hidden bg-warning/10 text-warning sm:inline-flex")}>Obrigatório</span>}
                <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => abrir(c)} aria-label={`Editar ${c.rotulo}`} title="Editar"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={botao.icone} onClick={() => setApagando(c)} aria-label={`Apagar ${c.rotulo}`} title="Apagar"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <JanelaCentral
        aberta={!!editando}
        onFechar={() => setEditando(null)}
        largura="sm"
        titulo={editando && editando.id ? "Editar campo" : "Novo campo"}
        rodape={
          <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={ocupado || !editando || !editando.rotulo || editando.rotulo.trim().length < 2} data-salvar-campo="">
            {ocupado ? "Salvando..." : "Salvar"}
          </button>
        }
      >
        {editando && (
          <GrupoDeCampos colunas={1}>
            <CampoDeFormulario rotulo="Nome do campo" obrigatorio>
              <input value={editando.rotulo || ""} onChange={(e) => setEditando({ ...editando, rotulo: e.target.value })} className={campo} maxLength={40} placeholder="Valor da carta" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Tipo" ajuda={editando.id ? "O tipo não muda depois de criado, para não bagunçar o que já foi preenchido." : undefined}>
              <select value={editando.tipo || "texto"} onChange={(e) => setEditando({ ...editando, tipo: e.target.value as TipoDeCampo })} className={campo} disabled={!!editando.id}>
                {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_DO_TIPO_DE_CAMPO[t]}</option>)}
              </select>
            </CampoDeFormulario>
            {editando.tipo === "lista" && (
              <CampoDeFormulario rotulo="Opções" ajuda="Uma por linha.">
                <textarea value={opcoes} onChange={(e) => setOpcoes(e.target.value)} className={juntar(campo, "h-28 py-2")} placeholder={"Imóvel\nAutomóvel\nServiços"} />
              </CampoDeFormulario>
            )}
            <CampoDeFormulario rotulo="Grupo" ajuda="Campos do mesmo grupo ficam juntos na ficha.">
              <input value={editando.grupo || ""} onChange={(e) => setEditando({ ...editando, grupo: e.target.value })} className={campo} maxLength={40} placeholder="Carta" />
            </CampoDeFormulario>
            <label className="flex min-w-0 items-center">
              <input type="checkbox" checked={!!editando.obrigatorio} onChange={(e) => setEditando({ ...editando, obrigatorio: e.target.checked })} className="mr-2 h-4 w-4" />
              <span className={texto.corpo}>Marcar como obrigatório</span>
            </label>
            <label className="flex min-w-0 items-center">
              <input type="checkbox" checked={editando.ativo !== false} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} className="mr-2 h-4 w-4" />
              <span className={texto.corpo}>Aparece na ficha do negócio</span>
            </label>
          </GrupoDeCampos>
        )}
      </JanelaCentral>

      <JanelaCentral
        aberta={!!apagando}
        onFechar={() => setApagando(null)}
        largura="sm"
        titulo={apagando ? `Apagar o campo ${apagando.rotulo}?` : "Apagar"}
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setApagando(null)}>Cancelar</button>
            <button type="button" className={botao.perigo} onClick={() => void apagar()}>Apagar</button>
          </>
        }
      >
        <p className={texto.corpo}>Ele some da ficha. O que já foi preenchido nos negócios continua guardado.</p>
      </JanelaCentral>
    </Secao>
  );
}
