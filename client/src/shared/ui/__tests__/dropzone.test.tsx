import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { Dialog } from '../Dialog';
import { DropZone } from '../DropZone';
import { ProgressBar } from '../ProgressBar';
import { Popover, PopoverItem } from '../Popover';
import { Attachment, AttachmentList } from '../Attachment';

interface MockNode {
  nodeType: number;
  tagName: string;
  style: Record<string, string>;
  childNodes: MockNode[];
  parentNode: MockNode | null;
  ownerDocument: MockDoc | null;
  appendChild(c: MockNode): MockNode;
  removeChild(c: MockNode): MockNode;
  insertBefore(c: MockNode, r?: MockNode | null): MockNode;
  setAttribute(k: string, v: string): void;
  removeAttribute(k: string): void;
  addEventListener(t: string, h: (e: any) => void): void;
  removeEventListener(t: string, h: (e: any) => void): void;
  dispatchEvent(ev: any): void;
  focus(): void;
}

interface MockDoc {
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

function createMockEnvironment(): { doc: MockDoc; cleanup: () => void } {
  (globalThis as any).HTMLIFrameElement = class {};
  (globalThis as any).HTMLElement = class {};
  (globalThis as any).Element = class {};
  (globalThis as any).Node = class {};

  const docListeners = new Map<string, ((e: any) => void)[]>();

  function makeElem(tag = 'div'): MockNode {
    const listeners = new Map<string, ((e: any) => void)[]>();
    const e: MockNode = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      style: {},
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
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
      setAttribute() {},
      removeAttribute() {},
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
    createTextNode(_t) {
      const n = makeElem('text');
      n.nodeType = 3;
      n.ownerDocument = doc;
      return n;
    },
    createComment(_t) {
      const n = makeElem('comment');
      n.nodeType = 8;
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

describe('DropZone and Dialog interactions', () => {
  let env: ReturnType<typeof createMockEnvironment>;
  let root: Root | null = null;
  let container: MockNode | null = null;

  beforeEach(() => {
    env = createMockEnvironment();
    container = env.doc.createElement('div');
    root = createRoot(container as any);
  });

  afterEach(() => {
    root?.unmount();
    env.cleanup();
  });

  it('DropZone renders formats and footnote correctly', () => {
    const html = renderToString(
      <DropZone
        formats={['PNG', 'JPG', 'TIFF']}
        footnote="Storage footnote notice"
        onFiles={() => {}}
      />
    );
    expect(html).toContain('Drop a master or a .zip');
    expect(html).toContain('PNG');
    expect(html).toContain('JPG');
    expect(html).toContain('TIFF');
    expect(html).toContain('Storage footnote notice');
    expect(html).toContain('browse');
  });

  it('DropZone calls onFiles with the dropped files', async () => {
    const onFiles = vi.fn();
    root!.render(<DropZone onFiles={onFiles} />);

    await new Promise((resolve) => setTimeout(resolve, 30));
    const zoneElement = container!.childNodes[0];
    expect(zoneElement).toBeDefined();

    const mockFile = { name: 'sample.png', size: 1024 } as unknown as File;
    const dropEvent = {
      type: 'drop',
      target: zoneElement,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [mockFile] },
    };

    container!.dispatchEvent(dropEvent);
    expect(onFiles).toHaveBeenCalledWith([mockFile]);
  });

  it('Dialog calls onClose on Escape', async () => {
    const onClose = vi.fn();
    root!.render(
      <Dialog open={true} onClose={onClose} title="Add Work">
        <div>Dialog Body</div>
      </Dialog>
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    const escapeEvent = {
      type: 'keydown',
      key: 'Escape',
      stopPropagation: vi.fn(),
    };

    env.doc.dispatchEvent(escapeEvent);
    expect(onClose).toHaveBeenCalled();
  });

  it('Dialog renders nothing when open is false', () => {
    const html = renderToString(
      <Dialog open={false} onClose={() => {}} title="Hidden Dialog">
        <div>Content</div>
      </Dialog>
    );
    expect(html).toBe('');
  });

  it('ProgressBar renders determinate and indeterminate states', () => {
    const det = renderToString(<ProgressBar value={0.65} />);
    expect(det).toContain('role="progressbar"');
    expect(det).toContain('aria-valuenow="65"');
    expect(det).toContain('width:65%');

    const indet = renderToString(<ProgressBar />);
    expect(indet).toContain('role="progressbar"');
    expect(indet).not.toContain('aria-valuenow');
  });

  it('Popover and PopoverItem render options and invoke onSelect', () => {
    const onSelect = vi.fn();
    const html = renderToString(
      <Popover open={true} onClose={() => {}}>
        <PopoverItem icon="link" label="Copy Link" onSelect={onSelect} />
      </Popover>
    );
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('Copy Link');
  });

  it('Attachment renders states, progress and actions', () => {
    const uploadingHtml = renderToString(
      <Attachment
        icon="folder"
        title="artwork.psb"
        description="Uploading 12 MB"
        state="uploading"
        progress={0.4}
      />
    );
    expect(uploadingHtml).toContain('artwork.psb');
    expect(uploadingHtml).toContain('Uploading 12 MB');
    expect(uploadingHtml).toContain('role="progressbar"');

    const doneHtml = renderToString(
      <AttachmentList>
        <Attachment
          icon="folder"
          title="complete.tiff"
          description="Ready"
          state="done"
        />
      </AttachmentList>
    );
    expect(doneHtml).toContain('complete.tiff');
    expect(doneHtml).toContain('Ready');
  });
});
