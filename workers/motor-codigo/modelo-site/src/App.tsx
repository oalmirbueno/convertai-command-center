import { SECOES } from "./secoes";
import { useRolagemSuave } from "./lib/rolagem";

export default function App() {
  useRolagemSuave();
  return (
    <main className="min-h-screen bg-fundo font-texto text-texto antialiased">
      {SECOES.map(({ id, Componente }) => (
        <Componente key={id} />
      ))}
    </main>
  );
}
