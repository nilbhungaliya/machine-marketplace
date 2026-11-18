import { describe, expect, it } from 'vitest';
import { CATEGORY_ICONS } from '@mpm/shared-types';
import { CATEGORY_ICON_COMPONENTS } from './category-icons';

describe('CATEGORY_ICON_COMPONENTS', () => {
  it('maps every category icon key to a lucide component', () => {
    for (const key of CATEGORY_ICONS) {
      const Icon = CATEGORY_ICON_COMPONENTS[key];
      expect(Icon, key).toBeTruthy();
      // lucide-react components are forwardRef objects
      expect(['function', 'object']).toContain(typeof Icon);
    }
    expect(Object.keys(CATEGORY_ICON_COMPONENTS).sort()).toEqual([...CATEGORY_ICONS].sort());
  });
});
