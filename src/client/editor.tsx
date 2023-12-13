import { createRoot } from "react-dom/client";
import { useRef, useEffect } from "react";
import { GameState } from "./game";

interface EditorProps {
  game: { state: GameState; canvas: HTMLCanvasElement };
}

function Editor({ game }: EditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.appendChild(game.canvas);
    }
    return () => {
      if (canvasRef.current) {
        canvasRef.current.removeChild(game.canvas);
      }
    };
  }, [game.state]);

  return <div ref={canvasRef}></div>;
}

export function onMount(
  game: { state: GameState; canvas: HTMLCanvasElement },
  container: HTMLElement
) {
  const root = createRoot(container);
  root.render(<Editor game={game} />);
}
