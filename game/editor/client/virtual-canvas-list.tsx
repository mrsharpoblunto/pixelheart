import {
  CSSProperties,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface CanvasListContext {
  canvases: Map<string, HTMLCanvasElement>;
}

const CanvasListContext = createContext<CanvasListContext>({
  canvases: new Map(),
});

export interface CanvasListProps {
  canvases: Map<string, HTMLCanvasElement>;
  className?: string;
  style?: CSSProperties;
  itemTemplate: React.ForwardRefExoticComponent<
    React.PropsWithoutRef<{
      id: string;
      onClick: () => void;
      isVisible: boolean;
      isSelected: boolean;
    }> &
      React.RefAttributes<HTMLCanvasElement>
  >;
  onItemClick: (id: string) => void;
  selectedItem: string | null;
  items: Array<string>;
}

export function VirtualizedCanvasList(props: CanvasListProps) {
  const containerRef = useRef<HTMLUListElement | null>(null);
  return (
    <CanvasListContext.Provider value={{ canvases: props.canvases }}>
      <ul className={props.className} style={props.style} ref={containerRef}>
        {props.items.map((i) => (
          <VirtualizedCanvasListItem
            key={i}
            id={i}
            onClick={props.onItemClick}
            render={props.itemTemplate}
            parentRef={containerRef}
            isSelected={i === props.selectedItem}
          />
        ))}
      </ul>
    </CanvasListContext.Provider>
  );
}

interface CanvasListItemProps {
  id: string;
  render: React.ForwardRefExoticComponent<
    React.PropsWithoutRef<{
      id: string;
      isVisible: boolean;
      isSelected: boolean;
      onClick: () => void;
    }> &
      React.RefAttributes<HTMLCanvasElement>
  >;
  onClick: (id: string) => void;
  isSelected: boolean;
  parentRef: React.MutableRefObject<HTMLUListElement | null>;
}

function VirtualizedCanvasListItem(props: CanvasListItemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const listContext = useContext(CanvasListContext);
  const [isVisible, setVisible] = useState(false);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          listContext.canvases.set(props.id, canvasRef.current!);
          setVisible(true);
        } else {
          listContext.canvases.delete(props.id);
          setVisible(false);
        }
      },
      {
        root: props.parentRef.current,
      }
    );

    observerRef.current.observe(canvasRef.current!);

    return () => {
      listContext.canvases.delete(props.id);
      observerRef.current?.disconnect();
    };
  }, [props.parentRef, canvasRef]);

  const onClick = useCallback(() => props.onClick(props.id), [props.id]);

  return (
    <props.render
      id={props.id}
      onClick={onClick}
      isVisible={isVisible}
      isSelected={props.isSelected}
      ref={canvasRef}
    />
  );
}
