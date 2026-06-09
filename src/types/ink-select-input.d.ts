declare module 'ink-select-input' {
	export type SelectInputItem<T = unknown> = {
		label: string;
		value: T;
	};

	type SelectInputProps<T = unknown> = {
		items: Array<SelectInputItem<T>>;
		onSelect: (item: SelectInputItem<T>) => void;
	};

	function SelectInput<T = unknown>(props: SelectInputProps<T>): JSX.Element;
	export default SelectInput;
}
