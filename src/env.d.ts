/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface DomElementProps {
  onChange?: (e: { target: HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement; currentTarget: HTMLInputElement }) => void;
  onFocus?: (e: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void;
  onBlur?: (e: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void;
  onKeyDown?: (e: { key: string; target: EventTarget | null; preventDefault: () => void }) => void;
  onClick?: (e: { stopPropagation: () => void; preventDefault: () => void }) => void;
  onDoubleClick?: (e: { stopPropagation: () => void }) => void;
  [prop: string]: any;
}

declare namespace JSX {
  type Element = any;
  interface IntrinsicElements {
    [elemName: string]: DomElementProps;
  }
  interface IntrinsicAttributes {
    key?: any;
  }
}

declare module 'react' {
  export type ReactNode = any;
  export type SetStateAction<S> = S | ((prevState: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly any[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly any[]): T;
  export function useRef<T>(initialValue: T): { current: T };
  export function useRef<T>(initialValue: T | null): { current: T | null };
  export function useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T
  ): T;
  export const StrictMode: any;
  const React: {
    StrictMode: any;
    createElement: (...args: any[]) => any;
  };
  export default React;
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module 'react/jsx-dev-runtime' {
  export const jsxDEV: any;
  export const Fragment: any;
}

declare module 'react-dom/client' {
  export function createRoot(container: Element | DocumentFragment): {
    render(children: any): void;
    unmount(): void;
  };
  const ReactDOM: {
    createRoot: typeof createRoot;
  };
  export default ReactDOM;
}
