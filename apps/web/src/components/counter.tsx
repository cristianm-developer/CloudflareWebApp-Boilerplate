import { useState } from 'preact/hooks';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button
      class="rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      onClick={() => setCount((value) => value + 1)}
    >
      Preact está activo · {count}
    </button>
  );
}
