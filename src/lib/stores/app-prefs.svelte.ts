const REDUCE_MOTION_KEY = 'grimoire-reduce-motion';

function createAppPrefs() {
	let reduceMotion = $state(
		typeof window !== 'undefined'
			? window.localStorage.getItem(REDUCE_MOTION_KEY) === 'true'
			: false,
	);

	function setReduceMotion(value: boolean) {
		reduceMotion = value;
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(REDUCE_MOTION_KEY, String(value));
		}
	}

	return {
		get reduceMotion() {
			return reduceMotion;
		},
		setReduceMotion,
	};
}

export const appPrefs = createAppPrefs();
