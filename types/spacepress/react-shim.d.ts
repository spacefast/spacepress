// Lightweight React hook subset types for SpacePress-only projects that don't install @types/react.
// Projects that install react / @types/react use the real React types directly.

export type SetStateAction<S> = S | ((prevState: S) => S);
export type Dispatch<A> = (value: A) => void;
export type EffectCallback = () => void | (() => void);
export type DependencyList = readonly unknown[];

export interface RefObject<T> {
  readonly current: T | null;
}

export interface MutableRefObject<T> {
  current: T;
}

export declare function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
export declare function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
export declare function useEffect(effect: EffectCallback, deps?: DependencyList): void;
export declare function useRef<T = HTMLElement>(initialValue: T): MutableRefObject<T>;
export declare function useRef<T = HTMLElement>(initialValue?: T | null): RefObject<T>;
