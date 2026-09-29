import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Loader2, Package, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useFotos, useKits, type KitDeFoto } from "@/components/mesa-foto/fotoApi";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import Painel from "@/components/sistema/Painel";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, campoTexto, foco, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { RECEITAS_DE_PUBLICIDADE, receitaDaCategoria, receitaParaProduto } from "../../../supabase/functions/_shared/receitas-de-publicidade.ts";
import {
  AvisoDoRascunho,
  CabecalhoDaEtapa,
  FontesDoProduto,
  MolduraDaFoto,
  RotuloLargo,
  StatusDaCampanhaPilula,
  useMesaPublicidade,
} from "./Comuns";
import {
  briefingIgual,
  criarCampanha,
  FORMATOS_DA_CAMPANHA,
  lacunasDoBriefing,
  normalizarBriefing,
  OBJETIVOS_DA_CAMPANHA,
  ROTULO_DO_STATUS,
  salvarBriefing,
  STATUS_DO_FATO,
  useCampanhas,
  type Briefing,
} from "./publicidadeApi";

/**
 * Passo 1: cliente, produto e briefing. O produto é o kit da Mesa Foto (as
 * fotos reais ficam no acervo único, cliente_imagens): aqui só se escolhe. O
 * briefing é versionado: cada salvar com mudança vira uma versão nova, e os
 * territórios guardam de qual versão saíram. A oferta só fica confirmada com
 * fonte.
 *
 * Sistema de design (26/09): campanhas num seletor, ações na linha do título,
 * briefing em CampoDeFormulario + GrupoDeCampos e rascunho do briefing
 * guardado por campanha e versão (sair e voltar não perde o que foi escrito).
 */

const linhas = (v: string[]) => v.join("\n");
const deLinhas = (t: string) =>
  t
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function EscolherProduto({ kits, onCriado }: { kits: KitDeFoto[]; onCriado: () => void }) {
  const { clientId } = useMesa();
  const { aplicar, abrirCampanha } = useMesaPublicidade();
  const fotos = useFotos(clientId);
  const avisarErro = useAvisarErro();
  const [kitId, setKitId] = useEstadoDaTela<string>(`mesa-publicidade:produto:${clientId}`, "", { validar: (v) => typeof v === "string" });
  const [categoria, setCategoria] = useState<string>("");
  const [criando, setCriando] = useState(false);
  const [recolhido, setRecolhido] = useRecolhido(`mesa-publicidade:escolher-produto:${clientId}`, false);
  const kit = kits.find((k) => k.id === kitId) || null;
  const sugerida = kit ? receitaParaProduto(kit.nome, kit.tipo) : null;

  const criar = async () => {
    if (!kit || !kit.id || criando) return;
    setCriando(true);
    try {
      const r = await criarCampanha(clientId, kit.id, categoria || (sugerida ? sugerida.id : null));
      aplicar(r.campanha);
      abrirCampanha(r.campanha.id || "rascunho");
      toast.success("Campanha aberta", { description: r.banco ? "Agora complete o briefing." : "Rascunho: o banco da Mesa Publicidade ainda não foi publicado." });
      setKitId("");
      onCriado();
    } catch (e) {
      avisarErro(e, "Campanha não aberta");
    } finally {
      setCriando(false);
    }
  };

  return (
    <section className="min-w-0 space-y-3" data-escolher-produto="" data-recolhido={recolhido ? "sim" : "nao"}>
      <CabecalhoDaEtapa
        nivel={3}
        titulo="Qual produto vai para a campanha?"
        ajuda="Os produtos vêm da Mesa Foto, com as fotos reais. A campanha nunca muda o produto."
        estado={`${kits.length} ${kits.length === 1 ? "produto" : "produtos"} na Mesa Foto`}
        recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo: `${kits.length} ${kits.length === 1 ? "produto" : "produtos"}` }}
      />
      {!recolhido && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {kits.map((k) => {
            const capa = (fotos.data || []).find((f) => f.id === (k.frente_imagem_id || (k.refs[0] && k.refs[0].imagem_id))) || null;
            const ativo = k.id === kitId;
            return (
              <button
                key={k.id || k.nome}
                type="button"
                onClick={() => {
                  setKitId(k.id || "");
                  setCategoria("");
                }}
                aria-pressed={ativo}
                className={juntar("min-w-0 rounded-lg border p-1.5 text-left transition-colors", ativo ? "border-primary bg-primary/5" : "border-border hover:border-primary/50", foco)}
              >
                <MolduraDaFoto caminho={capa ? capa.storage_path : null} bucket={capa ? capa.storage_bucket : "mesa"} alt={k.nome} proporcao={1} />
                <span className="mt-1 block truncate text-[12px] font-medium">{k.nome || "Produto"}</span>
                {k.variante && <span className="block truncate text-[11px] text-muted-foreground">{k.variante}</span>}
              </button>
            );
          })}
        </div>
      )}
      {!recolhido && kit && (
        <div className="flex min-w-0 flex-wrap items-end">
          <CampoDeFormulario rotulo="Categoria da receita" ajuda="Dado de partida do diretor. Sem receita, o diretor decide." className="mb-2 mr-2 w-full sm:w-64">
            <select value={categoria || (sugerida ? sugerida.id : "")} onChange={(e) => setCategoria(e.target.value)} className={campo}>
              <option value="">Sem receita (o diretor decide)</option>
              {RECEITAS_DE_PUBLICIDADE.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.categoria}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <button type="button" className={juntar(botao.primario, "mb-2 max-w-full")} onClick={() => void criar()} disabled={criando}>
            {criando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            <span className="min-w-0 truncate">Abrir a campanha deste produto</span>
          </button>
        </div>
      )}
    </section>
  );
}

interface RascunhoDoBriefing {
  b: Briefing;
  nome: string;
  categoria: string;
}

function FormularioDoBriefing() {
  const { clientId } = useMesa();
  const { campanha, aplicar } = useMesaPublicidade();
  const avisarErro = useAvisarErro();
  const inicial: RascunhoDoBriefing = {
    b: normalizarBriefing(campanha ? campanha.briefing : null),
    nome: campanha ? campanha.nome : "",
    categoria: campanha && campanha.categoria ? campanha.categoria : "",
  };
  // Rascunho do briefing por campanha e versão: sair e voltar mantém o que foi escrito.
  const chave = campanha ? `mesa-publicidade:briefing:${clientId}:${campanha.id || "rascunho"}:${campanha.briefing_versao}` : `mesa-publicidade:briefing:${clientId}:nenhuma`;
  const [rascunho, setRascunho] = useEstadoDaTela<RascunhoDoBriefing>(chave, inicial, {
    validar: (v) => !!v && typeof v === "object" && typeof (v as RascunhoDoBriefing).nome === "string" && !!(v as RascunhoDoBriefing).b,
    esperaMs: 300,
  });
  const [salvando, setSalvando] = useState(false);
  if (!campanha) return null;
  const b = normalizarBriefing(rascunho.b);
  const nome = rascunho.nome;
  const categoria = rascunho.categoria;
  const mudou = !briefingIgual(b, campanha.briefing) || nome !== campanha.nome || (categoria || null) !== (campanha.categoria || null);
  const lacunas = lacunasDoBriefing(b);
  const receita = receitaDaCategoria(categoria);
  const mudar = (parcial: Partial<Briefing>) => setRascunho((x) => ({ ...x, b: { ...normalizarBriefing(x.b), ...parcial } }));

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      const r = await salvarBriefing(campanha, b, nome, categoria || null);
      // O rascunho passa a ser o que foi salvo (a versão nova lê a chave dela).
      setRascunho({ b, nome, categoria });
      aplicar(r.campanha);
      toast.success(r.bruto && r.bruto.versao_nova ? `Briefing salvo na versão ${r.campanha.briefing_versao}` : "Campanha salva", {
        description: lacunas.length ? `Faltam ${lacunas.length} ${lacunas.length === 1 ? "ponto" : "pontos"}; dá para propor mesmo assim.` : "Briefing completo.",
      });
    } catch (e) {
      avisarErro(e, "Briefing não salvo");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Painel
      as="section"
      data-briefing=""
      titulo="Briefing"
      descricao={
        <>
          versão {campanha.briefing_versao} <StatusDaCampanhaPilula campanha={campanha} />
          {!campanha.persistida ? " · rascunho nesta aba" : ""}
        </>
      }
      acao={
        <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || !mudou} data-salvar-briefing="">
          {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : mudou ? <Save className="mr-1.5 h-3.5 w-3.5" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          {mudou ? "Salvar briefing" : "Briefing salvo"}
        </button>
      }
    >
      <div className="space-y-5">
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="Nome da campanha">
            <input value={nome} onChange={(e) => setRascunho((x) => ({ ...x, nome: e.target.value }))} maxLength={120} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Receita da categoria" ajuda="Dado de partida do diretor, não campanha vencedora.">
            <select value={categoria} onChange={(e) => setRascunho((x) => ({ ...x, categoria: e.target.value }))} className={campo}>
              <option value="">Sem receita</option>
              {RECEITAS_DE_PUBLICIDADE.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.categoria}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Objetivo">
            <select value={b.objetivo} onChange={(e) => mudar({ objetivo: e.target.value as Briefing["objetivo"] })} className={campo}>
              {OBJETIVOS_DA_CAMPANHA.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Evento de sucesso">
            <input value={b.objetivo_texto} onChange={(e) => mudar({ objetivo_texto: e.target.value })} placeholder="Ex.: consulta no WhatsApp" className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Destino" ajuda="Para onde a pessoa vai depois do anúncio.">
            <input value={b.destino} onChange={(e) => mudar({ destino: e.target.value })} placeholder="WhatsApp, loja, site" className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Tom">
            <input value={b.tom} onChange={(e) => mudar({ tom: e.target.value })} placeholder="Ex.: leve, urbano, confiante" className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Público e situação de compra">
            <textarea value={b.publico} onChange={(e) => mudar({ publico: e.target.value })} rows={2} className={juntar(campoTexto, "min-h-[64px]")} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Ocasião">
            <textarea value={b.ocasiao} onChange={(e) => mudar({ ocasiao: e.target.value })} rows={2} className={juntar(campoTexto, "min-h-[64px]")} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Oferta" ajuda="Preço e condição só com fonte. Sem fonte, a oferta não fica confirmada.">
            <input value={b.oferta.texto} onChange={(e) => mudar({ oferta: { ...b.oferta, texto: e.target.value } })} placeholder="Ex.: 10% no Pix até 30/09" className={campo} />
          </CampoDeFormulario>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_128px] gap-x-2">
            <CampoDeFormulario rotulo="Fonte da oferta">
              <input value={b.oferta.fonte} onChange={(e) => mudar({ oferta: { ...b.oferta, fonte: e.target.value } })} placeholder="Site, conversa, tabela" className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Estado">
              <select
                value={b.oferta.status}
                onChange={(e) => mudar({ oferta: { ...b.oferta, status: e.target.value as Briefing["oferta"]["status"] } })}
                className={campo}
                aria-label="Estado da oferta"
              >
                {STATUS_DO_FATO.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.rotulo}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          </div>
          <CampoDeFormulario rotulo="Formatos" largo>
            <div className="flex min-w-0 flex-wrap" role="group" aria-label="Formatos">
              {FORMATOS_DA_CAMPANHA.map((f) => {
                const ligado = b.formatos.indexOf(f) >= 0;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={ligado}
                    onClick={() => mudar({ formatos: ligado ? b.formatos.filter((x) => x !== f) : b.formatos.concat([f]) })}
                    className={juntar(
                      "mb-1 mr-1.5 inline-flex h-8 items-center rounded-md border px-3 text-[12.5px] tabular-nums transition-colors",
                      ligado ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                      foco,
                    )}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </CampoDeFormulario>
        </GrupoDeCampos>

        {/* 28/09: o cabeçalho feito à mão (h4 de 14 px) virou Secao: recolhe e o "?" fica ao lado do título. */}
        <Secao
          divisoria
          nivel={3}
          titulo="O que não pode mudar no produto"
          ajuda="A revisão reprova a foto que mudar qualquer um destes, mesmo bonita."
          recolher={`mesa-publicidade:restricoes:${clientId}`}
          data-restricoes=""
        >
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Logo e texto">
              <input value={b.restricoes.logo} onChange={(e) => mudar({ restricoes: { ...b.restricoes, logo: e.target.value } })} placeholder="Ex.: logo gravada na haste" className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Cor da variante">
              <input value={b.restricoes.cor_da_variante} onChange={(e) => mudar({ restricoes: { ...b.restricoes, cor_da_variante: e.target.value } })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Detalhes de material" apoio="Um por linha.">
              <textarea value={linhas(b.restricoes.detalhes)} onChange={(e) => mudar({ restricoes: { ...b.restricoes, detalhes: deLinhas(e.target.value) } })} rows={3} className={campoTexto} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Não mostrar nem prometer">
              <textarea value={b.proibido} onChange={(e) => mudar({ proibido: e.target.value })} rows={3} placeholder="Ex.: resultado clínico, desconto que não existe" className={campoTexto} />
            </CampoDeFormulario>
          </GrupoDeCampos>
        </Secao>

        {/* Estado em uma linha (o que falta) e a receita com o detalhe no "?": nada de texto empilhado. */}
        {lacunas.length > 0 && (
          <p className={juntar(texto.auxiliar, "truncate")} title={lacunas.map((l) => `Falta: ${l}`).join(". ")} data-lacunas="">
            {lacunas.length === 1 ? "Falta" : `Faltam ${lacunas.length}`}: {lacunas.join("; ")}
          </p>
        )}

        {receita && (
          <div className="flex min-w-0 items-center text-[12px]" data-receita={receita.id}>
            <p className="min-w-0 truncate font-semibold">Receita de {receita.categoria}</p>
            <AjudaRecolhida className="ml-1.5" rotulo="Sobre a receita">
              Receita de partida, não campanha vencedora. Territórios de partida: {receita.territorios.join(", ")}. Não pode mudar: {receita.invariantes.join(", ")}. Foco da revisão: {receita.foco_da_revisao}
            </AjudaRecolhida>
          </div>
        )}
      </div>
    </Painel>
  );
}

export default function EtapaCampanha() {
  const { clientId } = useMesa();
  const { campanha, banco, abrirCampanha, irPara } = useMesaPublicidade();
  const kits = useKits(clientId);
  const fotos = useFotos(clientId);
  const campanhas = useCampanhas(clientId);
  const [nova, setNova] = useState(false);
  const [produtoRecolhido, setProdutoRecolhido] = useRecolhido(`mesa-publicidade:produto:${clientId}`, false);
  const listaDeKits = useMemo(() => (kits.data || []).filter((k) => k.tipo !== "pessoa" && k.status !== "arquivado" && !!k.id), [kits.data]);
  const lista = (campanhas.data && campanhas.data.campanhas) || [];
  const mostrarEscolha = nova || (!campanha && !campanhas.isLoading && lista.length === 0);
  const opcoesDeCampanha = lista.map((c) => ({
    valor: c.id,
    rotulo: c.nome || c.kit_nome || "Campanha",
    descricao: `${c.kit_nome || "sem produto"} · ${(ROTULO_DO_STATUS as Record<string, string>)[c.status] || c.status}`,
  }));

  return (
    <div className="min-w-0 space-y-6" data-etapa-publicidade="campanha">
      <CabecalhoDaEtapa
        titulo="Campanha"
        ajuda="Escolha o produto, complete o briefing e siga para a direção. A Publicidade dirige; a Mesa Foto produz; a Mesa Ads testa."
        estado={campanha ? `${campanha.kit_nome || "sem produto"} · briefing versão ${campanha.briefing_versao}` : lista.length ? `${lista.length} ${lista.length === 1 ? "campanha" : "campanhas"}` : undefined}
        acoes={
          <>
            {lista.length > 0 && (
              <div className="min-w-0 max-w-[220px]" data-campanhas="">
                <SeletorCompacto
                  modo="lista"
                  rotulo="Campanhas do cliente"
                  icone={<Package className="h-3.5 w-3.5" />}
                  opcoes={opcoesDeCampanha}
                  valor={campanha && campanha.id ? campanha.id : ""}
                  onEscolher={(id) => {
                    setNova(false);
                    abrirCampanha(id);
                  }}
                  className="w-full"
                />
              </div>
            )}
            <button type="button" className={botao.secundario} onClick={() => setNova((v) => !v)} aria-pressed={nova} aria-label="Nova campanha">
              <Plus className="h-3.5 w-3.5" />
              <RotuloLargo>Nova campanha</RotuloLargo>
            </button>
            {campanha && !nova && (
              <button type="button" className={botao.secundario} onClick={() => irPara("direcao")} aria-label="Seguir para a direção">
                <ArrowRight className="h-3.5 w-3.5" />
                <RotuloLargo>Seguir para a direção</RotuloLargo>
              </button>
            )}
          </>
        }
      />
      {!banco && <AvisoDoRascunho />}

      {mostrarEscolha &&
        (kits.isLoading ? (
          <Carregando forma="grade" linhas={6} rotulo="Lendo os produtos" />
        ) : listaDeKits.length ? (
          <EscolherProduto kits={listaDeKits} onCriado={() => setNova(false)} />
        ) : (
          <div data-sem-produto="">
            <EstadoVazio
              icone={<Package className="h-5 w-5" />}
              titulo="Este cliente ainda não tem produto na Mesa Foto."
              descricao="Suba e identifique o produto lá: ele aparece aqui na hora."
              acao={
                <Link to={`/mesa-foto?client=${clientId}&etapa=acervo`} className={botao.secundario}>
                  Abrir a Mesa Foto
                </Link>
              }
            />
          </div>
        ))}

      {campanha && !nova && (
        <>
          <section className="min-w-0 space-y-2" data-produto-da-campanha="" data-recolhido={produtoRecolhido ? "sim" : "nao"}>
            <CabecalhoDaEtapa
              nivel={3}
              titulo={`Produto: ${campanha.kit_nome || "sem produto"}`}
              ajuda="As fotos reais do kit são a fonte da verdade do produto. A revisão compara cada foto com elas."
              estado={`${campanha.produto_fontes.length} ${campanha.produto_fontes.length === 1 ? "fonte" : "fontes"} da verdade`}
              recolher={{
                recolhido: produtoRecolhido,
                onAlternar: () => setProdutoRecolhido(!produtoRecolhido),
                resumo: `${campanha.produto_fontes.length} ${campanha.produto_fontes.length === 1 ? "fonte" : "fontes"}`,
              }}
            />
            {!produtoRecolhido && <FontesDoProduto ids={campanha.produto_fontes} fotos={fotos.data || []} />}
          </section>
          <FormularioDoBriefing />
        </>
      )}
    </div>
  );
}
