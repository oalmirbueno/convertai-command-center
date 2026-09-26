import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useFotos, useKits, type KitDeFoto } from "@/components/mesa-foto/fotoApi";
import { RECEITAS_DE_PUBLICIDADE, receitaDaCategoria, receitaParaProduto } from "../../../supabase/functions/_shared/receitas-de-publicidade.ts";
import {
  AvisoDoRascunho,
  CabecalhoDaEtapa,
  FontesDoProduto,
  MolduraDaFoto,
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
 */

const linhas = (v: string[]) => v.join("\n");
const deLinhas = (t: string) =>
  t
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-[12px] font-medium">{rotulo}</span>
      {dica && <span className="ml-1 text-[11px] text-muted-foreground">{dica}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function EscolherProduto({ kits, onCriado }: { kits: KitDeFoto[]; onCriado: () => void }) {
  const { clientId } = useMesa();
  const { aplicar, abrirCampanha } = useMesaPublicidade();
  const fotos = useFotos(clientId);
  const avisarErro = useAvisarErro();
  const [kitId, setKitId] = useState<string>("");
  const [categoria, setCategoria] = useState<string>("");
  const [criando, setCriando] = useState(false);
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
      onCriado();
    } catch (e) {
      avisarErro(e, "Campanha não aberta");
    } finally {
      setCriando(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-3.5" data-escolher-produto="">
      <p className="text-[13px] font-semibold">Qual produto vai para a campanha?</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">Os produtos vêm da Mesa Foto, com as fotos reais. A campanha nunca muda o produto.</p>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
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
              className={`min-w-0 rounded-lg border p-1.5 text-left transition-colors ${ativo ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            >
              <MolduraDaFoto caminho={capa ? capa.storage_path : null} bucket={capa ? capa.storage_bucket : "mesa"} alt={k.nome} proporcao={1} />
              <span className="mt-1 block truncate text-[12px] font-medium">{k.nome || "Produto"}</span>
              {k.variante && <span className="block truncate text-[11px] text-muted-foreground">{k.variante}</span>}
            </button>
          );
        })}
      </div>
      {kit && (
        <div className="mt-3 flex flex-wrap items-end">
          <label className="mb-1.5 mr-2 block min-w-0">
            <span className="text-[12px] font-medium">Categoria da receita</span>
            <select
              value={categoria || (sugerida ? sugerida.id : "")}
              onChange={(e) => setCategoria(e.target.value)}
              className="mt-1 block h-9 w-56 max-w-full rounded-md border border-input bg-background px-2 text-[12.5px]"
            >
              <option value="">Sem receita (o diretor decide)</option>
              {RECEITAS_DE_PUBLICIDADE.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.categoria}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" size="sm" className="mb-1.5 h-9" onClick={() => void criar()} disabled={criando}>
            {criando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Abrir a campanha deste produto
          </Button>
        </div>
      )}
    </section>
  );
}

function FormularioDoBriefing() {
  const { campanha, aplicar } = useMesaPublicidade();
  const avisarErro = useAvisarErro();
  const [b, setB] = useState<Briefing>(() => normalizarBriefing(campanha ? campanha.briefing : null));
  const [nome, setNome] = useState(campanha ? campanha.nome : "");
  const [categoria, setCategoria] = useState<string>(campanha && campanha.categoria ? campanha.categoria : "");
  const [salvando, setSalvando] = useState(false);
  const chave = campanha ? `${campanha.id || "rascunho"}:${campanha.briefing_versao}` : "";
  useEffect(() => {
    if (!campanha) return;
    setB(normalizarBriefing(campanha.briefing));
    setNome(campanha.nome);
    setCategoria(campanha.categoria || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  if (!campanha) return null;
  const mudou = !briefingIgual(b, campanha.briefing) || nome !== campanha.nome || (categoria || null) !== (campanha.categoria || null);
  const lacunas = lacunasDoBriefing(b);
  const receita = receitaDaCategoria(categoria);
  const mudar = (parcial: Partial<Briefing>) => setB((x) => ({ ...x, ...parcial }));

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      const r = await salvarBriefing(campanha, b, nome, categoria || null);
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
    <section className="rounded-xl border border-border bg-card p-3.5" data-briefing="">
      <div className="mb-2.5 flex flex-wrap items-center">
        <p className="mr-2 text-[13px] font-semibold">Briefing</p>
        <span className="mr-2 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">versão {campanha.briefing_versao}</span>
        <StatusDaCampanhaPilula campanha={campanha} />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <Campo rotulo="Nome da campanha">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} className="h-9 text-[12.5px]" />
        </Campo>
        <Campo rotulo="Receita da categoria" dica="dado de partida do diretor">
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="block h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px]">
            <option value="">Sem receita</option>
            {RECEITAS_DE_PUBLICIDADE.map((r) => (
              <option key={r.id} value={r.id}>
                {r.categoria}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Objetivo">
          <div className="flex min-w-0">
            <select
              value={b.objetivo}
              onChange={(e) => mudar({ objetivo: e.target.value as Briefing["objetivo"] })}
              className="mr-1.5 block h-9 w-40 shrink-0 rounded-md border border-input bg-background px-2 text-[12.5px]"
            >
              {OBJETIVOS_DA_CAMPANHA.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <Input value={b.objetivo_texto} onChange={(e) => mudar({ objetivo_texto: e.target.value })} placeholder="Evento de sucesso (ex.: consulta no WhatsApp)" className="h-9 min-w-0 text-[12.5px]" />
          </div>
        </Campo>
        <Campo rotulo="Destino" dica="para onde a pessoa vai">
          <Input value={b.destino} onChange={(e) => mudar({ destino: e.target.value })} placeholder="WhatsApp, loja, site" className="h-9 text-[12.5px]" />
        </Campo>
        <Campo rotulo="Público e situação de compra">
          <Textarea value={b.publico} onChange={(e) => mudar({ publico: e.target.value })} rows={2} className="text-[12.5px]" />
        </Campo>
        <Campo rotulo="Ocasião">
          <Textarea value={b.ocasiao} onChange={(e) => mudar({ ocasiao: e.target.value })} rows={2} className="text-[12.5px]" />
        </Campo>
        <Campo rotulo="Oferta" dica="preço e condição só com fonte">
          <Input value={b.oferta.texto} onChange={(e) => mudar({ oferta: { ...b.oferta, texto: e.target.value } })} placeholder="Ex.: 10% no Pix até 30/09" className="h-9 text-[12.5px]" />
          <div className="mt-1.5 flex min-w-0">
            <Input value={b.oferta.fonte} onChange={(e) => mudar({ oferta: { ...b.oferta, fonte: e.target.value } })} placeholder="Fonte (site, conversa, tabela)" className="mr-1.5 h-9 min-w-0 text-[12.5px]" />
            <select
              value={b.oferta.status}
              onChange={(e) => mudar({ oferta: { ...b.oferta, status: e.target.value as Briefing["oferta"]["status"] } })}
              className="block h-9 w-32 shrink-0 rounded-md border border-input bg-background px-2 text-[12.5px]"
              aria-label="Estado da oferta"
            >
              {STATUS_DO_FATO.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.rotulo}
                </option>
              ))}
            </select>
          </div>
        </Campo>
        <Campo rotulo="Tom">
          <Input value={b.tom} onChange={(e) => mudar({ tom: e.target.value })} placeholder="Ex.: leve, urbano, confiante" className="h-9 text-[12.5px]" />
        </Campo>
      </div>

      <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3" data-restricoes="">
        <p className="text-[12.5px] font-semibold">O que não pode mudar no produto</p>
        <p className="text-[11.5px] text-muted-foreground">A revisão reprova a foto que mudar qualquer um destes, mesmo bonita.</p>
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <Campo rotulo="Logo e texto">
            <Input value={b.restricoes.logo} onChange={(e) => mudar({ restricoes: { ...b.restricoes, logo: e.target.value } })} placeholder="Ex.: logo gravada na haste" className="h-9 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Cor da variante">
            <Input value={b.restricoes.cor_da_variante} onChange={(e) => mudar({ restricoes: { ...b.restricoes, cor_da_variante: e.target.value } })} className="h-9 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Detalhes de material" dica="um por linha">
            <Textarea value={linhas(b.restricoes.detalhes)} onChange={(e) => mudar({ restricoes: { ...b.restricoes, detalhes: deLinhas(e.target.value) } })} rows={3} className="text-[12.5px]" />
          </Campo>
          <Campo rotulo="Não mostrar nem prometer">
            <Textarea value={b.proibido} onChange={(e) => mudar({ proibido: e.target.value })} rows={3} placeholder="Ex.: resultado clínico, desconto que não existe" className="text-[12.5px]" />
          </Campo>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center">
        <span className="mr-2 text-[12px] font-medium">Formatos</span>
        {FORMATOS_DA_CAMPANHA.map((f) => {
          const ligado = b.formatos.indexOf(f) >= 0;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={ligado}
              onClick={() => mudar({ formatos: ligado ? b.formatos.filter((x) => x !== f) : b.formatos.concat([f]) })}
              className={`mb-1 mr-1 rounded-full border px-2.5 py-0.5 text-[11.5px] ${ligado ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
            >
              {f}
            </button>
          );
        })}
      </div>

      {lacunas.length > 0 && (
        <ul className="mt-2 text-[11.5px] leading-snug text-muted-foreground" data-lacunas="">
          {lacunas.map((l) => (
            <li key={l}>Falta: {l}</li>
          ))}
        </ul>
      )}

      {receita && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3 text-[12px]" data-receita={receita.id}>
          <p className="font-semibold">Receita de {receita.categoria}</p>
          <p className="mt-0.5 text-muted-foreground">Territórios de partida: {receita.territorios.join(", ")}.</p>
          <p className="text-muted-foreground">Não pode mudar: {receita.invariantes.join(", ")}.</p>
          <p className="text-muted-foreground">Foco da revisão: {receita.foco_da_revisao}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Receita de partida, não campanha vencedora.</p>
        </div>
      )}

      <div className="mt-3 flex items-center">
        <Button type="button" size="sm" className="h-9" onClick={() => void salvar()} disabled={salvando || !mudou} data-salvar-briefing="">
          {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : mudou ? <Save className="mr-1.5 h-3.5 w-3.5" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          {mudou ? "Salvar briefing" : "Briefing salvo"}
        </Button>
        {!campanha.persistida && <span className="ml-2 text-[11px] text-muted-foreground">Rascunho nesta aba do navegador.</span>}
      </div>
    </section>
  );
}

export default function EtapaCampanha() {
  const { clientId } = useMesa();
  const { campanha, banco, abrirCampanha, irPara } = useMesaPublicidade();
  const kits = useKits(clientId);
  const fotos = useFotos(clientId);
  const campanhas = useCampanhas(clientId);
  const [nova, setNova] = useState(false);
  const listaDeKits = useMemo(() => (kits.data || []).filter((k) => k.tipo !== "pessoa" && k.status !== "arquivado" && !!k.id), [kits.data]);
  const lista = (campanhas.data && campanhas.data.campanhas) || [];
  const mostrarEscolha = nova || (!campanha && !campanhas.isLoading && lista.length === 0);

  return (
    <div className="space-y-4" data-etapa-publicidade="campanha">
      <CabecalhoDaEtapa
        titulo="Campanha"
        descricao="Escolha o produto, complete o briefing e siga para a direção. A Publicidade dirige; a Mesa Foto produz; a Mesa Ads testa."
        acoes={
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setNova((v) => !v)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nova campanha
          </Button>
        }
      />
      {!banco && <AvisoDoRascunho />}

      {lista.length > 0 && (
        <div className="flex flex-wrap" role="group" aria-label="Campanhas do cliente" data-campanhas="">
          {lista.map((c) => {
            const ativa = !!campanha && campanha.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setNova(false);
                  abrirCampanha(c.id);
                }}
                aria-current={ativa ? "true" : undefined}
                className={`mb-1.5 mr-1.5 max-w-full rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${ativa ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
              >
                <span className="block truncate font-medium">{c.nome}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {c.kit_nome || "sem produto"} · {(ROTULO_DO_STATUS as Record<string, string>)[c.status] || c.status}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {mostrarEscolha &&
        (kits.isLoading ? (
          <div className="h-28 animate-pulse rounded-xl bg-muted/70" />
        ) : listaDeKits.length ? (
          <EscolherProduto kits={listaDeKits} onCriado={() => setNova(false)} />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-center" data-sem-produto="">
            <p className="text-[13.5px] font-medium">Este cliente ainda não tem produto na Mesa Foto.</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Suba as fotos reais do produto e identifique o produto lá. Ele aparece aqui na hora.</p>
            <Link to={`/mesa-foto?client=${clientId}&etapa=acervo`} className="mt-2 inline-block text-[12.5px] font-medium text-primary hover:underline">
              Abrir a Mesa Foto
            </Link>
          </div>
        ))}

      {campanha && !nova && (
        <>
          <section className="rounded-xl border border-border bg-card p-3.5" data-produto-da-campanha="">
            <div className="mb-2 flex flex-wrap items-center">
              <p className="mr-2 text-[13px] font-semibold">Produto: {campanha.kit_nome || "sem produto"}</p>
              <span className="text-[11.5px] text-muted-foreground">Fontes da verdade do produto ({campanha.produto_fontes.length}).</span>
            </div>
            <FontesDoProduto ids={campanha.produto_fontes} fotos={fotos.data || []} />
          </section>
          <FormularioDoBriefing />
          <div className="flex justify-end">
            <Button type="button" size="sm" className="h-9" onClick={() => irPara("direcao")}>
              Seguir para a direção
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
