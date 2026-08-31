/**
 * Minimal type shim for `react-native-strophe` (file:../react-native-strophe),
 * which ships plain `.js` source with no declaration files. Covers only the
 * API surface actually used by src/chatserver/ — extend as needed, keeping
 * it in sync with ../react-native-strophe/src/core.js.
 */
declare module 'react-native-strophe' {
  export interface StropheBuilder {
    tree(): Element;
    toString(): string;
    up(): StropheBuilder;
    root(): StropheBuilder;
    attrs(moreAttrs: Record<string, string | number | undefined>): StropheBuilder;
    c(name: string, attrs?: Record<string, string | number | undefined>, text?: string): StropheBuilder;
    t(text: string): StropheBuilder;
  }

  export type StropheHandlerFn = (stanza: Element) => boolean;

  export interface StropheHandlerOptions {
    matchBareFromJid?: boolean;
    ignoreNamespaceFragment?: boolean;
  }

  export class StropheConnection {
    constructor(service: string, options?: Record<string, unknown>);
    jid: string;
    domain: string | null;
    rawInput: (data: string) => void;
    rawOutput: (data: string) => void;
    xmlInput: (elem: Element) => void;
    xmlOutput: (elem: Element) => void;
    connect(
      jid: string,
      pass: string,
      callback: (status: number, condition?: string) => void,
      wait?: number,
      hold?: number,
      route?: string,
      authcid?: string,
    ): void;
    attach(
      jid: string,
      sid: string,
      rid: string,
      callback: (status: number, condition?: string) => void,
      wait?: number,
      hold?: number,
      wind?: number,
    ): void;
    disconnect(reason?: string): void;
    send(elem: Element | StropheBuilder | (Element | StropheBuilder)[], callback?: () => void): void;
    sendIQ(
      elem: Element | StropheBuilder,
      callback?: (stanza: Element) => void,
      errback?: (stanza: Element | null) => void,
      timeout?: number,
    ): string;
    addHandler(
      handler: StropheHandlerFn,
      ns?: string | null,
      name?: string | null,
      type?: string | string[] | null,
      id?: string | null,
      from?: string | null,
      options?: StropheHandlerOptions,
    ): unknown;
    deleteHandler(handlerRef: unknown): void;
    reset(): void;
  }

  export const Strophe: {
    Connection: typeof StropheConnection;
    Status: {
      ERROR: number;
      CONNECTING: number;
      CONNFAIL: number;
      AUTHENTICATING: number;
      AUTHFAIL: number;
      CONNECTED: number;
      DISCONNECTED: number;
      DISCONNECTING: number;
      ATTACHED: number;
      REDIRECT: number;
      CONNTIMEOUT: number;
    };
    NS: Record<string, string>;
    getBareJidFromJid(jid: string): string | null;
    getNodeFromJid(jid: string): string | null;
    getDomainFromJid(jid: string): string | null;
    getResourceFromJid(jid: string): string | null;
  };

  export function $build(name: string, attrs?: Record<string, string | number | undefined>): StropheBuilder;
  export function $msg(attrs?: Record<string, string | number | undefined>): StropheBuilder;
  export function $iq(attrs?: Record<string, string | number | undefined>): StropheBuilder;
  export function $pres(attrs?: Record<string, string | number | undefined>): StropheBuilder;
}
