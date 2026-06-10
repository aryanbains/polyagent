import {access, writeFile} from 'node:fs/promises';
import path from 'node:path';

export type ScaffoldAgentsResult = {
	filePath: string;
	created: boolean;
};

const starterAgentsYaml = `orchestrator:
  strategy: plan_and_execute
  max_parallel_agents: 3
  max_iterations: 10
agents:
  - name: researcher
    role: "Project-aware coding assistant that can inspect files, answer questions, and help with implementation tasks"
    goal: "Help the user understand and change this project accurately"
    memory_enabled: true
    tools:
      - read_file
      - write_file
      - append_to_file
      - list_directory
      - search_files
      - execute_command
      - web_search
      - fetch_url
  - name: analyst
    role: "Analysis specialist that compares findings, extracts tradeoffs, and identifies risks"
    goal: "Turn raw research and project context into structured recommendations"
    memory_enabled: true
    tools:
      - read_file
      - list_directory
      - search_files
  - name: writer
    role: "Technical writer that creates clear markdown reports and implementation summaries"
    goal: "Synthesize agent results into concise, useful documents"
    memory_enabled: true
    tools:
      - read_file
      - write_file
      - append_to_file
`;

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function scaffoldAgentsFile(workingDirectory: string): Promise<ScaffoldAgentsResult> {
	const filePath = path.join(workingDirectory, 'agents.yaml');

	if (await fileExists(filePath)) {
		return {filePath, created: false};
	}

	await writeFile(filePath, starterAgentsYaml);
	return {filePath, created: true};
}
