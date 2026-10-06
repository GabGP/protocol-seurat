import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { canRename, cleanName } from '../model/edit-work';
import { EditWorkForm, type EditWorkFormProps } from '../ui/EditWorkForm';

function createFormProps(overrides: Partial<EditWorkFormProps> = {}): EditWorkFormProps {
  return {
    name: 'Mona Lisa',
    onName: vi.fn(),
    canSave: true,
    busy: false,
    confirming: false,
    failed: false,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    ...overrides,
  };
}

describe('features/edit-work model', () => {
  describe('cleanName', () => {
    it('trims leading and trailing whitespace', () => {
      expect(cleanName('   A Sunday on La Grande Jatte   ')).toBe('A Sunday on La Grande Jatte');
      expect(cleanName('\t\nMasterpiece\n ')).toBe('Masterpiece');
    });
  });

  describe('canRename', () => {
    it('rejects empty strings', () => {
      expect(canRename('', 'Original')).toBe(false);
    });

    it('rejects spaces only', () => {
      expect(canRename('     ', 'Original')).toBe(false);
      expect(canRename('\t \n', 'Original')).toBe(false);
    });

    it('rejects unchanged name', () => {
      expect(canRename('Original', 'Original')).toBe(false);
      expect(canRename('  Original  ', 'Original')).toBe(false);
    });

    it('accepts name up to 120 characters', () => {
      const name120 = 'x'.repeat(120);
      expect(canRename(name120, 'Original')).toBe(true);
    });

    it('rejects name of 121 characters or more', () => {
      const name121 = 'x'.repeat(121);
      expect(canRename(name121, 'Original')).toBe(false);
    });

    it('accepts valid distinct name', () => {
      expect(canRename('Different Name', 'Original')).toBe(true);
    });
  });
});

describe('EditWorkForm component', () => {
  it('shows Save and Delete work by default', () => {
    const html = renderToString(<EditWorkForm {...createFormProps()} />);
    expect(html).toContain('Save');
    expect(html).toContain('Delete work');
    expect(html).not.toContain('Delete this work for every viewer? This cannot be undone.');
    expect(html).not.toContain('Cancel');
    expect(html).not.toContain('Could not apply the change. Try again.');
  });

  it('disables Save when canSave is false', () => {
    const html = renderToString(<EditWorkForm {...createFormProps({ canSave: false })} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Save[^<]*<\/button>/);
  });

  it('enables Save when canSave is true and not busy', () => {
    const html = renderToString(<EditWorkForm {...createFormProps({ canSave: true, busy: false })} />);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>[^<]*Save[^<]*<\/button>/);
  });

  it('shows confirm text and Cancel when confirming', () => {
    const html = renderToString(<EditWorkForm {...createFormProps({ confirming: true })} />);
    expect(html).toContain('Delete this work for every viewer? This cannot be undone.');
    expect(html).toContain('Cancel');
    expect(html).toContain('Delete');
    expect(html).not.toContain('Delete work');
  });

  it('shows failure line when failed is true', () => {
    const html = renderToString(<EditWorkForm {...createFormProps({ failed: true })} />);
    expect(html).toContain('Could not apply the change. Try again.');
  });
});
