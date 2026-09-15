import type { ComponentType } from "react";

export interface RegisteredComponent<Props = unknown> {
  readonly contractVersion: number;
  readonly component: ComponentType<Props>;
}

export interface CompositionRegistry<
  LayoutProps,
  ComponentProps,
  LayoutId extends string,
  ComponentId extends string,
> {
  readonly surface: string;
  readonly version: 1;
  readonly layouts: Readonly<Record<LayoutId, ComponentType<LayoutProps>>>;
  readonly components: Readonly<Record<ComponentId, RegisteredComponent<ComponentProps>>>;
}

export interface CompositionManifest<
  Slot extends string,
  LayoutId extends string,
  ComponentId extends string,
> {
  readonly surface: string;
  readonly version: 1;
  readonly layout: LayoutId;
  readonly slots: Readonly<Record<Slot, {
    readonly component: ComponentId;
    readonly contractVersion: number;
  }>>;
  readonly viewPackId?: string;
}

export function createCompositionRegistry<
  LayoutProps,
  ComponentProps,
  LayoutId extends string,
  ComponentId extends string,
>(
  registry: CompositionRegistry<LayoutProps, ComponentProps, LayoutId, ComponentId>,
): CompositionRegistry<LayoutProps, ComponentProps, LayoutId, ComponentId> {
  return Object.freeze({
    ...registry,
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
  registry: CompositionRegistry<LayoutProps, ComponentProps, LayoutId, ComponentId>,
  manifest: CompositionManifest<Slot, LayoutId, ComponentId>,
  overrides: Partial<Record<Slot, ComponentId>> = {},
) {
  if (manifest.surface !== registry.surface || manifest.version !== registry.version) {
    throw new Error(`Incompatible composition manifest for ${manifest.surface}.`);
  }
  const layout = registry.layouts[manifest.layout];
  if (!layout) throw new Error(`Layout ${manifest.layout} is not registered.`);

  const components = {} as Record<Slot, ComponentType<ComponentProps>>;
  for (const [slot, requirement] of Object.entries(manifest.slots) as Array<
    [Slot, CompositionManifest<Slot, LayoutId, ComponentId>["slots"][Slot]]
  >) {
    const componentId = overrides[slot] ?? requirement.component;
    const registration = registry.components[componentId];
    if (!registration) throw new Error(`Component ${componentId} is not registered.`);
    if (registration.contractVersion !== requirement.contractVersion) {
      throw new Error(
        `Component ${componentId} does not satisfy ${slot} contract version ${requirement.contractVersion}.`,
      );
    }
    components[slot] = registration.component;
  }

  return Object.freeze({ layout, components: Object.freeze(components), viewPackId: manifest.viewPackId });
}
