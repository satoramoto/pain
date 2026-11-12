// The setup screen still uses DOM; the shared Zen panel is already React.
import { createElement, isValidElement, useLayoutEffect, useRef, type ReactElement } from 'react';
function Dom({element}: {element: HTMLElement}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {ref.current!.replaceChildren(element); return () => {element.remove();};}, [element]);
  return createElement('div', {ref});
}
export const domStory = (element: HTMLElement | ReactElement) => isValidElement(element) ? element : createElement(Dom, {element: element as HTMLElement});
