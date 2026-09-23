import { createElement } from "react";
import type { SpacesOverviewPresentation } from "./SpacesOverview.contracts";
import {
  defaultSpacesOverviewManifest,
  denseSpacesOverviewManifest,
  resolveSpacesOverviewComposition,
} from "./SpacesOverview.composition";
import { createSpacesOverviewProductionView } from "./SpacesOverview.uic.view";

const selectedComposition = resolveSpacesOverviewComposition(
  defaultSpacesOverviewManifest,
);
export const selectedSpacesOverviewUI = selectedComposition.ui;

export const selectedSpacesOverviewReactView: SpacesOverviewPresentation = (props) =>
  createElement(selectedComposition.layout, {
    ...props,
    ui: selectedSpacesOverviewUI,
    viewPackId: selectedComposition.viewPackId,
  });

export const selectedSpacesOverviewView: SpacesOverviewPresentation =
  createSpacesOverviewProductionView();

const denseComposition = resolveSpacesOverviewComposition(denseSpacesOverviewManifest);
export const denseSpacesOverviewView: SpacesOverviewPresentation = (props) =>
  createElement(denseComposition.layout, { ...props, ui: denseComposition.ui, viewPackId: denseComposition.viewPackId });

export function getSpacesOverviewPresentation(viewPackId: string | undefined): SpacesOverviewPresentation {
  return viewPackId === denseSpacesOverviewManifest.viewPackId ? denseSpacesOverviewView : selectedSpacesOverviewView;
}
