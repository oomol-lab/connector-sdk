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

// ProjectConnector — a SEPARATE client (project API key) to connect accounts for your end-users
// and run actions on their behalf. Fully distinct from the personal `Connector` above.
export { ProjectConnector } from "./project";
export type {
  ProjectApi,
  ProjectUser,
  ProjectConnectorConfig,
  ProjectCallOptions,
  ProjectExecuteOptions,
  ConnectionRequest,
  ConnectedAccount,
  ConnectionRequestStatus,
  ConnectedAccountStatus,
  ProviderSelector,
  OAuthConnectInput,
  ApiKeyConnectInput,
  CustomCredentialConnectInput,
  WaitForConnectionOptions,
} from "./project";

// OpenConnector — the personal client for the open-source, self-hosted runtime (the server YOU
// run). Mirrors the core `Connector` action surface: execute, catalog, apps — nothing else; the
// runtime's management API belongs to its web console, not this SDK.
export { OpenConnector } from "./open";
export type {
  OpenConnectorApi,
  OpenConnectorConfig,
  OpenCallOptions,
  OpenExecuteOptions,
  OpenCatalogApi,
  OpenAppsApi,
  OpenHealth,
  OpenActionMetadata,
  OpenActionFollowUp,
  OpenActionAsyncLifecycle,
  OpenActionSearchResult,
  OpenSearchQuery,
} from "./open";
