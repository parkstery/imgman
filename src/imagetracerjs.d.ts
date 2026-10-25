declare module 'imagetracerjs' {
  interface ImagetracerJs {
    imagedataToSVG: (imgd: ImageData, options?: Record<string, unknown> | string) => string;
    optionpresets: Record<string, Record<string, unknown>>;
  }
  const instance: ImagetracerJs;
  export default instance;
}
