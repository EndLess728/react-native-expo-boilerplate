import { notifications } from './notifications.js';
import type { ModuleGenerator } from './types.js';

/** Every module `add` can generate. Add new ones here. */
export const MODULES: Record<string, ModuleGenerator> = {
  [notifications.name]: notifications,
};
