import React, {type ReactNode} from 'react';
import {Box, Text} from 'ink';

type PanelProps = {
	title: string;
	active?: boolean;
	height?: number;
	subtitle?: string;
	width?: number;
	children: ReactNode;
};

export function Panel({title, active = false, height, subtitle, width, children}: PanelProps): JSX.Element {
	return (
		<Box
			borderStyle="round"
			borderColor={active ? 'cyan' : 'gray'}
			flexDirection="column"
			height={height}
			overflow="hidden"
			paddingX={1}
			paddingY={0}
			width={width}
			flexGrow={width === undefined ? 1 : 0}
		>
			<Text color={active ? 'cyan' : 'white'} bold wrap="truncate-end">
				{title}{subtitle === undefined ? '' : ` ${subtitle}`}
			</Text>
			<Box marginTop={1} flexDirection="column" overflow="hidden" flexGrow={1}>
				{children}
			</Box>
		</Box>
	);
}
