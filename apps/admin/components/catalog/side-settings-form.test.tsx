import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SIDE_CONVENTION, type CatalogLevel, type CategoryNode } from '@mpm/shared-types';
import { SideSettingsForm } from './side-settings-form';

afterEach(cleanup);

function node(id: string, name: string, level: CatalogLevel, over: Partial<CategoryNode> = {}): CategoryNode {
  return {
    id, parentId: null, level, name, slug: id, path: id, icon: null, sortOrder: 0, isActive: true,
    hasSides: null, sideConvention: null, effectiveHasSides: false, effectiveSideConvention: DEFAULT_SIDE_CONVENTION,
    children: [], ...over,
  };
}

const sewing = node('sewing', 'Sewing', 'machine_category');
const multi = node('multi', 'Multi Head Embroidery', 'machine_type', {
  parentId: 'sewing', hasSides: true, effectiveHasSides: true,
  sideConvention: 'Seen from the front panel', effectiveSideConvention: 'Seen from the front panel',
});

const sidesGroup = () => screen.getByRole('group', { name: 'Parts here have sides' });
const conventionGroup = () => screen.getByRole('group', { name: 'Side convention' });

describe('SideSettingsForm', () => {
  it('Inherit shows the effective value and where it comes from', () => {
    const hooks = node('hooks', 'Rotary Hooks', 'part_group', {
      parentId: 'multi', effectiveHasSides: true, effectiveSideConvention: 'Seen from the front panel',
    });
    render(<SideSettingsForm node={hooks} ancestors={[sewing, multi]} onSave={vi.fn()} />);
    const sides = sidesGroup();
    expect((within(sides).getByRole('radio', { name: 'Inherit' }) as HTMLInputElement).checked).toBe(true);
    expect(within(sides).getByText('Yes, from Multi Head Embroidery')).not.toBeNull();
    expect(within(conventionGroup()).getByText('Seen from the front panel')).not.toBeNull();
  });

  it('with nothing set above, Inherit shows the default', () => {
    render(<SideSettingsForm node={sewing} ancestors={[]} onSave={vi.fn()} />);
    expect(within(sidesGroup()).getByText('No (default)')).not.toBeNull();
    expect(within(conventionGroup()).getByText(DEFAULT_SIDE_CONVENTION)).not.toBeNull();
  });

  it('choosing Inherit submits hasSides: null', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const lock = node('lock', 'Lockstitch', 'machine_type', { parentId: 'sewing', hasSides: false });
    render(<SideSettingsForm node={lock} ancestors={[sewing]} onSave={onSave} />);
    expect((within(sidesGroup()).getByRole('radio', { name: 'No' }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(sidesGroup()).getByRole('radio', { name: 'Inherit' }));
    await user.click(screen.getByRole('button', { name: 'Save side settings' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ hasSides: null, sideConvention: null }));
  });

  it('own convention submits the trimmed text', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const hooks = node('hooks', 'Rotary Hooks', 'part_group', { parentId: 'multi', effectiveHasSides: true });
    render(<SideSettingsForm node={hooks} ancestors={[sewing, multi]} onSave={onSave} />);
    await user.click(within(conventionGroup()).getByRole('radio', { name: 'Own text' }));
    await user.type(within(conventionGroup()).getByRole('textbox', { name: 'Own side convention' }), '  From the hook side  ');
    await user.click(screen.getByRole('button', { name: 'Save side settings' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ hasSides: null, sideConvention: 'From the hook side' }));
  });

  it('own convention needs some text', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SideSettingsForm node={sewing} ancestors={[]} onSave={onSave} />);
    await user.click(within(conventionGroup()).getByRole('radio', { name: 'Own text' }));
    await user.click(screen.getByRole('button', { name: 'Save side settings' }));
    expect(await screen.findByText(/enter the convention/i)).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
});
