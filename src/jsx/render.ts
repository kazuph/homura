import { Fragment, VNode, Props } from './jsx-runtime';

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function styleToString(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => `${toKebabCase(key)}:${value}`)
    .join(';');
}

function renderAttributes(props: Props): string {
  const entries = Object.entries(props)
    .filter(([key]) => key !== 'children' && key !== 'dangerouslySetInnerHTML')
    .map(([key, value]) => {
      if (value === false || value === null || value === undefined) return '';
      const attrKey = key === 'className' ? 'class' : key === 'htmlFor' ? 'for' : key;
      if (value === true) return `${attrKey}`;
      if (key === 'style' && typeof value === 'object') {
        return `${attrKey}="${escapeHtml(styleToString(value))}"`;
      }
      return `${attrKey}="${escapeHtml(String(value))}"`;
    })
    .filter(Boolean);

  return entries.length ? ` ${entries.join(' ')}` : '';
}

function normalizeChildren(children: Props['children']): Array<unknown> {
  if (children === null || children === undefined) return [];
  return Array.isArray(children) ? children : [children];
}

export function renderToString(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(renderToString).join('');
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(String(node));

  const vnode = node as VNode;
  if (typeof vnode.type === 'function') {
    return renderToString(vnode.type(vnode.props));
  }

  if (vnode.type === Fragment) {
    return normalizeChildren(vnode.props?.children).map(renderToString).join('');
  }

  if (typeof vnode.type === 'string') {
    const props = vnode.props || {};
    const attributes = renderAttributes(props);
    const rawHtml = props.dangerouslySetInnerHTML?.__html;
    const children = rawHtml !== undefined
      ? String(rawHtml)
      : normalizeChildren(props.children).map(renderToString).join('');

    if (VOID_ELEMENTS.has(vnode.type)) {
      return `<${vnode.type}${attributes}>`;
    }
    return `<${vnode.type}${attributes}>${children}</${vnode.type}>`;
  }

  return '';
}
