import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { textoDoErro } from "@/lib/mesa/api";
import { chaveDasMarcas, type MarcaDoCliente } from "@/lib/mesa/marcas";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import Secao from "@/components/sistema/Secao";
import { juntar, superficie } from "@/components/sistema/estilos";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useFontesDoCliente, useInvalidarContexto, useReferenciasDoCliente } from "./contextoDoCliente";
import ContextoMarca from "./ContextoMarca";

/**
 * Kit de uma marca que não é a principal (ex.: CME dentro da Acerbi).
 * Frente MC (29/09, dono: "simplifique, igual ao formato padrão; eu mudo
 * para CME e ele já muda tudo"): a parte de cima é o MESMO editor do kit do
 * cliente (ContextoMarca), que com a CME aberta lê e grava só a linha dela
 * em cliente_marcas. Aqui ficam só as ligações: quais referências e fontes do
 * cliente são desta marca (cliente_referencias.marca_id, cliente_fontes.marca_id).
 * Regra de herança única: supabase/functions/_shared/heranca-da-marca.ts.
 */

/** Vínculo de referências e fontes com a marca (id e marca_id). */
function useVinculosDaMarca(clientId: string) {
  return useQuery({
    queryKey: ["mesa", "marca-vinculos", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<{ referencias: Record<string, string | null>; fontes: Record<string, string | null> }> => {
      const [r, f] = await Promise.all([
        (supabase as any).from("cliente_referencias").select("id, marca_id").eq("client_id", clientId).limit(1000),
        (supabase as any).from("cliente_fontes").select("id, marca_id").eq("client_id", clientId),
      ]);
      if (r.error) throw r.error;
      if (f.error) throw f.error;
      const referencias: Record<string, string | null> = {};
      const fontes: Record<string, string | null> = {};
      for (const x of (r.data || []) as { id: string; marca_id: string | null }[]) referencias[x.id] = x.marca_id || null;
      for (const x of (f.data || []) as { id: string; marca_id: string | null }[]) fontes[x.id] = x.marca_id || null;
      return { referencias, fontes };
    },
  });
}

/** Caminho da logo da marca no bucket mesa, sempre sob a pasta do cliente. */
export function caminhoDaLogoDaMarca(clientId: string, marcaId: string, alternativa: boolean, ext: string, agora = Date.now()): string {
  return `${clientId}/marcas/${marcaId}/${alternativa ? "logo-alternativa" : "logo"}-${agora}.${ext === "jpeg" ? "jpg" : ext}`;
}

export default function ContextoKitDaMarca({ marca }: { marca: MarcaDoCliente }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const [mudando, setMudando] = useState<string | null>(null);

  const vinculos = useVinculosDaMarca(clientId);
  const referencias = useReferenciasDoCliente(clientId);
  const fontes = useFontesDoCliente(clientId);

  const reler = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDasMarcas(clientId) });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "marca-vinculos", clientId] });
    invalidar(clientId);
  };

  /** Marca ou desmarca uma referência ou fonte do cliente como desta marca. */
  const vincular = async (tabela: "cliente_referencias" | "cliente_fontes", id: string, daMarca: boolean) => {
    setMudando(id);
    try {
      const { error } = await (supabase as any)
        .from(tabela)
        .update({ marca_id: daMarca ? marca.id : null })
        .eq("id", id)
        .eq("client_id", clientId);
      if (error) throw error;
      reler();
    } catch (e) {
      toast.error("Não foi possível mudar", { description: textoDoErro(e) });
    } finally {
      setMudando(null);
    }
  };

  const mapaRefs = (vinculos.data && vinculos.data.referencias) || {};
  const mapaFontes = (vinculos.data && vinculos.data.fontes) || {};
  const refs = (referencias.data || []).filter((r) => r.ativa && r.imagem && (!mapaRefs[r.id] || mapaRefs[r.id] === marca.id)).slice(0, 60);
  const listaFontes = (fontes.data || []).filter((f) => !mapaFontes[f.id] || mapaFontes[f.id] === marca.id);
  const refsDaMarca = refs.filter((r) => mapaRefs[r.id] === marca.id).length;

  return (
    <div className="space-y-6" data-kit-da-marca={marca.id}>
      {/* Uma linha de estado; a explicação fica no "?" (28/09). */}
      <div className="flex min-w-0 items-center text-[12px] text-muted-foreground">
        <p className="min-w-0 truncate">
          Kit próprio da marca <strong className="text-foreground">{marca.nome}</strong>
        </p>
        <AjudaRecolhida className="ml-1" rotulo="Como o kit da marca vale">
          A mesma tela do kit do cliente, gravando só na {marca.nome}. Logo, cores, estilo, regras, tom, contexto, referências e fontes vêm só daqui:
          o que estiver vazio fica vazio e nunca usa o da outra marca. As artes, o mês e os agentes usam este kit enquanto a {marca.nome} estiver
          escolhida no topo.
        </AjudaRecolhida>
      </div>

      {/* Frente MC (29/09): o editor é o mesmo do cliente (ContextoMarca grava na marca aberta). */}
      <ContextoMarca />

      <Secao
        titulo={`Referências da ${marca.nome} (${refsDaMarca})`}
        recolher={`mesa:contexto:kit:${marca.id}:referencias:${clientId}`}
        resumo={`${refs.length} do cliente`}
        ajuda={`Marque as do cliente que valem para a ${marca.nome}: elas saem da marca principal. As enviadas com a ${marca.nome} escolhida já entram como dela.`}
        corpoClassName="space-y-2"
      >
        {(referencias.isLoading || vinculos.isLoading) && <p className="text-[12px] text-muted-foreground">Lendo referências...</p>}
        {vinculos.isError && <p className="text-[12px] text-destructive">Não foi possível ler as marcas das referências.</p>}
        {!referencias.isLoading && refs.length === 0 && <p className="text-[12px] text-muted-foreground">O cliente ainda não tem referência com imagem.</p>}
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {refs.map((r) => {
            const daMarca = mapaRefs[r.id] === marca.id;
            return (
              <li key={r.id} className={juntar(superficie.painel, "min-w-0 overflow-hidden", daMarca && "border-primary")}>
                <ImagemDaMesa caminho={r.imagem ? r.imagem.caminho : null} bucket={r.imagem ? r.imagem.bucket : "mesa"} alt={r.nome} className="h-20 w-full" />
                <label className="flex cursor-pointer items-center px-1.5 py-1 text-[11px]">
                  <input
                    type="checkbox"
                    className="mr-1.5 h-3.5 w-3.5 shrink-0"
                    checked={daMarca}
                    disabled={mudando === r.id || !vinculos.data}
                    onChange={(e) => void vincular("cliente_referencias", r.id, e.target.checked)}
                  />
                  <span className="min-w-0 truncate">{daMarca ? `Da ${marca.nome}` : "Do cliente"}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </Secao>

      {listaFontes.length > 0 && (
        <Secao
          titulo={`Fontes da ${marca.nome}`}
          recolher={`mesa:contexto:kit:${marca.id}:fontes:${clientId}`}
          resumo={`${listaFontes.filter((f) => mapaFontes[f.id] === marca.id).length} marcada(s)`}
          ajuda={`Só as marcadas valem para a ${marca.nome}. Sem nenhuma, o Estúdio avisa e oferece copiar as da principal num clique; nunca usa a letra da outra marca sozinho.`}
        >
          <ul className="space-y-1">
            {listaFontes.map((f) => {
              const daMarca = mapaFontes[f.id] === marca.id;
              return (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-center text-[12.5px]">
                    <input
                      type="checkbox"
                      className="mr-2 h-3.5 w-3.5 shrink-0"
                      checked={daMarca}
                      disabled={mudando === f.id || !vinculos.data}
                      onChange={(e) => void vincular("cliente_fontes", f.id, e.target.checked)}
                    />
                    <span className="min-w-0 truncate">
                      {f.nome} <span className="text-muted-foreground">· {f.papel}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Secao>
      )}
    </div>
  );
}
