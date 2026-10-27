import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, Expand, Loader2, Minus, Plus, X } from "lucide-react";

export default function VisualizadorDaArte({ url, alt, titulo, baixando, aoBaixar, children }: { url: string; alt: string; titulo: string; baixando: boolean; aoBaixar: () => void; children: ReactNode }) {
  const [zoom, setZoom] = useState(false);
  return <Dialog.Root onOpenChange={(aberto) => { if (!aberto) setZoom(false); }}>
    <Dialog.Trigger asChild><button type="button" className="bolso-arte-ampliar" aria-label={`Ampliar arte: ${titulo}`}>{children}<span className="bolso-arte-ampliar-selo"><Expand size={15} aria-hidden="true" />Ampliar</span></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="bolso-arte-dialogo-fundo" /><Dialog.Content className="bolso-arte-dialogo">
      <header className="bolso-arte-dialogo-topo"><div><Dialog.Title>{titulo}</Dialog.Title><Dialog.Description>A imagem completa, sem cortes.</Dialog.Description></div><Dialog.Close asChild><button type="button" className="membros-acao" aria-label="Fechar arte ampliada"><X size={22} aria-hidden="true" /></button></Dialog.Close></header>
      <div className="bolso-arte-dialogo-quadro" data-zoom={zoom || undefined}><img src={url} alt={alt} /></div>
      <footer className="bolso-arte-dialogo-acoes"><button type="button" className="membros-acao border border-border" aria-pressed={zoom} onClick={() => setZoom((atual) => !atual)}>{zoom ? <Minus size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}{zoom ? "Ajustar à tela" : "Ver tamanho original"}</button><button type="button" className="membros-acao bg-primary text-primary-foreground" disabled={baixando} onClick={aoBaixar}>{baixando ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}Baixar arte</button></footer>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
