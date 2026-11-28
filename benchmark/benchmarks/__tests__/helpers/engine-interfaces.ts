/**
 * The engine's own interfaces, read from the source that declares them.
 *
 * Two artifacts must name the configuration they ran — the golden 9-cell's and the ablation reference's —
 * and both reach the engine through `TreePruner(signals, topology)`. Holding each artifact to the fields the
 * engine ACTUALLY declares is what makes "this option is inert there" a measurement rather than a claim,
 * and it is the only way the fence survives the engine growing an option: the lists are parsed, never
 * remembered.
 *
 * Shared rather than copied: the two guards would otherwise each carry their own reader, and two readers of
 * one interface are two answers to the same question — the shape this repository keeps finding one level
 * up.
 *
 * @module benchmarks/__tests__/helpers/engine-interfaces
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

/** Where the engine declares the FIRST constructor argument's fields. */
export const PRUNER_PATH = resolve(REPO_ROOT, 'packages/tree/src/pruning/pruner.ts');
/** Where the engine declares the SECOND constructor argument's fields. */
export const TOPOLOGY_PATH = resolve(REPO_ROOT, 'packages/tree/src/causal/topology-fault-graph.ts');
/** Where the engine declares the fields `TreePrunerOptions` INHERITS. */
export const CORE_FAULTS_PATH = resolve(REPO_ROOT, 'packages/core/src/types/faults.ts');

/**
 * The members of an interface, read from the source that declares it.
 *
 * `extends` is followed rather than ignored: `TreePrunerOptions extends RCAEngineOptions`, and four of the
 * fields the pruner fills come from the base — a reader that stopped at the derived interface would report
 * those four as foreign. The base is named BY THE DECLARATION and resolved by this function, so a caller
 * cannot pair the wrong base with an interface from memory.
 *
 * @param path - The file that declares the interface.
 * @param name - The interface's name.
 * @returns The members' names, own and inherited.
 */
export function interfaceMembers(path: string, name: string): string[] {
  const text = readFileSync(path, 'utf8');
  const m = new RegExp(
    `export interface ${name}\\s*(?:extends\\s+([A-Za-z]+))?\\s*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(text);
  expect(m, `${name} is declared in ${path}`).not.toBeNull();
  const own = [
    ...m![2]!.matchAll(/^\s{2}(?:readonly\s+)?([A-Za-z][A-Za-z0-9]*)\??:\s*[^;]+;/gm),
  ].map((mm) => mm[1]!);
  expect(own.length, `${name} has members`).toBeGreaterThan(0);
  const base = m![1];
  if (base === undefined) return own;
  // One level, and it must be the base this repository has: a deeper chain would need the walk
  // generalised, and the floors make a silently-empty parse fail instead of passing quietly.
  expect(base, `${name} extends the declared base`).toBe('RCAEngineOptions');
  return [...own, ...interfaceMembers(CORE_FAULTS_PATH, base)];
}

/** The fields the engine's first constructor argument declares, own and inherited. */
export const PRUNER_OPTION_MEMBERS = interfaceMembers(PRUNER_PATH, 'TreePrunerOptions');

/** The fields the engine's second constructor argument declares. */
export const TOPOLOGY_MEMBERS = interfaceMembers(TOPOLOGY_PATH, 'TopologyFaultGraphConfig');

/** The `name=` tokens a line carries, which is what an artifact actually states. */
export function namedOn(line: string): string[] {
  return [...new Set([...line.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9]*)=/g)].map((m) => m[1]!))];
}
