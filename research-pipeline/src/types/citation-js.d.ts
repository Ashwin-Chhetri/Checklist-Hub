/** @citation-js/core and @citation-js/plugin-csl ship no type declarations. */
declare module "@citation-js/core" {
  export class Cite {
    constructor(data: unknown, options?: Record<string, unknown>);
    format(type: string, options?: Record<string, unknown>): string;
  }
}

declare module "@citation-js/plugin-csl" {}
