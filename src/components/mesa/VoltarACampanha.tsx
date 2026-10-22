import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { botao, juntar } from "@/components/sistema";
import { useMesa } from "./MesaContexto";
import { chavesDaArteRapida, lerArteRapida } from "./arteRapidaApi";
import { arteRapidaDa } from "../../../supabase/functions/estudio-arte/modulos/arte-rapida";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Voltar à campanha" no Estúdio (22/10/2026): a arte rápida que é peça de uma campanha (campanha_id) ganha um
 * atalho de volta para a campanha aberta; lá a peça aparece com a arte e o estado lidos de novo.
 */
export default function VoltarACampanha({ trabalhoId }: { trabalhoId: string | null }) {
  const { clientId } = useMesa();
  const [params, setParams] = useSearchParams();
  const valido = !!trabalhoId && UUID.test(trabalhoId);
  const um = useQuery({
    queryKey: chavesDaArteRapida.um(clientId, trabalhoId || ""),
    enabled: valido,
    staleTime: 30_000,
    queryFn: () => lerArteRapida(clientId, trabalhoId as string),
  });
  const a = um.data ? arteRapidaDa(um.data.direcao) : null;
  if (!valido || !a || !a.campanha_id) return null;
  const campanhaId = a.campanha_id;
  return (
    <button
      type="button"
      className={juntar(botao.icone, "mb-1 mt-1 text-primary hover:text-primary")}
      onClick={() => {
        const p = new URLSearchParams(params.toString());
        p.set("aba", "campanhas");
        p.set("campanha", campanhaId);
        p.delete("rapida");
        p.delete("fotos");
        setParams(p);
      }}
      aria-label="Voltar à campanha"
      title="Voltar à campanha desta peça"
      data-voltar-a-campanha={campanhaId}
    >
      <Megaphone className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
