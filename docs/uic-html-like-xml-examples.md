# HTML-like UIC XML examples

Status: examples pack for
`vkvw-8xaj.18.32.1 — Author HTML-like UIC XML examples doc`.

This document is intentionally **not** a parser/runtime specification. It shows
the authoring experience we want before implementing the next UIC grammar.

## Decisions encoded here

- Real markup uses vanilla HTML-looking tags such as `main`, `section`,
  `header`, `ul`, `li`, `button`, `form`, and `input`.
- UIC control/import/i18n constructs use `uic:*` tags.
- UIC behavior attributes on vanilla HTML elements stay explicitly prefixed,
  for example `uic:for`, `uic:if`, `uic:bind`, and `uic:action`.
- A future shorthand may exist inside `uic:*` tags, but vanilla HTML tags do
  not get unprefixed magic attributes in v1.
- The safe HTML allowlist is broad enough for real product pages, but it is
  not browser HTML passthrough. UIC parses XML into a trusted renderer-owned
  tree.
- JS declares data contracts, action contracts, safety rules, and current-state
  gates. XML owns the UI structure, copy, i18n references, and scoped styling.
- Forms are allowed only as declarative UI that calls trusted injected actions.
  No URL form submission, `action="/..."`, `method="post"`, or raw navigation.
- Canonical authoring artifacts are XML files with sibling generated XSD files.
- A per-file XSD includes the current file rules and imported
  content/contracts. It must not recursively expand the entire import graph.
- Contract imports require structural compatibility by contract ID and version;
  an optional local path helps local authoring and forking.
- Invalid XML fails closed with diagnostics and safe fallback.
- iframe-sandboxed JavaScript via `postMessage` RPC is future-only and not v1.

## File layout example

```text
uic/
  spaces-overview/
    spaces-overview.command-center.uic.xml
    spaces-overview.command-center.uic.xsd
    components/
      craft-card.uic.xml
      craft-card.uic.xsd
      workspace-row.uic.xml
      workspace-row.uic.xsd
  voyage-bar/
    voyage-bar.compact.uic.xml
    voyage-bar.compact.uic.xsd
  settings/
    helper-ui.uic.xml
    helper-ui.uic.xsd
```

The XML is source of truth. XSD files are generated authoring artifacts and may
be checked in for editor support.

## Minimal valid UIC file

A complete file still needs explicit identity, namespace, contract, version,
sibling XSD reference, i18n declaration, and at least one safe markup element.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<uic:page
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  id="hello-card.basic"
  contract="demo.helloCard"
  contractVersion="1"
  xsd="hello-card.basic.uic.xsd">

  <uic:i18n localeNamespace="demo.helloCard">
    <uic:message key="title" default="Hello from UIC" />
  </uic:i18n>

  <section aria-labelledby="hello-title">
    <h1 id="hello-title">
      <uic:t key="title" />
    </h1>
  </section>
</uic:page>
```

## Full SpacesOverview HTML-like UIC XML

This is deliberately larger than the first implementation slice. It shows the
destination: all user-visible page structure lives in XML, while JS supplies
typed resources and trusted actions.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<uic:page
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  id="spaces-overview.command-center"
  contract="spacesOverview.page"
  contractVersion="1"
  xsd="spaces-overview.command-center.uic.xsd">

  <uic:uses contract="spacesOverview.craftCard" version="1"
    from="./components/craft-card.uic.xml"
    integrity="sha256-1111111111111111111111111111111111111111111111111111111111111111"
    as="CraftCard" />
  <uic:uses contract="spacesOverview.workspaceRow" version="1"
    from="./components/workspace-row.uic.xml"
    integrity="sha256-2222222222222222222222222222222222222222222222222222222222222222"
    as="WorkspaceRow" />

  <uic:i18n localeNamespace="spacesOverview">
    <uic:message key="page.title" default="Dashboard" />
    <uic:message key="page.subtitle" default="Workspace activity feed" />
    <uic:message key="page.eyebrow" default="Workspace command center" />
    <uic:message key="sessions.title" default="Recent sessions" />
    <uic:message key="sessions.empty" default="No recent sessions yet." />
    <uic:message key="servers.title" default="Running dev servers" />
    <uic:message key="craft.starred" default="Starred craft" />
    <uic:message key="craft.created" default="Recently created" />
    <uic:message key="craft.visited" default="Recently visited" />
    <uic:message key="workspaces.title" default="Workspaces" />
    <uic:message key="workspaces.count" default="{count} workspace(s)" />
    <uic:message key="workspaces.repoLabel" default="Repository" />
    <uic:message key="workspaces.applyFilter" default="Apply" />
    <uic:message key="pagination.previous" default="Previous" />
    <uic:message key="pagination.next" default="Next" />
    <uic:message key="pagination" default="Page {page} of {total}" />
    <uic:message key="actions.open" default="Open" />
    <uic:message key="actions.stop" default="Stop" />
    <uic:message key="actions.confirmStop" default="Stop this server?" />
  </uic:i18n>

  <uic:css><![CDATA[
    :uic-scope {
      --command-accent: var(--myne-color-accent);
      --command-card-gap: 0.875rem;
    }

    :uic-part(command-rail) {
      border-inline-start: 3px solid var(--command-accent);
    }

    :uic-part(workspace-queue) {
      display: grid;
      gap: var(--command-card-gap);
    }
  ]]></uic:css>

  <main data-uic-region="spaces-overview" aria-labelledby="spaces-title">
    <header data-uic-part="page-header">
      <p data-uic-part="eyebrow">
        <uic:t key="page.eyebrow" />
      </p>
      <h1 id="spaces-title">
        <uic:t key="page.title" />
      </h1>
      <p>
        <uic:t key="page.subtitle" />
      </p>
    </header>

    <section data-uic-part="command-grid" aria-label="Workspace activity">
      <aside data-uic-part="command-rail" aria-labelledby="active-work-title">
        <h2 id="active-work-title">
          <uic:t key="sessions.title" />
        </h2>

        <ul uic:if="recentSessions.ready && recentSessions.items.length"
          aria-label="Recent sessions">
          <li uic:for="session in recentSessions.items" uic:key="session.id">
            <button
              type="button"
              uic:action="spaces.resumeSession"
              uic:arg-session-id="session.id">
              <span uic:bind="session.name" />
              <small uic:bind="session.updatedLabel" />
            </button>

            <button
              type="button"
              uic:action="spaces.toggleSessionExpanded"
              uic:arg-session-id="session.id"
              aria-expanded="{session.expanded}">
              <uic:t key="actions.open" />
            </button>

            <ul uic:if="session.expanded">
              <li uic:for="craft in session.craftRows" uic:key="craft.id">
                <uic:component
                  is="CraftCard"
                  item="craft"
                  activate="spaces.navigateToCraft" />
              </li>
            </ul>
          </li>
        </ul>

        <p uic:if="recentSessions.ready && !recentSessions.items.length">
          <uic:t key="sessions.empty" />
        </p>
      </aside>

      <section data-uic-part="workspace-queue" aria-labelledby="workspaces-title">
        <header>
          <h2 id="workspaces-title">
            <uic:t key="workspaces.title" />
          </h2>
          <p>
            <uic:t key="workspaces.count" count="workspaceList.totalCount" />
          </p>
        </header>

        <form
          uic:action="spaces.selectRepo"
          uic:arg-repo-id="form.repoId"
          aria-label="Filter workspaces">
          <label>
            <uic:t key="workspaces.repoLabel" />
            <select name="repoId" uic:options="workspaceList.repoOptions" />
          </label>
          <button type="submit">
            <uic:t key="workspaces.applyFilter" />
          </button>
        </form>

        <ol aria-label="Workspace queue">
          <li uic:for="workspace in workspaceList.items" uic:key="workspace.id">
            <uic:component
              is="WorkspaceRow"
              item="workspace"
              open="spaces.openWorkspace"
              navigate="spaces.navigateToCraft"
              stop="spaces.stopWorkspaceExecution" />
          </li>
        </ol>

        <nav aria-label="Workspace pages">
          <button
            type="button"
            uic:action="spaces.setWorkspacePage"
            uic:arg-direction="previous"
            uic:disabled="!workspaceList.canPrevious">
            <uic:t key="pagination.previous" />
          </button>
          <span>
            <uic:t
              key="pagination"
              page="workspaceList.pageLabel"
              total="workspaceList.totalPagesLabel" />
          </span>
          <button
            type="button"
            uic:action="spaces.setWorkspacePage"
            uic:arg-direction="next"
            uic:disabled="!workspaceList.canNext">
            <uic:t key="pagination.next" />
          </button>
        </nav>
      </section>

      <aside data-uic-part="memory-rail" aria-label="Craft memory">
        <section uic:if="runningDevServers.items.length" aria-labelledby="servers-title">
          <h2 id="servers-title">
            <uic:t key="servers.title" />
          </h2>
          <ul>
            <li uic:for="server in runningDevServers.items" uic:key="server.id">
              <span uic:bind="server.workspaceName" />
              <button
                type="button"
                uic:action="spaces.stopDevServer"
                uic:arg-server-id="server.id"
                uic:confirm-key="actions.confirmStop">
                <uic:t key="actions.stop" />
              </button>
            </li>
          </ul>
        </section>

        <section aria-labelledby="starred-title">
          <h2 id="starred-title">
            <uic:t key="craft.starred" />
          </h2>
          <ul>
            <li uic:for="craft in starredCraft.items" uic:key="craft.id">
              <uic:component
                is="CraftCard"
                item="craft"
                activate="spaces.navigateToCraft" />
            </li>
          </ul>
        </section>

        <section aria-labelledby="created-title">
          <h2 id="created-title">
            <uic:t key="craft.created" />
          </h2>
          <ul>
            <li uic:for="craft in recentlyCreatedCraft.items" uic:key="craft.id">
              <uic:component
                is="CraftCard"
                item="craft"
                activate="spaces.navigateToCraft" />
            </li>
          </ul>
        </section>

        <section aria-labelledby="visited-title">
          <h2 id="visited-title">
            <uic:t key="craft.visited" />
          </h2>
          <ul>
            <li uic:for="craft in recentlyVisitedCraft.items" uic:key="craft.id">
              <uic:component
                is="CraftCard"
                item="craft"
                activate="spaces.navigateToCraft" />
            </li>
          </ul>
        </section>
      </aside>
    </section>
  </main>
</uic:page>
```

## Craft list budgets and diagnostics

Budgets are declared in XML metadata so authoring tools, XSD generation, and
runtime validation agree on the same ceilings. JS still supplies bounded data
and enforces current-state action targets.

```xml
<uic:resource
  id="recentlyCreatedCraft"
  contract="spacesOverview.craftList"
  version="1"
  maxRows="10"
  maxLabelLength="96"
  maxMetadataLength="64"
  duplicateKeyPolicy="diagnose-and-dedupe" />

<section aria-labelledby="created-title">
  <h2 id="created-title">
    <uic:t key="craft.created" />
  </h2>
  <ul>
    <li uic:for="craft in recentlyCreatedCraft.items" uic:key="craft.id">
      <uic:component is="CraftCard" item="craft" activate="spaces.navigateToCraft" />
    </li>
  </ul>
</section>
```

Invalid or diagnostic-producing cases:

```xml
<uic:resource
  id="recentlyCreatedCraft"
  contract="spacesOverview.craftList"
  version="1"
  maxRows="100000" />
```

Expected: `uic/resource/budget-exceeds-policy` at `maxRows`.

```xml
<!-- Resource declares maxRows="10"; runtime projection contains 11 rows. -->
<ul>
  <li uic:for="craft in recentlyCreatedCraft.items" uic:key="craft.id">
    <span uic:bind="craft.label" />
  </li>
</ul>
```

Expected: `uic/resource/max-rows-exceeded`; renderer caps deterministically to
the first 10 rows and excludes capped rows from action targets.

```xml
<!-- Runtime projected rows contain duplicate ids: craft-1, craft-1. -->
<li uic:for="craft in recentlyCreatedCraft.items" uic:key="craft.id">
  <span uic:bind="craft.label" />
</li>
```

Expected: `uic/resource/duplicate-key`; renderer keeps the first deterministic
row and drops duplicates from action targets.

```xml
<!-- Runtime projected label is longer than maxLabelLength. -->
<span uic:bind="craft.label" />
```

Expected: `uic/resource/string-truncated` for `craft.label`; action ids remain
bound to untruncated stable ids, not display labels.

```xml
<uic:resource
  id="recentlyCreatedCraft"
  contract="spacesOverview.craftList"
  version="1"
  maxLabelLength="999999" />
```

Expected: `uic/resource/budget-exceeds-policy` at `maxLabelLength`.

## Imported XML component by contract

The importing layout names the contract and version. `from` is a local authoring
hint and source path; compatibility is decided by the exported contract, not by
path alone.

```xml
<uic:uses
  contract="spacesOverview.craftCard"
  version="1"
  from="./components/craft-card.uic.xml"
  integrity="sha256-1111111111111111111111111111111111111111111111111111111111111111"
  as="CraftCard" />
```

The imported component exports its contract:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<uic:component
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  id="craft-card.compact"
  exports="spacesOverview.craftCard"
  contractVersion="1">

  <uic:props>
    <uic:prop name="item.id" type="string" required="true" />
    <uic:prop name="item.label" type="string" required="true" />
    <uic:prop name="item.spaceLabel" type="string" required="false" />
    <uic:prop name="activate" action="spaces.navigateToCraft" required="true" />
  </uic:props>

  <article data-uic-part="craft-card">
    <button
      type="button"
      uic:action="activate"
      uic:arg-craft-id="item.id">
      <strong uic:bind="item.label" />
      <small uic:bind="item.spaceLabel" />
    </button>
  </article>
</uic:component>
```

Structural compatibility for `spacesOverview.craftCard@1` requires the exported
component to accept the same prop/action shape. A component may add internal
markup, scoped CSS, and i18n keys, but it cannot require new parent data unless
the contract version changes.

### Polymorphic compatible replacement

A replacement component may be selected when it exports the same contract and
version, has a different digest, and remains structurally compatible with the
required props/actions.

```xml
<uic:uses
  contract="spacesOverview.craftCard"
  version="1"
  from="./components/craft-card.featured.uic.xml"
  integrity="sha256-3333333333333333333333333333333333333333333333333333333333333333"
  as="CraftCard" />
```

```xml
<uic:component
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  id="craft-card.featured"
  exports="spacesOverview.craftCard"
  contractVersion="1">

  <uic:props>
    <uic:prop name="item.id" type="string" required="true" />
    <uic:prop name="item.label" type="string" required="true" />
    <uic:prop name="item.spaceLabel" type="string" required="false" />
    <uic:prop name="activate" action="spaces.navigateToCraft" required="true" />
  </uic:props>

  <article data-uic-part="craft-card-featured">
    <button type="button" uic:action="activate" uic:arg-craft-id="item.id">
      <span aria-hidden="true">★</span>
      <strong uic:bind="item.label" />
      <small uic:bind="item.spaceLabel" />
    </button>
  </article>
</uic:component>
```

Invalid replacement examples:

- same contract but missing `activate` action:
  `uic/import/incompatible-action`;
- same contract but requires extra parent prop `item.secretScore`:
  `uic/import/incompatible-props`;
- same bytes but wrong digest:
  `uic/import/integrity-mismatch`;
- same local path with changed bytes and stale digest:
  `uic/import/integrity-mismatch`.

## First-class i18n

Visible production strings should be declared. Raw text is allowed only where
the grammar explicitly treats it as `default` copy during authoring; normalized
IR should carry stable keys/defaults.

Some smaller examples below use raw text to stay readable. Treat that as
authoring shorthand for generated `uic:message` defaults, not as a runtime
escape hatch.

```xml
<uic:i18n localeNamespace="beadsForm">
  <uic:message key="title" default="Submit review decisions" />
  <uic:message key="field.required" default="{label} is required." />
  <uic:message key="actions.submit" default="Submit" />
</uic:i18n>

<form uic:action="beadsForm.submit" aria-labelledby="beads-form-title">
  <h1 id="beads-form-title">
    <uic:t key="title" />
  </h1>

  <label>
    Decision
    <select name="decision" uic:options="form.decisionOptions" required="true" />
  </label>

  <p role="alert" uic:if="form.errors.decision">
    <uic:t key="field.required" label="Decision" />
  </p>

  <button type="submit">
    <uic:t key="actions.submit" />
  </button>
</form>
```

Placeholder names in `default` must match bound attributes. For example,
`default="{label} is required."` requires `label="..."`.

Plural/select messages are first-class too. Use ICU-style defaults, and require
every placeholder referenced by the message to be supplied by `uic:t`.

```xml
<uic:i18n localeNamespace="spacesOverview">
  <uic:message
    key="craft.count"
    default="{count, plural, =0 {No craft} one {# craft item} other {# craft items}}" />
  <uic:message
    key="server.state"
    default="{state, select, running {Running} stopping {Stopping} other {Unknown}}" />
</uic:i18n>

<p>
  <uic:t key="craft.count" count="starredCraft.totalCount" />
</p>
<p>
  <uic:t key="server.state" state="server.state" />
</p>
```

Invalid plural/select examples:

```xml
<uic:t key="craft.count" />
```

Expected: `uic/i18n/missing-placeholder` for `count`.

```xml
<uic:t key="server.state" status="server.state" />
```

Expected: `uic/i18n/missing-placeholder` for `state`.

## Flat-file-backed settings/helper UI model

The file is the source of truth. UIC renders a validated helper/editor over the
file; saving writes the file atomically through a trusted server action.

```text
settings/
  appearance.uic.xml
  appearance.uic.xsd
  appearance.config.json
```

Example helper UI:

```xml
<uic:page
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  id="settings.appearance.helper"
  contract="settings.flatFileHelper"
  contractVersion="1">

  <uic:flatFile
    id="appearance-config"
    path="settings/appearance.config.json"
    contract="settings.appearanceConfig"
    version="1"
    reloadAction="settings.reloadFlatFile"
    saveAction="settings.saveFlatFile" />

  <main aria-labelledby="appearance-settings-title">
    <h1 id="appearance-settings-title">Appearance settings</h1>

    <form
      uic:action="settings.saveFlatFile"
      uic:arg-file-id="appearance-config"
      aria-label="Appearance settings">
      <label>
        Layout
        <select
          name="layoutId"
          uic:value="appearanceConfig.layoutId"
          uic:options="appearanceConfig.availableLayouts" />
      </label>

      <label>
        Theme
        <select
          name="skinId"
          uic:value="appearanceConfig.skinId"
          uic:options="appearanceConfig.availableSkins" />
      </label>

      <label>
        Style
        <select
          name="styleId"
          uic:value="appearanceConfig.styleId"
          uic:options="appearanceConfig.availableStyles" />
      </label>

      <button type="submit">Validate and save file</button>
    </form>

    <uic:codeEditor
      file="appearance-config"
      language="json"
      validateAction="settings.validateFlatFile"
      saveAction="settings.saveFlatFile" />
  </main>
</uic:page>
```

Important boundary: the UI does not own durable state. It edits the flat file
through trusted validation/write actions. Failed validation keeps the old file
and reports diagnostics.

## Other page/component examples

### Sidebar / Voyage Bar

```xml
<uic:component
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  id="voyage-bar.compact"
  exports="navigation.voyageBar"
  contractVersion="1">

  <nav aria-label="Primary navigation">
    <ul>
      <li uic:for="item in navigation.items" uic:key="item.id">
        <button
          type="button"
          uic:action="navigation.openItem"
          uic:arg-item-id="item.id"
          aria-current="{item.current}">
          <span uic:bind="item.label" />
          <span uic:if="item.badge" uic:bind="item.badge" />
        </button>
      </li>
    </ul>
  </nav>
</uic:component>
```

### BeadsForm page

```xml
<uic:page
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  id="beads-form.review-decision"
  contract="beads.formPage"
  contractVersion="1">

  <main aria-labelledby="form-title">
    <h1 id="form-title">
      <uic:t key="beadsForm.title" default="Review decision" />
    </h1>

    <form uic:action="beads.submitForm" uic:arg-form-id="form.id">
      <fieldset>
        <legend>Decision</legend>
        <label uic:for="choice in form.choices" uic:key="choice.id">
          <input
            type="radio"
            name="decision"
            uic:value="choice.id"
            uic:checked="choice.selected" />
          <span uic:bind="choice.label" />
        </label>
      </fieldset>

      <label>
        Notes
        <textarea name="notes" uic:value="form.notes" />
      </label>

      <button type="submit">Submit decision</button>
    </form>
  </main>
</uic:page>
```

### Kanban board

```xml
<uic:page
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  id="kanban.board.basic"
  contract="kanban.board"
  contractVersion="1">

  <main aria-label="Kanban board">
    <section uic:for="column in board.columns" uic:key="column.id">
      <header>
        <h2 uic:bind="column.title" />
        <span uic:bind="column.countLabel" />
      </header>

      <ol>
        <li uic:for="card in column.cards" uic:key="card.id">
          <article>
            <button
              type="button"
              uic:action="kanban.openCard"
              uic:arg-card-id="card.id">
              <strong uic:bind="card.title" />
              <small uic:bind="card.subtitle" />
            </button>
          </article>
        </li>
      </ol>
    </section>
  </main>
</uic:page>
```

Drag/drop is intentionally not shown. It needs a separate trusted action and
accessibility design.

## Generated sibling XSD snippet

This is illustrative. The real generator should emit a complete per-file schema
for the exact XML file, its imported contracts, current resource paths, current
action IDs, and current i18n declarations.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  targetNamespace="https://vibedashboard.dev/uic/xml/v1"
  elementFormDefault="qualified"
  attributeFormDefault="unqualified">

  <xs:simpleType name="SpacesOverviewActionId">
    <xs:restriction base="xs:string">
      <xs:enumeration value="spaces.navigateToCraft" />
      <xs:enumeration value="spaces.openWorkspace" />
      <xs:enumeration value="spaces.stopDevServer" />
      <xs:enumeration value="spaces.selectRepo" />
      <xs:enumeration value="spaces.setWorkspacePage" />
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="SpacesOverviewBindingPath">
    <xs:restriction base="xs:string">
      <xs:enumeration value="workspaceList.items" />
      <xs:enumeration value="workspaceList.totalCount" />
      <xs:enumeration value="recentSessions.items" />
      <xs:enumeration value="starredCraft.items" />
      <xs:enumeration value="item.id" />
      <xs:enumeration value="item.label" />
    </xs:restriction>
  </xs:simpleType>

  <xs:attribute name="action" type="uic:SpacesOverviewActionId" />
  <xs:attribute name="bind" type="uic:SpacesOverviewBindingPath" />
  <xs:attribute name="for" type="xs:string" />
  <xs:attribute name="if" type="xs:string" />

  <xs:element name="page">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="uic:uses" minOccurs="0" maxOccurs="unbounded" />
        <xs:element ref="uic:i18n" minOccurs="0" maxOccurs="1" />
        <xs:element ref="uic:css" minOccurs="0" maxOccurs="1" />
        <!-- Safe vanilla HTML element tree allowed here by generated rules. -->
      </xs:sequence>
      <xs:attribute name="id" use="required" />
      <xs:attribute name="contract" fixed="spacesOverview.page" />
      <xs:attribute name="contractVersion" fixed="1" />
    </xs:complexType>
  </xs:element>
</xs:schema>
```

The XSD helps editors catch mistakes before runtime. Runtime validation remains
authoritative and must fail closed.

## Per-file XSD CLI and editor workflow

The CLI should generate and validate sibling XSD files deterministically.

```bash
# Generate or refresh sibling XSD files for checked-in UIC XML.
npm run uic:check -- --write-xsd uic/spaces-overview/spaces-overview.command-center.uic.xml

# Validate XML against generated XSD and runtime semantic rules.
npm run uic:check -- uic/spaces-overview/spaces-overview.command-center.uic.xml

# CI mode: fail if XML, generated XSD, or normalized contract metadata drift.
npm run uic:check -- --ci uic/**/*.uic.xml
```

Editor wiring should point each XML file at its sibling schema:

```xml
<?xml-model
  href="spaces-overview.command-center.uic.xsd"
  type="application/xml"
  schematypens="http://www.w3.org/2001/XMLSchema"?>
```

Required behavior:

- XSD generation reads the current file, imported contract headers, declared
  resources, actions, i18n keys, and safe HTML allowlist.
- XSD generation does not recursively expand full imported XML bodies.
- Editors use XSD for completion and early errors.
- Runtime validation remains authoritative for digests, current-state action
  gates, budgets, unsafe values, and fail-closed fallback.

## Invalid examples and expected diagnostics

### Script tag

```xml
<section>
  <script>alert("no")</script>
</section>
```

Expected: `uic/xml/forbidden-tag` at `script`.

### Inline event handler

```xml
<button onclick="steal()">Open</button>
```

Expected: `uic/xml/forbidden-attribute` at `onclick`.

### Raw URL navigation

```xml
<a href="https://example.com/export">Export</a>
```

Expected: `uic/xml/forbidden-url-attribute` at `href`. Navigation must be a
trusted action contract.

### Inline style

```xml
<section style="position:fixed;inset:0;z-index:999999">Overlay</section>
```

Expected: `uic/xml/forbidden-attribute` at `style`. Use scoped UIC CSS and the
default-deny CSS compiler.

### Import cycle

```xml
<!-- a.uic.xml -->
<uic:uses contract="demo.B" version="1" from="./b.uic.xml" as="B" />

<!-- b.uic.xml -->
<uic:uses contract="demo.A" version="1" from="./a.uic.xml" as="A" />
```

Expected: `uic/import/cycle`. The file being validated fails closed; the XSD
generator does not recursively expand the cycle.

### Unknown binding

```xml
<span uic:bind="workspaceList.secretInternalToken" />
```

Expected: `uic/binding/unknown-path`. Bindings must be declared by the JS data
contract.

### Raw URL form submit

```xml
<form action="/api/delete-everything" method="post">
  <button type="submit">Delete</button>
</form>
```

Expected: `uic/xml/forbidden-form-submit`. Forms must use `uic:action` and
trusted injected actions.

## Future-only: iframe-sandboxed JS aggregation

Not v1. Do not implement this in the HTML-like XML/XSD/i18n slice.

Future UIC may support sandboxed JavaScript for local aggregation/filtering when
declarative bindings are not enough. The boundary should look like this:

```text
host trusted resources
  -> frozen JSON input
  -> sandboxed iframe, no same-origin, no DOM access to host
  -> postMessage RPC with request id, budget, timeout
  -> frozen JSON output validated against declared schema
  -> UIC renderer
```

Sketch:

```xml
<uic:aggregation
  id="groupByRepository"
  phase="future-non-v1"
  sandbox="iframe"
  input="workspaceList.items"
  outputContract="workspaceGroups.v1"
  rpc="postMessage" />
```

Rules for that future phase:

- no host DOM access;
- no AppHooks access;
- no network unless separately approved;
- deterministic time/memory/message budgets;
- structured input/output schemas;
- fail closed to unaggregated trusted data;
- never required for the first SpacesOverview HTML-like proof.

## Practical first implementation slices after this doc

1. Generate the sibling XSD for this examples subset.
2. Parse vanilla safe HTML tags into the existing UIC owned tree.
3. Keep `uic:*` behavior attrs explicit on vanilla tags.
4. Convert the full SpacesOverview XML artifact to HTML-like syntax in slices,
   with React fallback preserved.
5. Add imported XML component validation by contract ID/version and optional
   local path.
6. Add first-class i18n key/default/placeholder validation.
7. Add flat-file editor/helper UI only after XML validation and XSD generation
   are proven.
