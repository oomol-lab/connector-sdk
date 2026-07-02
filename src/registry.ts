/**
 * Type-augmentation contract — the seam between this core runtime and the optional generated
 * types package `@oomol-lab/connector-types`.
 *
 * The core ships an EMPTY `ActionRegistry`. The types package fills it via
 * `declare module "@oomol-lab/connector"`. All the conditional-type machinery lives here so
 * the types package only maintains a flat interface.
 */

import type { CallOptions } from "./types";

/**
 * Shape of one registry entry. The types package's generator imports this named type to
 * "shape-check" each emitted entry against `{ input; output }`, guarding against silent drift
 * between the runtime and the generated types.
 */
export interface RegistryEntry {
  input: unknown;
  output: unknown;
}

/**
 * The augmentation target. Empty in the core; `@oomol-lab/connector-types` augments it via:
 *
 * ```ts
 * declare module "@oomol-lab/connector" {
 *   interface ActionRegistry {
 *     "gmail.search_threads": { input: {...}; output: {...} };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ActionRegistry {}

/** `true` when no augmentation has entered the type graph (types package not installed / imported). */
type RegistryEmpty = [keyof ActionRegistry] extends [never] ? true : false;

/**
 * Open union of action ids.
 *
 * Empty registry → plain `string` (everything callable, loose).
 * Augmented → registered ids get literal completion, while `(string & {})` keeps the
 * union OPEN so unregistered actions (the types package lagging the backend, or only some
 * subpaths imported) still compile instead of erroring on a closed `keyof`.
 */
export type ActionId = RegistryEmpty extends true
  ? string
  : (keyof ActionRegistry & string) | (string & {});

/** Precise input type for a registered action, else the loose `Record<string, any>`. */
export type InputOf<A extends string> = A extends keyof ActionRegistry
  ? ActionRegistry[A] extends { input: infer I }
    ? I
    : Record<string, any>
  : Record<string, any>;

/** Precise output type for a registered action, else the loose `Record<string, any>`. */
export type OutputOf<A extends string> = A extends keyof ActionRegistry
  ? ActionRegistry[A] extends { output: infer O }
    ? O
    : Record<string, any>
  : Record<string, any>;

/**
 * Service names derived from the FLAT registry keys (`"<service>.<action>"`).
 *
 * NOTE (verified against tsc 6): derive from `keyof ActionRegistry`, NOT from `ActionId`.
 * `ActionId` carries `(string & {})`, and since a type alias is not a naked type
 * parameter the conditional checks the union as a WHOLE — which `(string & {})` fails —
 * collapsing `ServiceName` to `never` and losing per-service precision. Distributing over
 * the registry keys via the helper below keeps each registered service precise.
 */
type ServiceNameOf<K> = K extends `${infer S}.${string}` ? S : never;
type ServiceName = ServiceNameOf<keyof ActionRegistry & string>;

/**
 * Methods of one registered service, keyed by the action's local name. `O` is the per-call
 * options type of the CLIENT exposing the namespace — the hosted `Connector` passes its
 * `CallOptions` (the default), the self-hosted `OpenConnector` its narrower options (no
 * `organization`); the registry machinery itself is client-agnostic.
 */
type ActionsOf<S extends string, O = CallOptions> = {
  [K in keyof ActionRegistry as K extends `${S}.${infer N}` ? N : never]: (
    input: InputOf<K & string>,
    options?: O,
  ) => Promise<OutputOf<K & string>>;
};

/** Loose fallback namespace for unregistered services. */
export type LooseNamespace<O = CallOptions> = {
  [action: string]: (
    input?: Record<string, any>,
    options?: O,
  ) => Promise<Record<string, any>>;
};

/**
 * Path-2 namespaces, derived from the same flat registry — no second source to maintain.
 *
 * Empty registry → every service is loose.
 * Augmented → registered services are precise, yet BOTH unregistered services and
 * unregistered actions of a registered service stay loose-callable, keeping the namespace
 * path in lockstep with the dynamic `execute` path (so a not-yet-generated action never
 * fails to compile).
 *
 * How it stays precise without weakening: within `ActionsOf<S> & LooseNamespace`, the
 * explicit known-action members win over the index signature for their own keys (so
 * `oomol.gmail.search_threads({})` still errors on a missing required field), while any
 * OTHER action name on that service resolves through the loose index signature. The outer
 * `& Record<string, LooseNamespace>` does the same for entirely unregistered services.
 */
export type ServiceNamespaces<O = CallOptions> = RegistryEmpty extends true
  ? Record<string, LooseNamespace<O>>
  : { [S in ServiceName]: ActionsOf<S, O> & LooseNamespace<O> } & Record<string, LooseNamespace<O>>;
