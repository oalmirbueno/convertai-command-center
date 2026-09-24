import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, Globe, Loader2, PackageSearch, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Ampliar } from "@/components/mesa/Ampliar";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { ListaCurta, MiniaturaDaFoto } from "./Comuns";
import {
  chaveDosKits,
  MAX_FOTOS_NA_SUGESTAO,
  nomeDoProduto,
  partesDaSugestao,
  salvarKit,
  sugerirKit,
  useFotos,
  type IdentificacaoDoProduto,
  type PropostaDeKit,
} from "./fotoApi";

/**
 * O que fazer com a identificação. A função já grava o kit rascunho do
 * produto (fotos lidas e referências da internet): aqui é confirmar o
 * produto (kit confirmado) ou abrir o kit. Sem kit gravado (falha ou função
 * antiga), "Confirmar e montar o kit" chama kit_sugerir com as mesmas fotos.
 */
export function AcoesDaIdentificacao({
  identificacao,
  onKits,
  onPropostas,
}: {
  identificacao: IdentificacaoDoProduto;
  /** Kits gravados: a tela relê a lista e põe o primeiro na barra. */
  onKits: (ids: string[], avisar?: boolean) => void;
  /** Propostas sem id (função antiga): a tela mostra para salvar. */
  onPropostas?: (p: PropostaDeKit[]) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [confirmando, setConfirmando] = useState(false);
  const [confirmado, setConfirmado] = useState(!!identificacao.kit && identificacao.kit.status === "confirmado");
  const kit = identificacao.kit;
  const ids = identificacao.imagem_ids.slice();
  identificacao.referencias_web.forEach((r) => {
    if (ids.indexOf(r.imagem_id) < 0) ids.push(r.imagem_id);
  });

  if (kit && kit.id) {
    const confirmar = async () => {
      setConfirmando(true);
      try {
        const salvo = await salvarKit(clientId, { ...kit, status: "confirmado" });
        void queryClient.invalidateQueries({ queryKey: chaveDosKits(clientId) });
        setConfirmado(true);
        onKits([salvo.id || String(kit.id)]);
      } catch (e) {
        avisarErro(e, "Produto não confirmado");
      } finally {
        setConfirmando(false);
      }
    };
    return (
      <>
        <span className="mb-1.5 mr-2 inline-flex items-center text-[12px] text-muted-foreground" data-kit-da-identificacao={kit.id}>
          <Check className="mr-1 h-3.5 w-3.5 text-success" />
          Kit {identificacao.kit_acao === "atualizado" ? "atualizado" : "salvo"} como {confirmado ? "confirmado" : "rascunho"}: {kit.nome}
        </span>
        {!confirmado && (
          <Button type="button" size="sm" className="mb-1.5 mr-1.5 h-8 text-[12px]" disabled={confirmando} onClick={() => void confirmar()}>
            {confirmando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
            Confirmar o produto
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={() => onKits([String(kit.id)], false)}>
          Abrir o kit
        </Button>
      </>
    );
  }
  return (
    <BotaoComCusto
      rotulo={
        <>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Confirmar e montar o kit
        </>
      }
      titulo="Kit montado"
      descricao="Monta o kit com as fotos do cliente e as referências da internet. Volta salvo como rascunho."
      className="mb-1.5 mr-1.5 h-8 text-[12px]"
      disabled={!ids.length}
      partes={() => partesDaSugestao(catalogo, ids.length)}
      executar={() => sugerirKit(clientId, ids.slice(0, MAX_FOTOS_NA_SUGESTAO), { produto: identificacao.produto, referenciasWeb: identificacao.referencias_web })}
      aoConcluir={(data) => {
        const p: PropostaDeKit[] = (data && data.propostas) || [];
        const nome = nomeDoProduto(identificacao.produto);
        const semId = p.filter((x) => !x.id).map((x) => (nome && (!x.nome || x.nome === "Kit sem nome") ? { ...x, nome } : x));
        if (onPropostas) onPropostas(semId);
        else if (semId.length) toast.info("A proposta ficou em Produto para você conferir e salvar.");
        onKits((data && data.kit_ids) || []);
        if (!p.length) toast.info("A leitura não montou o kit com estas fotos.");
      }}
    />
  );
}

/**
 * O que a identificação do produto achou (produto_identificar): marca,
 * modelo e variante lidos na embalagem ou na foto, as especificações, as
 * fotos oficiais achadas na internet com a fonte, e o aviso de que elas são
 * de uso interno para fidelidade (nunca vão ao cliente). As ações (montar o
 * kit, pôr no kit aberto) vêm de quem usa: Kits e o diretor.
 */
export default function CartaoDaIdentificacao({ identificacao, acoes, compacto = false }: { identificacao: IdentificacaoDoProduto; acoes?: ReactNode; compacto?: boolean }) {
  const { clientId } = useMesa();
  const fotos = useFotos(clientId);
  const todas = fotos.data || [];
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const p = identificacao.produto;
  const refs = identificacao.referencias_web;
  const nome = nomeDoProduto(p);

  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-primary/30 bg-card p-3" data-identificacao="">
      <div className="flex min-w-0 items-start">
        <PackageSearch className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold [overflow-wrap:anywhere]">{nome || "Produto não identificado"}</p>
          {p && (
            <p className="text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">
              {[p.marca && `Marca ${p.marca}`, p.modelo && `modelo ${p.modelo}`, p.variante && `variante ${p.variante}`, p.categoria].filter(Boolean).join(" · ")}
              {p.confianca ? ` · confiança ${p.confianca}` : ""}
            </p>
          )}
        </div>
      </div>

      {p && (p.especificacoes.length > 0 || p.evidencias.length > 0) && (
        <div className={`grid min-w-0 grid-cols-1 gap-2 ${compacto ? "" : "sm:grid-cols-2"}`}>
          <ListaCurta titulo="Especificações" itens={p.especificacoes.slice(0, 10)} />
          <ListaCurta titulo="Lido na embalagem ou na foto" itens={p.evidencias.slice(0, 8)} />
        </div>
      )}

      <div className="min-w-0">
        <p className="mb-1 flex items-center text-[11px] font-medium text-muted-foreground">
          <Globe className="mr-1 h-3.5 w-3.5" /> Referências da internet · {refs.length}
        </p>
        {refs.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">A internet não confirmou fotos deste modelo. O kit segue com as fotos do cliente.</p>
        ) : (
          <ul className="grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-6">
            {refs.map((r, i) => {
              const f = todas.find((x) => x.id === r.imagem_id);
              return (
                <li key={r.imagem_id} className="min-w-0" data-referencia-web={r.imagem_id}>
                  <button type="button" className="block w-full cursor-zoom-in" onClick={() => setAmpliada(i)} aria-label={`Ver grande a referência ${i + 1}`}>
                    {f ? <MiniaturaDaFoto foto={f} /> : <span className="block rounded-lg bg-muted" style={{ paddingBottom: "100%" }} />}
                  </button>
                  {r.pagina ? (
                    <a href={r.pagina} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex min-w-0 items-center text-[10.5px] text-primary hover:underline" title={r.pagina}>
                      <span className="truncate">{r.fonte || "página"}</span>
                      <ExternalLink className="ml-0.5 h-2.5 w-2.5 shrink-0" />
                    </a>
                  ) : (
                    <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{r.fonte || "sem fonte"}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-1.5 rounded-lg bg-warning/10 px-2 py-1 text-[11px] leading-snug" data-aviso-uso-interno="">
          {identificacao.aviso_referencias || "Referência da internet: uso interno para fidelidade. Não publicar nem mandar ao cliente."}
        </p>
        {identificacao.promessa && <p className="mt-1 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{identificacao.promessa}</p>}
      </div>

      {identificacao.aviso_jev && (
        <p className="flex items-start rounded-lg bg-warning/10 px-2 py-1 text-[11.5px] leading-snug" data-aviso-jev="">
          <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-warning" /> <span className="min-w-0 [overflow-wrap:anywhere]">{identificacao.aviso_jev}</span>
        </p>
      )}
      {identificacao.lacunas.length > 0 && (
        <div className="min-w-0">
          {identificacao.lacunas.filter((l) => l !== identificacao.aviso_jev).map((l) => (
            <p key={l} className="flex items-start text-[11.5px] leading-snug">
              <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-warning" /> <span className="min-w-0 [overflow-wrap:anywhere]">{l}</span>
            </p>
          ))}
        </div>
      )}
      {identificacao.proximo_passo && <p className="text-[12px] font-medium [overflow-wrap:anywhere]">Próximo passo: {identificacao.proximo_passo}</p>}
      {acoes && <div className="flex min-w-0 flex-wrap items-center">{acoes}</div>}

      <Ampliar
        imagens={refs.map((r) => {
          const f = todas.find((x) => x.id === r.imagem_id);
          return {
            caminho: f ? f.storage_path : r.url || r.url_origem,
            bucket: f ? f.storage_bucket || "mesa" : undefined,
            titulo: r.fonte || "Referência da internet",
            legenda: "Referência da internet, uso interno para fidelidade",
          };
        })}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
