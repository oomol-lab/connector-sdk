/**
 * `@oomol-lab/connector` — core runtime client for the OOMOL Connector gateway.
 *
 * Runs fully without generated types (loose typing). Install `@oomol-lab/connector-types`
 * and add one side-effect import per provider (e.g. `import "@oomol-lab/connector-types/gmail"`)
 * to light up precise per-action input/output types + JSDoc.
 */

export { Connector, type ConnectorMethods } from "./connector";

export {
  ConnectorError,
  isRetryable,
  type ConnectorErrorCode,
  type ConnectorErrorInit,
} from "./errors";

// Type-augmentation contract: `@oomol-lab/connector-types` augments `ActionRegistry`;
// `RegistryEntry` is the shape-check it validates each emitted entry against.
export type {
  ActionRegistry,
  RegistryEntry,
  ActionId,
  InputOf,
  OutputOf,
} from "./registry";

export type {
  ClientConfig,
  CallOptions,
  ScopeOptions,
  RawResult,
  ProxyMethod,
  ProxyRequest,
  ProxyResponse,
  CatalogApi,
  ActionMetadata,
  ProviderMetadata,
  ProviderQuery,
  ProviderCategory,
  AppsApi,
  ConnectedApp,
} from "./types";
