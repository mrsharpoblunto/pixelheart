import { useEffect, useContext, createContext, useRef, CSSProperties } from 'react';

interface CanvasListContext {
  canvases: Map<string, HTMLCanvasElement>;
}

const CanvasListContext = createContext<CanvasListContext>({
  canvases: new Map(),
});

export interface CanvasListProps {
  canvases: Map<string, HTMLCanvasElement>;
  render: (key: string, canvas: React.ReactElement) => React.ReactElement;
  style: CSSProperties;
  items: Array<string>;
}

interface CanvasListItemProps {
  key: string;
  render: (key: string, canvas: React.ReactElement) => React.ReactElement;
  parentRef: React.MutableRefObject<HTMLUListElement | null>;
}

export function VirtualizedCanvasList(props: CanvasListProps) {
  const containerRef = useRef<HTMLUListElement | null>(null);
  return <CanvasListContext.Provider value={{ canvases: props.canvases }}>
    <ul style={props.style} ref={containerRef}>
      {props.items.map(i => <VirtualizedCanvasListItem key={i} render={props.render} parentRef={containerRef} />)}
    </ul>
  </CanvasListContext.Provider>
}

function VirtualizedCanvasListItem(props: CanvasListItemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const listContext = useContext(CanvasListContext);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
    (entries) => {
      const [entry] = entries;
      if (entry.isIntersecting) {
        listContext.canvases.set(props.key, canvasRef.current!);
      } else {
        listContext.canvases.delete(props.key);
      }
    }, {
      root: props.parentRef.current, 
    });

    observerRef.current.observe(canvasRef.current!);

    return () => {
      observerRef.current?.disconnect();
    }
  }, [props.parentRef, canvasRef]);

  const canvas = <canvas ref={canvasRef} />;

  return props.render(props.key, canvas);
}
