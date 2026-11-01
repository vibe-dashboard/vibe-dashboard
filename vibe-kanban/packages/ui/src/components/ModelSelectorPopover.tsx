import type { ReactElement, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDownIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSearchInput,
  DropdownMenuTrigger,
} from './Dropdown';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './Accordion';
import { ModelProviderIcon } from './ModelProviderIcon';
import {
  ModelList,
  modelMatchesSearch,
  type ModelListModel,
} from './ModelList';

interface ModelSelectorProvider {
  id: string;
  name: string;
}

interface ModelSelectorConfigLike {
  models: ModelListModel[];
  providers: ModelSelectorProvider[];
  model_order?: string[];
}

export interface ModelSelectorPopoverProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  config: ModelSelectorConfigLike;
  error?: string | null;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  selectedReasoningId: string | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onModelSelect: (id: string, providerId?: string) => void;
  onReasoningSelect: (reasoningId: string | null) => void;
  recentModelEntries?: string[];
  showDefaultOption?: boolean;
  onSelectDefault?: () => void;
  scrollRef?: Ref<HTMLDivElement>;
  expandedProviderId?: string;
  onExpandedProviderIdChange?: (id: string) => void;
  resolvedTheme?: 'light' | 'dark';
}

const MODEL_LIST_PAGE_SIZE = 8;

function getModelKey(model: ModelListModel): string {
  return model.provider_id ? `${model.provider_id}/${model.id}` : model.id;
}

function getModelSortLabel(model: ModelListModel): string {
  return model.name || model.id;
}

function sortModelsAlphabetically(models: ModelListModel[]): ModelListModel[] {
  return [...models].sort((a, b) => {
    const labelComparison = getModelSortLabel(a).localeCompare(
      getModelSortLabel(b),
      undefined,
      {
        numeric: true,
        sensitivity: 'base',
      }
    );
    if (labelComparison !== 0) return labelComparison;

    return getModelKey(a).localeCompare(getModelKey(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function getModelOrderKey(model: ModelListModel): string {
  return getModelKey(model).toLowerCase();
}

function getModelOrderIndex(
  model: ModelListModel,
  orderedKeys: Map<string, number>
): number | null {
  const providerScopedIndex = orderedKeys.get(getModelOrderKey(model));
  if (providerScopedIndex !== undefined) return providerScopedIndex;

  const modelIdIndex = orderedKeys.get(model.id.toLowerCase());
  return modelIdIndex ?? null;
}

export function orderModelsForDisplay(
  models: ModelListModel[],
  modelOrder?: string[]
): ModelListModel[] {
  if (!modelOrder?.length) {
    return sortModelsAlphabetically(models);
  }

  const alphabeticalModels = sortModelsAlphabetically(models);
  const orderedKeys = new Map(
    modelOrder.map((key, index) => [key.toLowerCase(), index])
  );

  return alphabeticalModels.sort((a, b) => {
    const aIndex = getModelOrderIndex(a, orderedKeys);
    const bIndex = getModelOrderIndex(b, orderedKeys);

    if (aIndex !== null && bIndex !== null) {
      return aIndex - bIndex;
    }
    if (aIndex !== null) return -1;
    if (bIndex !== null) return 1;
    return 0;
  });
}

function getSelectedModel(
  models: ModelListModel[],
  selectedProviderId: string | null,
  selectedModelId: string | null
): ModelListModel | null {
  if (!selectedModelId) return null;
  const selectedId = selectedModelId.toLowerCase();
  if (selectedProviderId) {
    const providerId = selectedProviderId.toLowerCase();
    return (
      models.find(
        (model) =>
          model.id.toLowerCase() === selectedId &&
          model.provider_id?.toLowerCase() === providerId
      ) ?? null
    );
  }
  return models.find((model) => model.id.toLowerCase() === selectedId) ?? null;
}

function getPopoverWidth(hasProviders: boolean, hasReasoning: boolean): string {
  if (hasProviders) return 'w-[280px]';
  if (hasReasoning) return 'w-[230px]';
  return 'w-[200px]';
}

export function providerMatchesSearch(
  provider: ModelSelectorProvider,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true;
  return (
    provider.id.toLowerCase().includes(normalizedQuery) ||
    provider.name.toLowerCase().includes(normalizedQuery)
  );
}

export function getProviderFilterState(
  config: ModelSelectorConfigLike,
  searchQuery: string,
  expandedProviderId: string
): {
  activeProviderId: string;
  providerMatchesById: Map<string, boolean>;
  visibleProviderIds: string[];
} {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const modelsByProvider = new Map<string, ModelListModel[]>();
  for (const model of config.models) {
    if (!model.provider_id) continue;
    const list = modelsByProvider.get(model.provider_id) ?? [];
    list.push(model);
    modelsByProvider.set(model.provider_id, list);
  }

  const providerMatchesById = new Map<string, boolean>();
  const visibleProviderIds: string[] = [];

  for (const provider of config.providers) {
    const providerMatches = providerMatchesSearch(provider, normalizedSearch);
    providerMatchesById.set(provider.id, providerMatches);
    const providerModels = modelsByProvider.get(provider.id) ?? [];
    const hasMatchingModel = providerModels.some((model) =>
      modelMatchesSearch(model, normalizedSearch)
    );

    if (!normalizedSearch || providerMatches || hasMatchingModel) {
      visibleProviderIds.push(provider.id);
    }
  }

  return {
    activeProviderId: normalizedSearch
      ? (visibleProviderIds[0] ?? '')
      : expandedProviderId,
    providerMatchesById,
    visibleProviderIds,
  };
}

interface ProviderAccordionProps {
  config: ModelSelectorConfigLike;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  selectedReasoningId: string | null;
  searchQuery: string;
  onModelSelect: (id: string, providerId?: string) => void;
  onReasoningSelect: (reasoningId: string | null) => void;
  showDefaultOption?: boolean;
  onSelectDefault?: () => void;
  scrollRef?: Ref<HTMLDivElement>;
  expandedProviderId: string;
  onExpandedProviderIdChange: (id: string) => void;
  resolvedTheme: 'light' | 'dark';
}

function ProviderAccordion({
  config,
  selectedProviderId,
  selectedModelId,
  selectedReasoningId,
  searchQuery,
  onModelSelect,
  onReasoningSelect,
  showDefaultOption = false,
  onSelectDefault,
  scrollRef,
  expandedProviderId,
  onExpandedProviderIdChange,
  resolvedTheme,
}: ProviderAccordionProps) {
  const { t } = useTranslation('common');
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const selectedModel = getSelectedModel(
    config.models,
    selectedProviderId,
    selectedModelId
  );

  const modelsByProvider = new Map<string, ModelListModel[]>();
  for (const model of config.models) {
    if (!model.provider_id) continue;
    const list = modelsByProvider.get(model.provider_id) ?? [];
    list.push(model);
    modelsByProvider.set(model.provider_id, list);
  }

  const isDefaultSelected = selectedModelId === null;
  const providers = config.providers;
  const { activeProviderId, providerMatchesById, visibleProviderIds } =
    getProviderFilterState(config, searchQuery, expandedProviderId);
  const visibleProviderIdSet = new Set(visibleProviderIds);

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
    >
      <div className="flex flex-col py-half">
        <Accordion
          type="single"
          collapsible
          value={activeProviderId}
          onValueChange={onExpandedProviderIdChange}
        >
          {providers.map((provider) => {
            const providerModels = orderModelsForDisplay(
              modelsByProvider.get(provider.id) ?? [],
              config.model_order
            );
            const isSelectedProvider =
              Boolean(selectedModelId) &&
              selectedModel?.provider_id?.toLowerCase() ===
                provider.id.toLowerCase();

            if (!visibleProviderIdSet.has(provider.id)) {
              return null;
            }
            const providerMatches =
              providerMatchesById.get(provider.id) ?? false;
            const modelSearchQuery =
              normalizedSearch && providerMatches ? '' : searchQuery;

            return (
              <AccordionItem key={provider.id} value={provider.id}>
                <AccordionTrigger
                  sticky={provider.id === activeProviderId}
                  className={cn(
                    'group gap-2 px-base py-half rounded-sm',
                    'text-sm font-medium text-low',
                    'hover:bg-secondary/60 transition-colors',
                    'focus:outline-none focus-visible:ring-1 focus-visible:ring-brand'
                  )}
                >
                  <ModelProviderIcon
                    providerId={provider.id}
                    theme={resolvedTheme}
                  />
                  <span className="flex-1 text-left truncate">
                    {provider.name}
                  </span>
                  <CaretDownIcon
                    className={cn(
                      'size-icon-2xs text-low transition-transform',
                      'group-data-[state=open]:rotate-180'
                    )}
                    weight="bold"
                  />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pl-1">
                    <ModelList
                      models={providerModels}
                      selectedModelId={
                        isSelectedProvider ? selectedModelId : null
                      }
                      searchQuery={modelSearchQuery}
                      onSelect={onModelSelect}
                      reasoningOptions={
                        isSelectedProvider
                          ? (selectedModel?.reasoning_options ?? [])
                          : []
                      }
                      selectedReasoningId={
                        isSelectedProvider ? selectedReasoningId : null
                      }
                      onReasoningSelect={onReasoningSelect}
                      justifyEnd={false}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        {showDefaultOption && (
          <div
            className={cn(
              'group flex items-center rounded-sm mx-half',
              'transition-colors duration-100',
              'focus-within:bg-secondary',
              isDefaultSelected
                ? 'bg-secondary text-high'
                : cn('text-normal', 'hover:bg-secondary/60')
            )}
          >
            <button
              type="button"
              onClick={() => onSelectDefault?.()}
              className={cn(
                'flex-1 min-w-0 py-half pl-base pr-half text-left',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-brand'
              )}
            >
              <span
                className={cn(
                  'block text-sm truncate',
                  isDefaultSelected && 'font-semibold'
                )}
              >
                {t('modelSelector.default')}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ModelSelectorPopover({
  isOpen,
  onOpenChange,
  trigger,
  config,
  error,
  selectedProviderId,
  selectedModelId,
  selectedReasoningId,
  searchQuery,
  onSearchChange,
  onModelSelect,
  onReasoningSelect,
  showDefaultOption = false,
  onSelectDefault,
  scrollRef,
  expandedProviderId = '',
  onExpandedProviderIdChange,
  resolvedTheme = 'light',
}: ModelSelectorPopoverProps) {
  const { t } = useTranslation('common');
  const models = config.models;
  const hasProviders = config.providers.length > 1;
  const hasReasoning = models.some(
    (model) => model.reasoning_options.length > 0
  );
  const popoverWidth = getPopoverWidth(hasProviders, hasReasoning);
  const popoverHeightClass = hasProviders ? 'h-[280px]' : '';

  let showSearch = true;
  let content: ReactElement;

  if (hasProviders) {
    content = (
      <ProviderAccordion
        config={config}
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        selectedReasoningId={selectedReasoningId}
        searchQuery={searchQuery}
        onModelSelect={onModelSelect}
        onReasoningSelect={onReasoningSelect}
        showDefaultOption={showDefaultOption}
        onSelectDefault={onSelectDefault}
        scrollRef={scrollRef}
        expandedProviderId={expandedProviderId}
        onExpandedProviderIdChange={onExpandedProviderIdChange ?? (() => {})}
        resolvedTheme={resolvedTheme}
      />
    );
  } else {
    const sortedModels = orderModelsForDisplay(models, config.model_order);
    const selectedModel = getSelectedModel(
      models,
      selectedProviderId,
      selectedModelId
    );
    showSearch = models.length > MODEL_LIST_PAGE_SIZE;

    content = (
      <ModelList
        models={sortedModels}
        selectedModelId={selectedModelId}
        searchQuery={searchQuery}
        onSelect={onModelSelect}
        reasoningOptions={selectedModel?.reasoning_options ?? []}
        selectedReasoningId={selectedReasoningId}
        onReasoningSelect={onReasoningSelect}
        justifyEnd
        className="max-h-[233px]"
        showDefaultOption={showDefaultOption}
        onSelectDefault={onSelectDefault}
        scrollRef={scrollRef}
      />
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        data-model-selector-popover
        className={cn(
          'p-0 overflow-hidden flex flex-col',
          popoverWidth,
          popoverHeightClass
        )}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-model-selector-dropdown]')) {
            event.preventDefault();
          }
        }}
      >
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {error && (
            <div className="px-base py-half bg-red-500/10 border-b border-red-500/20">
              <span className="text-sm text-red-600">{error}</span>
            </div>
          )}
          <DropdownMenuLabel>{t('modelSelector.model')}</DropdownMenuLabel>
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            {content}
            {showSearch && (
              <div className="border-t border-border">
                <DropdownMenuSearchInput
                  placeholder="Filter by provider, name or ID..."
                  value={searchQuery}
                  onValueChange={onSearchChange}
                />
              </div>
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
