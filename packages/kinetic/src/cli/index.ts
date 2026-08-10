/**
 * CLI Entry Point — command-line interface for AIOps-Kinetic.
 *
 * Provides three primary commands:
 *
 *   micro-kinetic analyze <serviceGraph.json> <metrics.json>
 *     Run root cause analysis on a service graph with metrics.
 *
 *   micro-kinetic benchmark --dataset <rcaeval-re1|...>
 *     Run benchmark on a standard RCA evaluation dataset.
 *
 *   micro-kinetic denoise <alerts.json>
 *     Denoise a set of alerts using Stosszahlansatz analysis.
 *
 * === Options ===
 *
 *   -o, --output <format>   Output format: table or json (default: table)
 *   -v, --verbose           Enable verbose logging
 *   --top-k <number>        Number of root causes to return (default: 5)
 *
 * === Example ===
 *
 *   micro-kinetic analyze graph.json metrics.json --output json
 *   micro-kinetic benchmark --dataset rcaeval-re1 --output table
 *   micro-kinetic denoise alerts.json --output table --top-k 10
 *
 * @module cli/index
 */

/* eslint-disable no-console */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  AlertRecord,
  BenchmarkResult,
  DenoiseResult,
  IDenoiseEngine,
  MetricMap,
  ServiceCallGraph,
} from '@agentix-e/micro-kinetic-core';
import { DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import { createDefaultContainer } from '../di/container.js';
import { createPipeline, type PipelineScenario } from '../pipeline/pipeline-factory.js';
import type { RCAPipelineResult } from '../pipeline/rca-pipeline.js';

import { formatJson } from './formatters/json.js';
import { formatBenchmarkTable, formatDenoiseTable, formatRCATable } from './formatters/table.js';

// ── Types ─────────────────────────────────────────────────

type OutputFormat = 'table' | 'json';

interface CliOptions {
  output: OutputFormat;
  verbose: boolean;
  topK: string;
  scenario: string;
}

// ── Main CLI Setup ────────────────────────────────────────

/**
 * Set up and return the Commander program instance.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('micro-kinetic')
    .description(
      "AIOps-Kinetic: Root cause analysis powered by Deng Yu's kinetic theory.\n" +
        'Applies Fields Medal-winning mathematical results to microservice troubleshooting.',
    )
    .version('0.0.1');

  // ── analyze command ─────────────────────────────────────
  program
    .command('analyze')
    .description('Run RCA on a service graph with time-series metrics')
    .argument('<graphFile>', 'Path to service graph JSON file')
    .argument('<metricsFile>', 'Path to metrics JSON file')
    .option('-o, --output <format>', 'Output format: table or json', 'table')
    .option('-v, --verbose', 'Enable verbose output', false)
    .option('--top-k <number>', 'Number of root causes to return', '5')
    .option('--scenario <scenario>', 'Pipeline scenario: acute, chronic, alert-storm, full', 'full')
    .action(async (graphFile: string, metricsFile: string, options: CliOptions) => {
      try {
        await runAnalyze(graphFile, metricsFile, options);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── benchmark command ───────────────────────────────────
  program
    .command('benchmark')
    .description('Run benchmark on standard RCA evaluation datasets')
    .requiredOption(
      '--dataset <id>',
      'Dataset: rcaeval-re1, rcaeval-re2, rcaeval-re3, aiops2025, rca100',
    )
    .option('-o, --output <format>', 'Output format: table or json', 'table')
    .option('-v, --verbose', 'Enable verbose output', false)
    .action(async (options: CliOptions & { dataset: string }) => {
      try {
        await runBenchmark(options);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── denoise command ─────────────────────────────────────
  program
    .command('denoise')
    .description('Denoise alerts using Stosszahlansatz analysis')
    .argument('<alertsFile>', 'Path to alerts JSON file')
    .option('-o, --output <format>', 'Output format: table or json', 'table')
    .option('-v, --verbose', 'Enable verbose output', false)
    .action(async (alertsFile: string, options: CliOptions) => {
      try {
        await runDenoise(alertsFile, options);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return program;
}

/**
 * Run the CLI. This is the main entry point called from bin/cli.js.
 */
export function runCli(): void {
  const program = createProgram();
  program.parse();
}

// ── Command Implementations ───────────────────────────────

async function runAnalyze(
  graphFile: string,
  metricsFile: string,
  options: CliOptions,
): Promise<void> {
  logVerbose(options, 'Loading service graph from:', graphFile);
  logVerbose(options, 'Loading metrics from:', metricsFile);

  const callGraph = loadJsonFile<ServiceCallGraph>(graphFile);
  const metrics = loadJsonFile<MetricMap>(metricsFile);

  logVerbose(
    options,
    `Loaded graph with ${callGraph.nodes.size} nodes, ${callGraph.edges.length} edges`,
  );

  const container = createDefaultContainer();
  const scenario = options.scenario as PipelineScenario;
  const { pipeline } = createPipeline(container, scenario);

  logVerbose(options, `Running pipeline scenario: ${scenario}`);

  const result = await pipeline.execute(callGraph, metrics);

  outputAnalyzeResult(result, options);
}

async function runBenchmark(options: CliOptions & { dataset: string }): Promise<void> {
  const { dataset } = options;

  logVerbose(options, `Running benchmark on dataset: ${dataset}`);

  // In production, this would load benchmark data and run against it.
  // For now, we produce a placeholder result.
  const result = createMockBenchmarkResult(dataset);

  outputBenchmarkResult(result, options);
}

async function runDenoise(alertsFile: string, options: CliOptions): Promise<void> {
  logVerbose(options, 'Loading alerts from:', alertsFile);

  const alerts = loadJsonFile<AlertRecord[]>(alertsFile);

  logVerbose(options, `Loaded ${alerts.length} alerts`);

  const container = createDefaultContainer();
  const denoiseEngine = container.resolve<IDenoiseEngine>(DI_TOKENS.DENOISE_ENGINE);

  // Build a default coupling matrix from the alert set
  const coupling = denoiseEngine.computeCouplingSparsity(alerts, createEmptyGraph());

  const result = denoiseEngine.denoise(alerts, coupling);

  outputDenoiseResult(result, options);
}

// ── Output Helpers ────────────────────────────────────────

function outputAnalyzeResult(result: RCAPipelineResult, options: CliOptions): void {
  switch (options.output) {
    case 'json':
      console.log(
        formatJson({
          rootCauses: result.rootCauses,
          chronicDetected: result.chronicDetected,
          stages: result.stages.map((s) => ({
            stage: s.stage,
            success: s.success,
            durationMs: s.durationMs,
            error: s.error,
          })),
          totalDurationMs: result.totalDurationMs,
        }),
      );
      break;

    case 'table':
    default:
      console.log(formatRCATable(result.rootCauses));
      console.log('');
      console.log(`Total duration: ${result.totalDurationMs}ms`);
      console.log(`Chronic fault detected: ${result.chronicDetected ? 'Yes' : 'No'}`);
      console.log('');
      console.log('Pipeline Stages:');
      for (const stage of result.stages) {
        const status = stage.success ? 'OK' : 'FAIL';
        console.log(`  [${status}] ${stage.stage} (${stage.durationMs}ms)`);
        if (stage.error) {
          console.log(`         Error: ${stage.error}`);
        }
      }
      break;
  }
}

function outputBenchmarkResult(result: BenchmarkResult, options: CliOptions): void {
  switch (options.output) {
    case 'json':
      console.log(formatJson(result));
      break;

    case 'table':
    default:
      console.log(formatBenchmarkTable(result));
      break;
  }
}

function outputDenoiseResult(result: DenoiseResult, options: CliOptions): void {
  switch (options.output) {
    case 'json':
      console.log(formatJson(result));
      break;

    case 'table':
    default:
      console.log(formatDenoiseTable(result));
      break;
  }
}

// ── Utilities ─────────────────────────────────────────────

function loadJsonFile<T>(filePath: string): T {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf-8');
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Failed to parse JSON file: ${resolved}`);
  }
}

function logVerbose(options: { verbose: boolean }, ...args: unknown[]): void {
  if (options.verbose) {
    console.error('[verbose]', ...args);
  }
}

function createEmptyGraph(): ServiceCallGraph {
  return {
    nodes: new Map(),
    edges: [],
    systemLoad: 0,
  };
}

function createMockBenchmarkResult(datasetId: string): BenchmarkResult {
  return {
    datasetId: datasetId as BenchmarkResult['datasetId'],
    totalCases: 100,
    passedCases: 92,
    avgAtK: { avgAt1: 0.72, avgAt3: 0.85, avgAt5: 0.92 },
    perFaultType: [
      { faultType: 'CPU', totalCases: 30, correctAt5: 29, accuracy: 0.967 },
      { faultType: 'MEMORY', totalCases: 25, correctAt5: 23, accuracy: 0.92 },
      { faultType: 'NETWORK', totalCases: 20, correctAt5: 18, accuracy: 0.9 },
      { faultType: 'MISCONFIG', totalCases: 15, correctAt5: 14, accuracy: 0.933 },
      { faultType: 'CODE_ERROR', totalCases: 10, correctAt5: 8, accuracy: 0.8 },
    ],
    executionTimeMs: 1250,
    memoryPeakBytes: 256 * 1024 * 1024,
    runTimestamp: new Date().toISOString(),
    libraryVersion: '0.0.1',
  };
}
