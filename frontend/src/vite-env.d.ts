/// <reference types="vite/client" />

declare module '*.jsx' {
  import type { ComponentType } from 'react';

  const Component: ComponentType<any>;
  export default Component;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}
