export type Child = VNode | string | number | boolean | null | undefined;

export type Props = {
  [key: string]: any;
  children?: Child | Child[];
};

export type VNode = {
  type: string | ((props: Props) => Child) | symbol;
  props: Props;
};

export const Fragment = Symbol.for('homura.fragment');

function createNode(type: VNode['type'], props: Props | null): VNode {
  return {
    type,
    props: props || {},
  };
}

export function jsx(type: VNode['type'], props: Props | null): VNode {
  return createNode(type, props);
}

export function jsxs(type: VNode['type'], props: Props | null): VNode {
  return createNode(type, props);
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}
