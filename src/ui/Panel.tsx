import React, {type ReactNode} from 'react';
import {Box, Text} from 'ink';

type PanelProps = {
	title: string;
	active?: boolean;
	width?: number;
	children: ReactNode;
};

export function Panel({title, active = false, width, children}: PanelProps): JSX.Element {
	return (
		<Box
			borderStyle="round"
			borderColor={active ? 'cyan' : 'gray'}
			flexDirection="column"
			paddingX={1}
			paddingY={0}
			width={width}
			flexGrow={width === undefined ? 1 : 0}
		>
			<Text color={active ? 'cyan' : 'white'} bold>
				{title}
			</Text>
			<Box marginTop={1} flexDirection="column">
				{children}
			</Box>
		</Box>
	);
}
