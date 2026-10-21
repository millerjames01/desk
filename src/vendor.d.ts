declare module 'pagedjs' {
  export class Previewer {
    preview(content?: DocumentFragment | Element | string, stylesheets?: (string | Record<string, string>)[], renderTo?: Element): Promise<{ total: number }>;
  }
}
