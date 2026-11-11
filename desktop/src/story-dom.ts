// Use the shared DOM renderer unchanged inside Storybook's portable React harness.
import { createElement, useLayoutEffect, useRef } from 'react';
function Dom({element}: {element: HTMLElement}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {ref.current!.replaceChildren(element); return () => {element.remove();};}, [element]);
  return createElement('div', {ref});
}
export const domStory = (element: HTMLElement) => createElement(Dom, {element});
