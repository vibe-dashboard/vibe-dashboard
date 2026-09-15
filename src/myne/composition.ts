import type { ComponentType } from "react";

export interface RegisteredComponent<Slot extends string, Props = unknown> {
  readonly slot: Slot;
  readonly contractVersion: number;
  readonly component: ComponentType<Props>;
}

export interface CompositionRegistry<
  LayoutProps,
  ComponentProps,
  Slot extends string,
  LayoutId extends string,
  ComponentId extends string,
> {
  readonly surface: string;
  readonly version: 1;
  readonly requiredSlots: readonly Slot[];
  readonly layouts: Readonly<Record<LayoutId, ComponentType<LayoutProps>>>;
  readonly components: Readonly<Record<ComponentId, RegisteredComponent<Slot, ComponentProps>>>;
}

export interface CompositionManifest<
  Slot extends string,
  LayoutId extends string,
  ComponentId extends string,
> {
  readonly surface: string;
  readonly version: 1;
  readonly layout: LayoutId;
  readonly slots: Readonly<{ [S in Slot]: {
    readonly slot: S;
    readonly component: ComponentId;
    readonly contractVersion: number;
  } }>;
  readonly viewPackId?: string;
}

export function createCompositionRegistry<
  LayoutProps,
  ComponentProps,
  Slot extends string,
  LayoutId extends string,
  ComponentId extends string,
>(
  registry: CompositionRegistry<LayoutProps, ComponentProps, Slot, LayoutId, ComponentId>,
): CompositionRegistry<LayoutProps, ComponentProps, Slot, LayoutId, ComponentId> {
  if (new Set(registry.requiredSlots).size !== registry.requiredSlots.length) {
    throw new Error(`Composition registry ${registry.surface} contains duplicate required slots.`);
  }
  return Object.freeze({
    ...registry,
    requiredSlots: Object.freeze([...registry.requiredSlots]),
    layouts: Object.freeze({ ...registry.layouts }),
    components: Object.freeze({ ...registry.components }),
  });
}

export function resolveComposition<
  LayoutProps,
  ComponentProps,
  Slot extends string,
  LayoutId extends string,
  ComponentId extends string,
>(
  registry: CompositionRegistry<LayoutProps, ComponentProps, Slot, LayoutId, ComponentId>,
  manifest: CompositionManifest<Slot, LayoutId, ComponentId>,
  overrides: Partial<Record<Slot, ComponentId>> = {},
) {
  if (manifest.surface !== registry.surface || manifest.version !== registry.version) {
    throw new Error(`Incompatible composition manifest for ${manifest.surface}.`);
  }
  const layout = registry.layouts[manifest.layout];
  if (!layout) throw new Error(`Layout ${manifest.layout} is not registered.`);

  const requiredSlots = new Set<string>(registry.requiredSlots);
  for (const slot of registry.requiredSlots) {
    if (!Object.prototype.hasOwnProperty.call(manifest.slots, slot)) {
      throw new Error(`Composition manifest is missing required slot ${slot}.`);
    }
  }
  for (const slot of Object.keys(manifest.slots)) {
    if (!requiredSlots.has(slot)) throw new Error(`Composition manifest contains unknown slot ${slot}.`);
  }
  for (const slot of Object.keys(overrides)) {
    if (!requiredSlots.has(slot)) throw new Error(`Composition manifest contains unknown override slot ${slot}.`);
  }

  const components = {} as Record<Slot, ComponentType<ComponentProps>>;
  for (const slot of registry.requiredSlots) {
    const requirement = manifest.slots[slot];
    if (requirement.slot !== slot) {
      throw new Error(`Composition slot identity mismatch for ${slot}: received ${requirement.slot}.`);
    }
    const componentId = overrides[slot] ?? requirement.component;
    const registration = registry.components[componentId];
    if (!registration) throw new Error(`Component ${componentId} is not registered.`);
    if (registration.slot !== slot) {
      throw new Error(`Component ${componentId} is registered for ${registration.slot}, not ${slot}.`);
    }
    if (registration.contractVersion !== requirement.contractVersion) {
      throw new Error(
        `Component ${componentId} does not satisfy ${slot} contract version ${requirement.contractVersion}.`,
      );
    }
    components[slot] = registration.component;
  }

  return Object.freeze({ layout, components: Object.freeze(components), viewPackId: manifest.viewPackId });
}
