import { AjudaRecolhida } from "@/components/sistema";
import { useFontesDoCliente, useKitDoCliente } from "./contextoDoCliente";

/**
 * Aviso do kit na referência (frente R, 26/09). Sem fonte ou sem cor válida no
 * kit, o modo replicar usa a letra ou as cores da referência (não há as do
 * cliente para usar; decisão do dono, o prompt fica como está). O link leva ao
 * Contexto, onde a fonte é definida (ou sugerida da biblioteca pelo Jev,
 * "Sugerir automaticamente") e a paleta é montada. Kit completo, ou antes de
 * a leitura chegar: nada aparece. Export antigo mantido (EstudioAvisoSemFonte).
 */
export const TEXTO_SEM_FONTE = "Cliente sem fonte no kit: usando a da referência.";
export const TEXTO_SEM_CORES = "Cliente sem cores no kit: usando as da referência.";

/** Igual ao servidor (hexOk): só #RRGGBB conta como cor do kit. */
export function kitSemCor(kit: { paleta?: unknown } | null | undefined): boolean {
  const paleta = kit && Array.isArray(kit.paleta) ? (kit.paleta as { hex?: unknown }[]) : [];
  return !paleta.some((p) => !!p && typeof p.hex === "string" && /^#[0-9a-f]{6}$/i.test(p.hex.trim()));
}

function Linha({ texto, clientId, ajuda }: { texto: string; clientId: string; ajuda: string }) {
  return (
    <p className="flex min-w-0 items-center text-[10.5px] leading-snug text-muted-foreground">
      <span className="min-w-0 truncate">{texto}</span>
      <a href={`/mesa?client=${encodeURIComponent(clientId)}&aba=contexto`} className="ml-1 shrink-0 text-primary underline-offset-2 hover:underline">
        Definir no Contexto
      </a>
      <AjudaRecolhida rotulo="Por que aparece este aviso">{ajuda}</AjudaRecolhida>
    </p>
  );
}

export function EstudioAvisoDoKit({ clientId }: { clientId: string }) {
  const fontes = useFontesDoCliente(clientId);
  const kit = useKitDoCliente(clientId);
  const semFonte = !!fontes.data && fontes.data.length === 0;
  const semCor = kit.isSuccess && kitSemCor(kit.data as { paleta?: unknown } | null);
  if (!semFonte && !semCor) return null;
  return (
    <div className="min-w-0" data-aviso="kit-incompleto">
      {semFonte && (
        <Linha
          texto={TEXTO_SEM_FONTE}
          clientId={clientId}
          ajuda="O kit da marca não tem fonte. A letra segue a hierarquia da referência, mas o desenho vem dela. Em Contexto, na marca, envie a fonte ou use Sugerir automaticamente."
        />
      )}
      {semCor && (
        <Linha
          texto={TEXTO_SEM_CORES}
          clientId={clientId}
          ajuda="O kit da marca não tem cor. Sem paleta, as cores da referência ficam. Em Contexto, na marca, monte a paleta para a arte usar as cores do cliente."
        />
      )}
    </div>
  );
}

export default EstudioAvisoDoKit;
export { EstudioAvisoDoKit as EstudioAvisoSemFonte };
