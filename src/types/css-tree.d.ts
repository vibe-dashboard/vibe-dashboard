declare module "css-tree" {
  export interface CssNode { type: string; [key: string]: unknown }
  export interface SelectorListNode extends CssNode { type: "SelectorList" }
  export interface RuleNode extends CssNode { type: "Rule"; prelude: CssNode; }
  export interface DeclarationNode extends CssNode { type: "Declaration"; property: string; value: CssNode; important: boolean; }
  export interface AtruleNode extends CssNode { type: "Atrule"; name: string; prelude: CssNode | null; }
  export interface ClassSelectorNode extends CssNode { type: "ClassSelector"; name: string; }
  export interface TypeSelectorNode extends CssNode { type: "TypeSelector"; name: string; }
  export interface PseudoClassSelectorNode extends CssNode { type: "PseudoClassSelector"; name: string; }
  export type WalkNode = CssNode | RuleNode | DeclarationNode | AtruleNode | ClassSelectorNode | TypeSelectorNode | PseudoClassSelectorNode;
  export interface ParseError { formattedMessage: string }
  export function parse(source: string, options?: { context?: "stylesheet" | "selector" | "selectorList"; positions?: boolean; onParseError?: (error: ParseError) => void }): CssNode;
  export function generate(node: CssNode): string;
  export function walk(node: CssNode, handler: ((node: WalkNode) => void) | { enter(node: WalkNode): void }): void;
}
