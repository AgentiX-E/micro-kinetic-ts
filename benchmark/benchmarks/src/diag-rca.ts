/**
 * RCA Diagnostic Tool — per-case intermediate value dump.
 *
 * Loads a single RCAEval case, runs the full pipeline, and outputs
 * all intermediate values: anomaly scores, propagation weights,
 * call graph topology, and TreeRCA ranking.
 *
 * Usage:
 *   npx tsx benchmarks/src/diag-rca.ts <caseId> [--json]
 *
 * Example:
 *   npx tsx benchmarks/src/diag-rca.ts re1ob_adservice_cpu_1
 */

import { Container } from '@micro-kinetic/di';
import {
  DI_TOKENS,
  type IRCAEngine,
  type RootCauseResult,
} from '@agentix-e/micro-kinetic-core';
import { RCAEvalLoader } from './loaders/rcaeval-loader.js';
import { enhanceRCAEvalCallGraph, initRCAEvalTopology } from './rcaeval-topology.js';

// ── CLI Argument Parsing ────────────────────────────────

const args = process.argv.slice(2);
const caseId = args.find((a) => !a.startsWith('--')) ?? '';
const jsonMode = args.includes('--json');

if (!caseId) {
  console.error('Usage: npx tsx benchmarks/src/diag-rca.ts <caseId> [--json]');
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  const loader = new RCAEvalLoader({ dataDir: '/home/runner/RCAEval-json' });

  // Load all cases, filter to target
  const cases = await loader.load();
  const targetCases = cases.filter((c) => c.id === caseId);

  if (targetCases.length === 0) {
    console.error(`Case "${caseId}" not found in RCAEval dataset`);
    process.exit(1);
  }

  const benchCase = targetCases[0]!;

  // Initialize topology registry
  await initRCAEvalTopology();

  // Build call graph
  const callGraph = enhanceRCAEvalCallGraph(benchCase);

  // Create DI container and run RCA
  const container = new Container();
  container.autoRegister();
  container.register(DI_TOKENS.RCA_ENGINE, () => container.resolve(DI_TOKENS.RCA_ENGINE_DEFAULT));
  const engine = container.resolve<IRCAEngine>(DI_TOKENS.RCA_ENGINE);

  const faultGraph = engine.buildFaultGraph(callGraph, benchCase.metrics);
  const results = await engine.analyze(faultGraph, 5);
  const predictions = results.map((r) => r.serviceId);
  const groundTruth = benchCase.groundTruth.serviceId;

  // ── Output ──────────────────────────────────────────

  if (jsonMode) {
    outputJson(callGraph, faultGraph, results, benchCase, groundTruth);
  } else {
    outputText(callGraph, faultGraph, results, benchCase, groundTruth);
  }
}

// ── Text Output ────────────────────────────────────────

function outputText(
  callGraph: any,
  faultGraph: any,
  results: RootCauseResult[],
  benchCase: any,
  groundTruth: string,
) {
  const line = '═'.repeat(64);

  console.log(line);
  console.log(`Case: ${benchCase.case}`);
  console.log(`System: ${benchCase.system}`);
  console.log(`Suite: ${benchCase.suite}`);
  console.log(`Ground Truth: ${groundTruth} (type: ${benchCase.groundTruth.faultType})`);
  console.log(`Inject Time: ${benchCase.injectTime}ms`);
  console.log(`Call Graph: ${callGraph.nodes.size} nodes, ${callGraph.edges.length} edges`);
  console.log(line);

  // ── Anomaly Scores ─────────────────────────────────
  console.log('\n── Anomaly Scores (all nodes) ──');
  const anomalyEntries = [...faultGraph.anomalyScores.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  for (const [svc, score] of anomalyEntries) {
    const marker = svc === groundTruth ? ' ★ GROUND TRUTH' : '';
    console.log(`  ${svc.padEnd(24)} anomaly=${score.toFixed(4)}${marker}`);
  }

  // ── Propagation Weights ────────────────────────────
  console.log('\n── Propagation Weights (top 15 edges) ──');
  const edges = callGraph.edges;
  const weights = faultGraph.propagationWeights;
  const edgeWeightPairs = edges
    .map((e, i) => ({ from: e.from, to: e.to, weight: weights?.[i] ?? 0 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 15);

  for (const ew of edgeWeightPairs) {
    const marker =
      ew.from === groundTruth || ew.to === groundTruth ? ' ← ground truth involved' : '';
    console.log(`  ${ew.from} → ${ew.to.padEnd(24)} w=${ew.weight.toFixed(4)}${marker}`);
  }

  // ── Edge Types ─────────────────────────────────────
  console.log('\n── Call Graph Edge Composition ──');
  const edgeSources = new Map<string, number>();
  const nodeLabels = [...callGraph.nodes.values()].map((n: any) => n.labels ?? {});
  for (const labels of nodeLabels) {
    const src = labels._diag_source ?? labels.source ?? 'unknown';
    edgeSources.set(src, (edgeSources.get(src) ?? 0) + 1);
  }
  for (const [src, count] of edgeSources) {
    console.log(`  ${src}: ${count} nodes`);
  }

  // ── RCA Rankings ───────────────────────────────────
  console.log('\n── TreeRCA Rankings (top 5) ──');
  for (const r of results.slice(0, 5)) {
    const marker = r.serviceId === groundTruth ? ' ★ GROUND TRUTH' : '';
    console.log(
      `  #${r.rank} ${r.serviceId.padEnd(24)} confidence=${r.confidence.toFixed(4)}` +
        ` depth=${r.propagationDepth}${marker}`,
    );
  }

  // ── Ground Truth Check ─────────────────────────────
  const gtRank = predictions.indexOf(groundTruth);
  console.log(line);
  if (gtRank < 0) {
    console.log(`Ground truth "${groundTruth}" NOT in top-5 predictions`);
  } else {
    console.log(`Ground truth "${groundTruth}" ranked #${gtRank + 1} (higher is better)`);
  }
  console.log(line);
}

// ── JSON Output ───────────────────────────────────────

function outputJson(
  callGraph: any,
  faultGraph: any,
  results: RootCauseResult[],
  benchCase: any,
  groundTruth: string,
) {
  const anomalyScores: Record<string, number> = {};
  for (const [k, v] of faultGraph.anomalyScores) anomalyScores[k] = v;

  const edges = callGraph.edges.map((e: any, i: number) => ({
    from: e.from,
    to: e.to,
    weight: faultGraph.propagationWeights?.[i] ?? 0,
  }));

  console.log(
    JSON.stringify(
      {
        caseId,
        system: benchCase.system,
        groundTruth,
        anomalyScores,
        edges: edges.sort((a, b) => b.weight - a.weight),
        rankings: results.map((r) => ({
          rank: r.rank,
          serviceId: r.serviceId,
          confidence: r.confidence,
          depth: r.propagationDepth,
          isGroundTruth: r.serviceId === groundTruth,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('Diagnostic tool error:', err);
  process.exit(1);
});
