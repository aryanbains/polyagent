import path from 'node:path';
import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import {APP_NAME, MEMORY_BACKENDS, PROVIDERS, type InitOptions, type MemoryBackend, type Provider} from '../domain.js';
import {initializeConfig} from '../config/store.js';

type WizardStep = 'projectName' | 'workingDirectory' | 'provider' | 'apiKey' | 'memory' | 'saving' | 'done' | 'error';

type SelectItem<T extends string> = {
	label: string;
	value: T;
};

const providerItems: Array<SelectItem<Provider>> = PROVIDERS.map((provider) => ({
	label: provider,
	value: provider
}));

const memoryItems: Array<SelectItem<MemoryBackend>> = MEMORY_BACKENDS.map((backend) => ({
	label: backend === 'chroma' ? 'local ChromaDB' : backend,
	value: backend
}));

export function InitWizard(): JSX.Element {
	const {exit} = useApp();
	const defaultProjectName = useMemo(() => path.basename(process.cwd()) || APP_NAME, []);
	const [step, setStep] = useState<WizardStep>('projectName');
	const [projectName, setProjectName] = useState(defaultProjectName);
	const [workingDirectory, setWorkingDirectory] = useState(process.cwd());
	const [provider, setProvider] = useState<Provider>('openai');
	const [apiKey, setApiKey] = useState('');
	const [memoryBackend, setMemoryBackend] = useState<MemoryBackend>('skip');
	const [configPath, setConfigPath] = useState('');
	const [error, setError] = useState('');

	const readyToSave = step === 'saving';

	useEffect(() => {
		if (!readyToSave) {
			return;
		}

		const initOptions: InitOptions = {
			projectName: projectName.trim() || defaultProjectName,
			workingDirectory: workingDirectory.trim() || process.cwd(),
			provider,
			apiKey,
			memoryBackend
		};

		initializeConfig(initOptions)
			.then((result) => {
				setConfigPath(result.configPath);
				setStep('done');
			})
			.catch((caughtError: unknown) => {
				setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
				setStep('error');
			});
	}, [apiKey, defaultProjectName, memoryBackend, projectName, provider, readyToSave, workingDirectory]);

	useEffect(() => {
		if (step !== 'done') {
			return;
		}

		const timeout = setTimeout(() => {
			exit();
		}, 900);

		return () => {
			clearTimeout(timeout);
		};
	}, [exit, step]);

	useInput((input) => {
		if (input === 'q' && (step === 'done' || step === 'error')) {
			exit();
		}
	});

	return (
		<Box flexDirection="column" paddingX={1}>
			<Text bold color="cyan">{APP_NAME} onboarding</Text>
			<Box marginTop={1} flexDirection="column">
				<Text dimColor>Configuration is stored in your Polycode home directory.</Text>
				<Text dimColor>Your API key is masked in the terminal and encrypted before it is written.</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				{step === 'projectName' && (
					<>
						<Text>Project name</Text>
						<TextInput
							value={projectName}
							onChange={setProjectName}
							onSubmit={() => {
								setStep('workingDirectory');
							}}
						/>
					</>
				)}

				{step === 'workingDirectory' && (
					<>
						<Text>Working directory</Text>
						<TextInput
							value={workingDirectory}
							onChange={setWorkingDirectory}
							onSubmit={() => {
								setStep('provider');
							}}
						/>
					</>
				)}

				{step === 'provider' && (
					<>
						<Text>LLM provider</Text>
						<SelectInput
							items={providerItems}
							onSelect={(item: SelectItem<Provider>) => {
								setProvider(item.value);
								setStep('apiKey');
							}}
						/>
					</>
				)}

				{step === 'apiKey' && (
					<>
						<Text>API key for {provider}</Text>
						<TextInput
							value={apiKey}
							onChange={setApiKey}
							mask="*"
							onSubmit={() => {
								setStep('memory');
							}}
						/>
					</>
				)}

				{step === 'memory' && (
					<>
						<Text>Memory backend preference</Text>
						<SelectInput
							items={memoryItems}
							onSelect={(item: SelectItem<MemoryBackend>) => {
								setMemoryBackend(item.value);
								setStep('saving');
							}}
						/>
					</>
				)}

				{step === 'saving' && (
					<Text color="cyan">
						<Spinner type="dots" /> Saving configuration
					</Text>
				)}

				{step === 'done' && (
					<Box flexDirection="column">
						<Text color="green">Configuration saved.</Text>
						<Text dimColor>{configPath}</Text>
					</Box>
				)}

				{step === 'error' && (
					<Box flexDirection="column">
						<Text color="red">Could not save configuration.</Text>
						<Text>{error}</Text>
						<Text dimColor>Press q to quit.</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
