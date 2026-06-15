import {randomUUID} from 'node:crypto';
import path from 'node:path';
import PQueue from 'p-queue';
import type {ModelMessage} from 'ai';
import type {AgentDefinition, OrchestratorConfig} from '../agents/schema.js';
import {AiSdkLlmClient, runAgentTurn, type LlmClient} from '../chat/run.js';
import type {PolycodeConfig} from '../domain.js';
import {
	createExecutionSession,
	type ExecutionEvent
} from '../runtime/execution.js';
import {RunCancelledError, isRunCancelled, mergeAbortSignals, throwIfAborted} from '../runtime/cancellation.js';
import {multiAgentOrchestrator} from '../runtime/orchestration.js';
import {requestApproval as requestToolApproval, resolveWorkspacePath, writeTextFile} from '../tools/safety.js';
import type {ToolApprovalMode, ToolContext, ToolResult, WebSearchProvider} from '../tools/types.js';
import {createAgentMessageBus, type AgentMessage} from './message-bus.js';
import {createPlannerDescriptor, planMultiAgentTaskDynamically, type MultiAgentPlan, type MultiAgentPlanStep} from './planner.js';
import {type AgentStepRecord, createSessionId, type RecordedSession, saveRecordedSession} from './session-recorder.js';
import {applyModifications, runAgentDebate, type DebateMessage, type DebateOutcome} from './debate.js';

export type AgentRuntimeStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type MultiAgentRunCallbacks = {
	onPlan?: (plan: MultiAgentPlan) => Promise<MultiAgentPlan | void> | MultiAgentPlan | void;
	onDebateStart?: (plan: MultiAgentPlan) => void;
	onDebateMessage?: (message: DebateMessage) => void;
	onDebateEnd?: (outcome: DebateOutcome) => void;
	onMessage?: (message: AgentMessage) => void;
	onExecutionEvent?: (event: ExecutionEvent) => void;
	onStepStart?: (step: MultiAgentPlanStep) => void;
	onStepFinish?: (record: AgentStepRecord) => void;
	onToken?: (agentName: string, token: string) => void;
	onAgentStatus?: (agentName: string, status: AgentRuntimeStatus) => void;
};

export type MultiAgentRunOptions = {
	config: PolycodeConfig;
	agents: AgentDefinition[];
	orchestrator: OrchestratorConfig;
	task: string;
	approvalMode: ToolApprovalMode;
	webSearchProvider?: WebSearchProvider;
	llmClient?: LlmClient;
	plan?: MultiAgentPlan;
	enableDebate?: boolean;
	toolContext?: Pick<ToolContext, 'onPreview' | 'requestApproval'>;
	callbacks?: MultiAgentRunCallbacks;
	saveSession?: boolean;
	abortSignal?: AbortSignal;
	stepTimeoutMs?: number;
	maxStepRetries?: number;
};

export type MultiAgentRunResult = {
	plan: MultiAgentPlan;
	session: RecordedSession;
	sessionPath: string | null;
	finalOutput: string;
	artifacts: string[];
	success: boolean;
};

function findAgent(agents: AgentDefinition[], name: string): AgentDefinition {
	return agents.find((agent) => agent.name === name) ?? agents[0]!;
}

function stepContext(step: MultiAgentPlanStep, results: Map<string, AgentStepRecord>): string {
	const dependencies = step.dependsOn
		.map((dependency) => results.get(dependency))
		.filter((record): record is AgentStepRecord => record !== undefined);

	if (dependencies.length === 0) {
		return '';
	}

	return dependencies.map((record) => [
		`Dependency ${record.stepId} from ${record.agentName} (${record.status}):`,
		record.error ?? record.output
	].join('\n')).join('\n\n');
}

function extractMarkdownReportPath(task: string): string | null {
	const match = /(?:at|to|as|called|named)\s+([./\\\w-]*[\w-]+\.md)\b/i.exec(task);
	return match?.[1] ?? null;
}

function extractHtmlReportPath(task: string): string | null {
	const match = /(?:at|to|as|called|named)\s+([./\\\w-]*[\w-]+\.html?)\b/i.exec(task);
	return match?.[1] ?? null;
}

const artifactStopWords = new Set([
	'a',
	'about',
	'also',
	'an',
	'and',
	'as',
	'at',
	'build',
	'called',
	'create',
	'css',
	'embedded',
	'file',
	'for',
	'html',
	'in',
	'into',
	'javascript',
	'js',
	'make',
	'markdown',
	'md',
	'page',
	'report',
	'search',
	'site',
	'the',
	'too',
	'to',
	'web',
	'website',
	'with'
]);

function artifactSlug(task: string): string {
	const words = task
		.toLowerCase()
		.replace(/https?:\/\/\S+/g, ' ')
		.match(/[a-z0-9]+/g) ?? [];
	const meaningful = words.filter((word) => word.length > 1 && !artifactStopWords.has(word));
	return meaningful.slice(0, 5).join('-') || 'polycode-output';
}

function wantsMarkdownReport(task: string): boolean {
	return /\b(markdown|report)\b|\.md\b|\bmd file\b/i.test(task);
}

function wantsHtmlReport(task: string): boolean {
	return /\b(website|web page|html)\b|\.html?\b/i.test(task);
}

function requestedArtifacts(task: string): Array<{kind: 'markdown' | 'html'; relativePath: string}> {
	const slug = artifactSlug(task);
	const markdownPath = extractMarkdownReportPath(task);
	const htmlPath = extractHtmlReportPath(task);
	const artifacts: Array<{kind: 'markdown' | 'html'; relativePath: string}> = [];

	if (markdownPath !== null) {
		artifacts.push({kind: 'markdown', relativePath: markdownPath});
	} else if (wantsMarkdownReport(task)) {
		artifacts.push({kind: 'markdown', relativePath: `reports/${slug}.md`});
	}

	if (htmlPath !== null) {
		artifacts.push({kind: 'html', relativePath: htmlPath});
	} else if (wantsHtmlReport(task)) {
		artifacts.push({kind: 'html', relativePath: `reports/${slug}.html`});
	}

	const seen = new Set<string>();
	return artifacts.filter((artifact) => {
		const key = artifact.relativePath.replaceAll('\\', '/').toLowerCase();

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
}

function stripCodeAndMarkup(value: string): string {
	return value
		.replace(/```[\s\S]*?```/g, '[code omitted]')
		.replace(/<script[\s\S]*?<\/script>/gi, '[script omitted]')
		.replace(/<style[\s\S]*?<\/style>/gi, '[style omitted]')
		.replace(/<[^>\n]{1,160}>/g, ' ')
		.replace(/^\s*(?:const|let|var|function|class|import|export|document\.|window\.|[.#][\w-]+\s*\{)[^\n]*$/gim, '[code omitted]')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
}

function oneLine(value: string, maxLength: number): string {
	const normalized = value.replace(/\s+/g, ' ').trim();

	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function usefulStepText(record: AgentStepRecord, maxLength = 1600): string {
	const clean = stripCodeAndMarkup(record.error ?? record.output);

	if (clean.length === 0) {
		return record.status === 'failed' ? 'The step failed without a readable error.' : 'The step completed. Detailed raw output is available in the recorded session.';
	}

	return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength)}\n\n[truncated]`;
}

function createMarkdownReport(task: string, records: AgentStepRecord[], finalOutput: string): string {
	return [
		`# ${task}`,
		'',
		'## Summary',
		finalOutput,
		'',
		'## Agent Results',
		...records.map((record) => [
			`### ${record.agentName}: ${record.title}`,
			'',
			`Status: ${record.status}`,
			'',
			usefulStepText(record, 2400)
		].join('\n'))
	].join('\n\n');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function createHtmlReport(task: string, records: AgentStepRecord[], finalOutput: string): string {
	const stepCards = records.map((record) => {
		const body = usefulStepText(record, 1400).split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n');
		return [
			'<article class="step-card">',
			`<h2>${escapeHtml(record.agentName)}: ${escapeHtml(record.title)}</h2>`,
			`<p class="meta">${escapeHtml(record.status)} in ${record.durationMs}ms</p>`,
			body,
			'</article>'
		].join('\n');
	}).join('\n');

	return [
		'<!doctype html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escapeHtml(task)}</title>`,
		'<style>',
		':root { color-scheme: light dark; --accent: #0891b2; --panel: rgba(125,125,125,.1); }',
		'body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }',
		'main { width: min(1080px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 56px; }',
		'header { border-bottom: 3px solid var(--accent); margin-bottom: 28px; }',
		'h1 { font-size: clamp(2rem, 5vw, 4rem); margin: 0 0 16px; letter-spacing: 0; }',
		'.summary, .step-card { background: var(--panel); border: 1px solid rgba(125,125,125,.25); border-radius: 8px; padding: 20px; margin: 18px 0; }',
		'.meta { color: #64748b; font-weight: 700; text-transform: uppercase; font-size: .78rem; letter-spacing: .08em; }',
		'button { border: 0; border-radius: 6px; padding: 10px 14px; background: var(--accent); color: white; font-weight: 700; cursor: pointer; }',
		'.hidden { display: none; }',
		'</style>',
		'</head>',
		'<body>',
		'<main>',
		'<header>',
		`<p class="meta">Generated by Polycode</p>`,
		`<h1>${escapeHtml(task)}</h1>`,
		'</header>',
		'<section class="summary">',
		'<h2>Summary</h2>',
		`<p>${escapeHtml(finalOutput).replace(/\n/g, '<br>')}</p>`,
		'<button id="toggle-details" type="button">Toggle agent details</button>',
		'</section>',
		'<section id="agent-details">',
		stepCards,
		'</section>',
		'</main>',
		'<script>',
		'const button = document.getElementById("toggle-details");',
		'const details = document.getElementById("agent-details");',
		'button?.addEventListener("click", () => details?.classList.toggle("hidden"));',
		'</script>',
		'</body>',
		'</html>'
	].join('\n');
}

function createArtifactContent(kind: 'markdown' | 'html', task: string, records: AgentStepRecord[], finalOutput: string): string {
	return kind === 'markdown'
		? createMarkdownReport(task, records, finalOutput)
		: createHtmlReport(task, records, finalOutput);
}

async function writeRequestedArtifact(
	options: MultiAgentRunOptions,
	artifact: {kind: 'markdown' | 'html'; relativePath: string},
	content: string
): Promise<string | null> {
	if (options.approvalMode === 'deny') {
		return null;
	}

	const approvalContext: ToolContext = {
		workingDirectory: options.config.project.workingDirectory,
		approvalMode: options.approvalMode,
		onPreview: options.toolContext?.onPreview,
		requestApproval: options.toolContext?.requestApproval
	};
	const preview = [
		`Generated ${artifact.kind} artifact`,
		`Path: ${artifact.relativePath}`,
		`Size: ${content.length} bytes`,
		'Full generated content is hidden in the terminal preview to keep the conversation readable.'
	].join('\n');
	const approved = await requestToolApproval(`Create ${artifact.kind} artifact at ${artifact.relativePath}?`, approvalContext, preview);

	if (!approved) {
		return null;
	}

	const resolved = resolveWorkspacePath(options.config.project.workingDirectory, artifact.relativePath);
	await writeTextFile(resolved, content);
	return path.relative(options.config.project.workingDirectory, resolved);
}

async function maybeWriteRequestedArtifacts(options: MultiAgentRunOptions, records: AgentStepRecord[], finalOutput: string): Promise<string[]> {
	const artifacts = requestedArtifacts(options.task);
	const written: string[] = [];

	for (const artifact of artifacts) {
		const content = createArtifactContent(artifact.kind, options.task, records, finalOutput);
		const artifactPath = await writeRequestedArtifact(options, artifact, content);

		if (artifactPath !== null) {
			written.push(artifactPath);
		}
	}

	return written;
}

function createFinalOutput(records: AgentStepRecord[], artifacts: string[]): string {
	const failed = records.filter((record) => record.status === 'failed');
	const cancelled = records.filter((record) => record.status === 'cancelled');
	const successful = records.filter((record) => record.status === 'succeeded');
	const lastSuccessful = successful.at(-1);
	const answer = artifacts.length > 0
		? `Created ${artifacts.length} file${artifacts.length === 1 ? '' : 's'} in the workspace.`
		: lastSuccessful === undefined
			? cancelled.length > 0 ? 'The run was cancelled before the agent team produced a successful result.' : 'The agent team did not produce a successful result.'
			: usefulStepText(lastSuccessful, 1200);

	return [
		cancelled.length > 0 ? `Cancelled with ${cancelled.length} cancelled step(s).` : failed.length > 0 ? `Completed with ${failed.length} failed step(s).` : 'Completed successfully.',
		'',
		'Steps',
		...records.map((record) => {
			const suffix = record.status === 'failed' && record.error !== undefined ? ` - ${oneLine(record.error, 120)}` : '';
			return `- ${record.agentName}/${record.stepId}: ${record.status} in ${record.durationMs}ms${suffix}`;
		}),
		artifacts.length > 0 ? ['', 'Files', ...artifacts.map((artifact) => `- ${artifact}`)].join('\n') : '',
		'',
		'Answer',
		answer
	].filter((line) => line.length > 0).join('\n');
}

function stepTimeoutMs(options: MultiAgentRunOptions): number {
	if (options.stepTimeoutMs !== undefined) {
		return options.stepTimeoutMs;
	}

	const value = Number.parseInt(process.env.POLYCODE_AGENT_STEP_TIMEOUT_MS ?? '', 10);
	return Number.isFinite(value) && value > 0 ? Math.min(value, 600_000) : 180_000;
}

function maxStepRetries(options: MultiAgentRunOptions): number {
	if (options.maxStepRetries !== undefined) {
		return Math.max(options.maxStepRetries, 0);
	}

	const value = Number.parseInt(process.env.POLYCODE_AGENT_STEP_RETRIES ?? '', 10);
	return Number.isFinite(value) && value >= 0 ? Math.min(value, 3) : 1;
}

function createCancelledRecord(step: MultiAgentPlanStep, agentName: string, startedAt = new Date()): AgentStepRecord {
	const completedAt = new Date();
	return {
		stepId: step.id,
		agentName,
		title: step.title,
		status: 'cancelled',
		output: '',
		error: 'Run cancelled.',
		startedAt: startedAt.toISOString(),
		completedAt: completedAt.toISOString(),
		durationMs: completedAt.getTime() - startedAt.getTime()
	};
}

async function withStepTimeout<T>(promiseFactory: (signal: AbortSignal | undefined) => Promise<T>, parentSignal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
	const controller = new AbortController();
	const signal = mergeAbortSignals(parentSignal, controller.signal);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	const operation = promiseFactory(signal);
	operation.catch(() => {});

	const timeout = timeoutMs > 0
		? new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				timedOut = true;
				const error = new Error(`Step timed out after ${timeoutMs}ms.`);
				controller.abort(error);
				reject(error);
			}, timeoutMs);
		})
		: undefined;

	try {
		return await (timeout === undefined ? operation : Promise.race([operation, timeout]));
	} catch (error) {
		if (timedOut) {
			throw new Error(`Step timed out after ${timeoutMs}ms.`);
		}

		throw error;
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}

		if (timedOut) {
			controller.abort(new Error(`Step timed out after ${timeoutMs}ms.`));
		}
	}
}

export async function runMultiAgentTask(options: MultiAgentRunOptions): Promise<MultiAgentRunResult> {
	throwIfAborted(options.abortSignal);
	const startedAt = new Date();
	const sessionId = createSessionId(startedAt);
	const messageBus = createAgentMessageBus();
	const executionEvents: ExecutionEvent[] = [];
	const agentOutputs = new Map<string, ModelMessage[]>();
	const stepRecords = new Map<string, AgentStepRecord>();
	const callbacks = options.callbacks;
	const llmClient = options.llmClient ?? new AiSdkLlmClient();
	let plan = options.plan ?? await planMultiAgentTaskDynamically({
		config: options.config,
		task: options.task,
		agents: options.agents,
		orchestrator: options.orchestrator,
		llmClient,
		abortSignal: options.abortSignal
	});
	let debateOutcome: DebateOutcome | undefined;

	messageBus.on('message', (message) => {
		callbacks?.onMessage?.(message);
	});

	if (options.enableDebate === true && plan.steps.length > 1) {
		callbacks?.onDebateStart?.(plan);

		try {
			debateOutcome = await runAgentDebate({
				plan,
				task: options.task,
				config: options.config,
				llmClient,
				agents: options.agents,
				abortSignal: options.abortSignal,
				callbacks: {
					onDebateMessage: callbacks?.onDebateMessage
				}
			});
			callbacks?.onDebateEnd?.(debateOutcome);
			plan = applyModifications(plan, debateOutcome.modifications, options.agents);
		} catch (error) {
			if (isRunCancelled(error)) {
				throw error;
			}

			debateOutcome = {
				approved: false,
				modifications: [],
				summary: `Plan review failed: ${error instanceof Error ? error.message : String(error)}. Continuing with the original plan.`,
				rounds: []
			};
			callbacks?.onDebateEnd?.(debateOutcome);
		}
	}

	const approvedPlan = await callbacks?.onPlan?.(plan);

	if (approvedPlan !== undefined) {
		plan = approvedPlan;
	}

	const queue = new PQueue({concurrency: options.orchestrator.max_parallel_agents});
	const retryLimit = maxStepRetries(options);
	const timeoutMs = stepTimeoutMs(options);
	const knownAgentNames = new Set(options.agents.map((agent) => agent.name));
	const availableAgentNames = options.agents.map((agent) => agent.name);

	const sendAgentMessage = async (input: {
		from: string;
		to: string;
		message: string;
		expectResponse: boolean;
	}): Promise<ToolResult> => {
		if (input.to !== 'orchestrator' && input.to !== 'broadcast' && !knownAgentNames.has(input.to)) {
			return {
				ok: false,
				message: `Unknown agent "${input.to}". Available agents: ${availableAgentNames.join(', ')}.`
			};
		}

		messageBus.publish({
			from: input.from,
			to: input.to,
			type: input.expectResponse ? 'request' : 'status',
			payload: {
				message: input.message
			}
		});

		if (!input.expectResponse) {
			return {
				ok: true,
				message: `Message delivered to ${input.to}.`
			};
		}

		const completedRecords = [...stepRecords.values()];
		const targetRecord = input.to === 'orchestrator'
			? completedRecords.at(-1)
			: completedRecords.filter((record) => record.agentName === input.to).at(-1);
		const response = targetRecord === undefined
			? `No completed result from ${input.to} is available yet. The request has been recorded in the session.`
			: `${targetRecord.agentName}/${targetRecord.stepId} (${targetRecord.status}): ${usefulStepText(targetRecord, 1200)}`;
		messageBus.publish({
			from: input.to === 'broadcast' ? 'orchestrator' : input.to,
			to: input.from,
			type: 'response',
			payload: {
				message: response
			}
		});

		return {
			ok: true,
			message: response
		};
	};

	const executeStep = async (step: MultiAgentPlanStep): Promise<AgentStepRecord> => {
		const originalAgent = findAgent(options.agents, step.agentName);
		const stepStartedAt = new Date();
		callbacks?.onStepStart?.(step);
		const fallbackAgent = options.agents.find((agent) => agent.name !== originalAgent.name);
		const candidateAgents = [originalAgent, ...(fallbackAgent === undefined ? [] : [fallbackAgent])];
		let output = '';
		let errorMessage: string | undefined;
		let finalAgent = originalAgent;
		let finalStatus: AgentStepRecord['status'] = 'failed';

		if (options.abortSignal?.aborted === true) {
			const record = createCancelledRecord(step, originalAgent.name, stepStartedAt);
			stepRecords.set(step.id, record);
			callbacks?.onStepFinish?.(record);
			callbacks?.onAgentStatus?.(originalAgent.name, 'cancelled');
			return record;
		}

		const runAttempt = async (agent: AgentDefinition, attempt: number, signal: AbortSignal | undefined): Promise<string> => {
			callbacks?.onAgentStatus?.(agent.name, 'running');
			messageBus.publish({
				from: 'orchestrator',
				to: agent.name,
				type: 'delegation',
				payload: {
					stepId: step.id,
					title: step.title,
					prompt: step.prompt,
					dependsOn: step.dependsOn,
					attempt
				}
			});

			for (const dependency of step.dependsOn) {
				const dependencyRecord = stepRecords.get(dependency);

				if (dependencyRecord !== undefined) {
					messageBus.publish({
						from: agent.name,
						to: dependencyRecord.agentName,
						type: 'request',
						payload: {
							stepId: step.id,
							dependency,
							request: `Provide the result needed for ${step.title}.`
						}
					});
					messageBus.publish({
						from: dependencyRecord.agentName,
						to: agent.name,
						type: 'response',
						payload: {
							stepId: dependency,
							status: dependencyRecord.status,
							output: dependencyRecord.error ?? dependencyRecord.output
						}
					});
				}
			}

			const dependencyContext = stepContext(step, stepRecords);
			const prompt = [
				`Overall task:\n${options.task}`,
				`Your assigned subtask:\n${step.prompt}`,
				attempt > 1 ? `Attempt ${attempt}: the previous attempt failed. Correct the issue and return a concise result.` : undefined,
				dependencyContext.length > 0 ? `Prior agent context:\n${dependencyContext}` : undefined,
				'Use tools for file creation, file edits, web search, URL fetches, shell commands, and agent-to-agent questions when needed.',
				'Use message_agent when another agent has context you need or when you need to notify another agent of a useful result.',
				'Do not paste full source code, HTML, CSS, JavaScript, fetched page bodies, or large raw tool output into your response. If you create files, write them with tools and return a concise summary with paths.',
				'Return a concise result that the orchestrator can use.'
			].filter(Boolean).join('\n\n');
			const executionSession = createExecutionSession({
				planner: createPlannerDescriptor(options.orchestrator),
				orchestrator: multiAgentOrchestrator,
				onEvent: (event) => {
					executionEvents.push(event);
					callbacks?.onExecutionEvent?.(event);
				}
			});
			const conversation = agentOutputs.get(agent.name) ?? [];
			agentOutputs.set(agent.name, conversation);

			return runAgentTurn({
				config: options.config,
				agent,
				message: prompt,
				conversation,
				llmClient,
				session: executionSession,
				abortSignal: signal,
				toolContext: {
					workingDirectory: options.config.project.workingDirectory,
					approvalMode: options.approvalMode,
					webSearchProvider: options.webSearchProvider,
					agentName: agent.name,
					availableAgents: availableAgentNames,
					sendAgentMessage,
					onPreview: options.toolContext?.onPreview,
					requestApproval: options.toolContext?.requestApproval
				},
				onToken: (token) => {
					callbacks?.onToken?.(agent.name, token);
				}
			});
		};

		for (const [candidateIndex, candidateAgent] of candidateAgents.entries()) {
			finalAgent = candidateAgent;
			const attemptsForCandidate = candidateIndex === 0 ? retryLimit + 1 : 1;

			if (candidateIndex > 0) {
				messageBus.publish({
					from: 'orchestrator',
					to: candidateAgent.name,
					type: 'delegation',
					payload: {
						stepId: step.id,
						title: step.title,
						reassignedFrom: originalAgent.name,
						reason: errorMessage ?? 'Previous agent failed.'
					}
				});
			}

			for (let attempt = 1; attempt <= attemptsForCandidate; attempt += 1) {
				try {
					output = await withStepTimeout((signal) => runAttempt(candidateAgent, attempt, signal), options.abortSignal, timeoutMs);
					errorMessage = undefined;
					finalStatus = 'succeeded';
					break;
				} catch (error) {
					if (isRunCancelled(error)) {
						errorMessage = 'Run cancelled.';
						finalStatus = 'cancelled';
						break;
					}

					errorMessage = error instanceof Error ? error.message : String(error);
					finalStatus = 'failed';
					messageBus.publish({
						from: candidateAgent.name,
						to: 'orchestrator',
						type: 'error',
						payload: {
							stepId: step.id,
							attempt,
							error: errorMessage
						}
					});

					if (attempt < attemptsForCandidate) {
						messageBus.publish({
							from: 'orchestrator',
							to: candidateAgent.name,
							type: 'status',
							payload: {
								stepId: step.id,
								status: 'retrying',
								nextAttempt: attempt + 1,
								error: errorMessage
							}
						});
					}
				}
			}

			if (finalStatus === 'succeeded' || finalStatus === 'cancelled') {
				break;
			}
		}

		const completedAt = new Date();
		const record: AgentStepRecord = {
			stepId: step.id,
			agentName: finalAgent.name,
			title: step.title,
			status: finalStatus,
			output,
			error: errorMessage,
			startedAt: stepStartedAt.toISOString(),
			completedAt: completedAt.toISOString(),
			durationMs: completedAt.getTime() - stepStartedAt.getTime()
		};

		stepRecords.set(step.id, record);
		messageBus.publish({
			from: finalAgent.name,
			to: 'orchestrator',
			type: finalStatus === 'succeeded' ? 'result' : finalStatus === 'cancelled' ? 'status' : 'error',
			payload: {
				stepId: step.id,
				status: record.status,
				output: record.error ?? record.output
			}
		});
		callbacks?.onStepFinish?.(record);
		callbacks?.onAgentStatus?.(finalAgent.name, record.status === 'cancelled' ? 'cancelled' : record.status === 'succeeded' ? 'succeeded' : 'failed');
		return record;
	};

	const stepPromises = new Map<string, Promise<AgentStepRecord>>();
	const runWithDependencies = (step: MultiAgentPlanStep): Promise<AgentStepRecord> => {
		const existing = stepPromises.get(step.id);

		if (existing !== undefined) {
			return existing;
		}

		const promise = Promise.all(step.dependsOn.map(async (dependency) => {
			const dependencyStep = plan.steps.find((candidate) => candidate.id === dependency);

			if (dependencyStep !== undefined) {
				await runWithDependencies(dependencyStep);
			}
		})).then(async () => queue.add(async () => executeStep(step)) as Promise<AgentStepRecord>);
		stepPromises.set(step.id, promise);
		return promise;
	};

	const records = await Promise.all(plan.steps.map(async (step) => runWithDependencies(step)));
	const failed = records.filter((record) => record.status === 'failed');
	const cancelled = records.some((record) => record.status === 'cancelled') || options.abortSignal?.aborted === true;
	const artifactSeedOutput = [
		cancelled ? 'Run cancelled.' : failed.length > 0 ? `Completed with ${failed.length} failed step(s).` : 'Completed successfully.',
		...records.map((record) => `${record.agentName}/${record.stepId}: ${usefulStepText(record, 1800)}`)
	].join('\n\n');
	const artifacts = cancelled ? [] : await maybeWriteRequestedArtifacts(options, records, artifactSeedOutput);
	const finalOutput = createFinalOutput(records, artifacts);
	const completedAt = new Date();
	const session: RecordedSession = {
		id: sessionId,
		task: options.task,
		mode: 'multi-agent',
		createdAt: startedAt.toISOString(),
		completedAt: completedAt.toISOString(),
		durationMs: completedAt.getTime() - startedAt.getTime(),
		plan,
		...(debateOutcome === undefined ? {} : {debateOutcome}),
		messages: messageBus.history,
		executionEvents,
		steps: records,
		finalOutput,
		artifacts,
		success: failed.length === 0 && !cancelled,
		cancelled,
		stats: {
			agentsUsed: new Set(records.map((record) => record.agentName)).size,
			toolsCalled: executionEvents.filter((event) => event.type === 'tool_started').length,
			messages: messageBus.history.length
		}
	};
	const sessionPath = options.saveSession === false ? null : await saveRecordedSession(options.config.project.workingDirectory, session);

	return {
		plan,
		session,
		sessionPath,
		finalOutput: session.finalOutput,
		artifacts,
		success: session.success
	};
}
