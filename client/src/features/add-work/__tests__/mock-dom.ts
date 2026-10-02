export interface MockNode {
  nodeType: number;
  tagName: string;
  style: Record<string, string>;
  childNodes: MockNode[];
  parentNode: MockNode | null;
  ownerDocument: MockDoc | null;
  textContent: string;
  data?: string;
  attributes: Map<string, string>;
  appendChild(c: MockNode): MockNode;
  removeChild(c: MockNode): MockNode;
  insertBefore(c: MockNode, r?: MockNode | null): MockNode;
  setAttribute(k: string, v: string): void;
  removeAttribute(k: string): void;
  getAttribute(k: string): string | null;
  addEventListener(t: string, h: (e: any) => void): void;
  removeEventListener(t: string, h: (e: any) => void): void;
  dispatchEvent(ev: any): void;
  focus(): void;
}

export interface MockDoc {
  nodeType: number;
  documentElement: MockNode;
  body: MockNode;
  createElement(tag: string): MockNode;
  createElementNS(ns: string, tag: string): MockNode;
  createTextNode(t: string): MockNode;
  createComment(t: string): MockNode;
  addEventListener(t: string, h: (e: any) => void): void;
  removeEventListener(t: string, h: (e: any) => void): void;
  dispatchEvent(ev: any): void;
}

export function createMockEnvironment(): { doc: MockDoc; cleanup: () => void } {
  (globalThis as any).HTMLIFrameElement = class {};
  (globalThis as any).HTMLElement = class {};
  (globalThis as any).Element = class {};
  (globalThis as any).Node = class {};

  const docListeners = new Map<string, ((e: any) => void)[]>();

  function makeElem(tag = 'div'): MockNode {
    const listeners = new Map<string, ((e: any) => void)[]>();
    const attributes = new Map<string, string>();
    const e: MockNode = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      style: {},
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      textContent: '',
      attributes,
      appendChild(c) {
        this.childNodes.push(c);
        c.parentNode = this;
        return c;
      },
      removeChild(c) {
        this.childNodes = this.childNodes.filter((x) => x !== c);
        c.parentNode = null;
        return c;
      },
      insertBefore(c) {
        this.childNodes.push(c);
        c.parentNode = this;
        return c;
      },
      setAttribute(k, v) {
        attributes.set(k, String(v));
      },
      removeAttribute(k) {
        attributes.delete(k);
      },
      getAttribute(k) {
        return attributes.get(k) ?? null;
      },
      addEventListener(t, h) {
        if (!listeners.has(t)) listeners.set(t, []);
        listeners.get(t)!.push(h);
      },
      removeEventListener(t, h) {
        if (listeners.has(t)) listeners.set(t, listeners.get(t)!.filter((x) => x !== h));
      },
      dispatchEvent(ev) {
        listeners.get(ev.type)?.forEach((h) => h(ev));
      },
      focus() {},
    };
    return e;
  }

  const docElem = makeElem('html');
  const body = makeElem('body');
  const doc: MockDoc = {
    nodeType: 9,
    documentElement: docElem,
    body,
    createElement(tag) {
      const el = makeElem(tag);
      el.ownerDocument = doc;
      return el;
    },
    createElementNS(_ns, tag) {
      const el = makeElem(tag);
      el.ownerDocument = doc;
      return el;
    },
    createTextNode(t) {
      const n = makeElem('text');
      n.nodeType = 3;
      n.textContent = t;
      n.data = t;
      n.ownerDocument = doc;
      return n;
    },
    createComment(t) {
      const n = makeElem('comment');
      n.nodeType = 8;
      n.textContent = t;
      n.ownerDocument = doc;
      return n;
    },
    addEventListener(t, h) {
      if (!docListeners.has(t)) docListeners.set(t, []);
      docListeners.get(t)!.push(h);
    },
    removeEventListener(t, h) {
      if (docListeners.has(t)) docListeners.set(t, docListeners.get(t)!.filter((x) => x !== h));
    },
    dispatchEvent(ev) {
      docListeners.get(ev.type)?.forEach((h) => h(ev));
    },
  };

  docElem.ownerDocument = doc;
  body.ownerDocument = doc;
  (doc as any).defaultView = globalThis;

  const originalDoc = (globalThis as any).document;
  const originalWin = (globalThis as any).window;
  (globalThis as any).document = doc;
  (globalThis as any).window = globalThis;

  return {
    doc,
    cleanup() {
      (globalThis as any).document = originalDoc;
      (globalThis as any).window = originalWin;
    },
  };
}

export function textOf(node: MockNode): string {
  let s = node.textContent || node.data || '';
  for (const child of node.childNodes) {
    s += ' ' + textOf(child);
  }
  return s;
}

export function findNode(
  node: MockNode,
  predicate: (n: MockNode) => boolean
): MockNode | null {
  if (predicate(node)) return node;
  for (const child of node.childNodes) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}
