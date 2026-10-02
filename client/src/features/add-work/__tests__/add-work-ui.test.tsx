import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { AddWorkButton } from '../ui/AddWorkButton';
import { AddWorkDialog } from '../ui/AddWorkDialog';
import {
  createMockEnvironment,
  findNode,
  textOf,
  type MockDoc,
  type MockNode,
} from './mock-dom';

describe('AddWork UI', () => {
  let env: { doc: MockDoc; cleanup: () => void };
  let container: MockNode;
  let root: Root;

  beforeEach(() => {
    env = createMockEnvironment();
    container = env.doc.createElement('div');
    env.doc.body.appendChild(container);
    root = createRoot(container as any);
  });

  afterEach(() => {
    root?.unmount();
    env.cleanup();
  });

  const dummyTransfer = {
    upload: vi.fn().mockResolvedValue(undefined),
    importSource: vi.fn().mockResolvedValue(undefined),
  };

  it('clicking Add shows the menu', async () => {
    root.render(
      <AddWorkButton
        works={[]}
        local={false}
        transfer={dummyTransfer}
        onOpen={vi.fn()}
      />
    );

    await new Promise((r) => setTimeout(r, 30));
    const btn = findNode(container, (n) => n.tagName === 'BUTTON');
    expect(btn).not.toBeNull();
    expect(textOf(container)).not.toContain('Upload file');

    container.dispatchEvent({
      type: 'click',
      target: btn,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(textOf(container)).toContain('Upload file');
    expect(textOf(container)).toContain('From link');
    expect(findNode(container, (n) => n.getAttribute('role') === 'menu')).not.toBeNull();
  });

  it('From this computer only appears when local is true', async () => {
    root.render(
      <AddWorkButton
        works={[]}
        local={false}
        transfer={dummyTransfer}
        onOpen={vi.fn()}
      />
    );

    await new Promise((r) => setTimeout(r, 30));
    const btnRemote = findNode(container, (n) => n.tagName === 'BUTTON');
    container.dispatchEvent({
      type: 'click',
      target: btnRemote,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(textOf(container)).not.toContain('From this computer');

    root.unmount();
    const containerLocal = env.doc.createElement('div');
    env.doc.body.appendChild(containerLocal);
    const rootLocal = createRoot(containerLocal as any);

    rootLocal.render(
      <AddWorkButton
        works={[]}
        local={true}
        transfer={dummyTransfer}
        onOpen={vi.fn()}
      />
    );

    await new Promise((r) => setTimeout(r, 30));
    const btnLocal = findNode(containerLocal, (n) => n.tagName === 'BUTTON');
    containerLocal.dispatchEvent({
      type: 'click',
      target: btnLocal,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(textOf(containerLocal)).toContain('From this computer');
    rootLocal.unmount();
  });

  it('adding an unsupported file through the FileTab shows Not a supported image', async () => {
    root.render(
      <AddWorkDialog
        open={true}
        initialTab="file"
        works={[]}
        local={false}
        transfer={dummyTransfer}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    await new Promise((r) => setTimeout(r, 30));
    const dropTarget = findNode(
      env.doc.body,
      (n) => n.getAttribute('aria-label') === 'Drop a master or browse files'
    );
    expect(dropTarget).not.toBeNull();

    const badFile = { name: 'document.pdf', size: 1024 } as unknown as File;
    env.doc.body.dispatchEvent({
      type: 'drop',
      target: dropTarget,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [badFile] },
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(textOf(env.doc.body)).toContain('Not a supported image');
  });

  it('a fake transfer.upload that resolves makes the row move past sending', async () => {
    let resolveUpload!: () => void;
    const upload = vi.fn().mockImplementation((_file, onProgress) => {
      onProgress(50, 100);
      return new Promise<void>((res) => {
        resolveUpload = res;
      });
    });

    const transfer = {
      upload,
      importSource: vi.fn().mockResolvedValue(undefined),
    };

    root.render(
      <AddWorkDialog
        open={true}
        initialTab="file"
        works={[]}
        local={false}
        transfer={transfer}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    await new Promise((r) => setTimeout(r, 30));
    const dropTarget = findNode(
      env.doc.body,
      (n) => n.getAttribute('aria-label') === 'Drop a master or browse files'
    );
    expect(dropTarget).not.toBeNull();

    const goodFile = { name: 'master.png', size: 2048 } as unknown as File;
    env.doc.body.dispatchEvent({
      type: 'drop',
      target: dropTarget,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [goodFile] },
    });

    await new Promise((r) => setTimeout(r, 40));
    expect(upload).toHaveBeenCalled();
    expect(textOf(env.doc.body)).toContain('Sending 50%');

    resolveUpload();
    await new Promise((r) => setTimeout(r, 40));
    const bodyText = textOf(env.doc.body);
    expect(bodyText).not.toContain('Sending');
    // Accepted, but no OBRA for it yet: it waits in the server ingest line.
    expect(bodyText).toContain('Queued on the server');
  });
});
