import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {confirm} from '@inquirer/prompts';
import {createTwoFilesPatch} from 'diff';
import type {ToolApprovalMode, ToolContext} from './types.js';

export class ToolSafetyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ToolSafetyError';
	}
}

export function resolveWorkspacePath(workingDirectory: string, inputPath = '.'): string {
	const workspace = path.resolve(workingDirectory);
	const resolved = path.resolve(workspace, inputPath);
	const relative = path.relative(workspace, resolved);

	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new ToolSafetyError(`Path is outside the workspace: ${inputPath}`);
	}

	return resolved;
}

export async function readTextFileIfExists(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, 'utf8');
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return '';
		}

		throw error;
	}
}

export function createUnifiedDiff(filePath: string, before: string, after: string): string {
	return createTwoFilesPatch(filePath, filePath, before, after, 'before', 'after', {
		context: 3
	});
}

function approvalFromEnvironment(): ToolApprovalMode | null {
	const value = process.env.POLYCODE_TOOL_APPROVAL?.toLowerCase();

	if (value === 'allow' || value === 'yes' || value === 'true') {
		return 'allow';
	}

	if (value === 'deny' || value === 'no' || value === 'false') {
		return 'deny';
	}

	return null;
}

export async function requestApproval(message: string, context: ToolContext, preview?: string): Promise<boolean> {
	const mode = approvalFromEnvironment() ?? context.approvalMode;

	if (preview !== undefined) {
		context.onPreview?.(preview);
	}

	if (mode === 'allow') {
		return true;
	}

	if (mode === 'deny') {
		return false;
	}

	return confirm({
		message,
		default: false
	});
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
	await mkdir(path.dirname(filePath), {recursive: true});
	await writeFile(filePath, content);
}

export function limitOutput(value: string, maxLength = 8000): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, maxLength)}\n... output truncated ...`;
}
