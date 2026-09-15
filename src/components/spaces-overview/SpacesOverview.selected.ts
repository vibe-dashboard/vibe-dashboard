import type { SpacesOverviewPresentation } from "./SpacesOverview.contracts";
import {
  defaultSpacesOverviewManifest,
  resolveSpacesOverviewComposition,
} from "./SpacesOverview.composition";

const selectedComposition = resolveSpacesOverviewComposition(
  defaultSpacesOverviewManifest,
);
export const selectedSpacesOverviewUI = selectedComposition.ui;

export const selectedSpacesOverviewView: SpacesOverviewPresentation = (props) =>
  createElement(selectedComposition.layout, {
    ...props,
    ui: selectedSpacesOverviewUI,
    viewPackId: selectedComposition.viewPackId,
  });
import { createElement } from "react";
