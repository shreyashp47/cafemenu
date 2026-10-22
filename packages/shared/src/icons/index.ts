/**
 * `@cafemenu/shared/icons`: the deploy-time icon generator. A separate entry
 * point from the package's main one, so the cafe app, which never draws
 * icons, never bundles it.
 */

export {
  appIcons,
  encodeIco,
  siteLogo,
  type IconFile,
  type IconOptions,
} from "./app-icons.ts";
export { GLYPHS, layoutMonogram } from "./glyphs.ts";
export {
  MAX_PNG_SIDE,
  PngError,
  decodePng,
  encodePng,
  isPng,
  type RgbaImage,
  type Zlib,
} from "./png.ts";
