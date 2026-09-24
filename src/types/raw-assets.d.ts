declare module "*.xml?raw" {
  const source: string;
  export default source;
}

interface ImportMeta {
  glob(
    pattern: string,
    options: { readonly eager: true; readonly query: "?raw"; readonly import: "default" },
  ): Record<string, string>;
}
