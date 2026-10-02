/** Source-image safety cap, before decoding or resizing. */
export const MAX_BACKGROUND_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_BACKGROUND_IMAGE_BASE64_LENGTH =
  Math.ceil(MAX_BACKGROUND_IMAGE_BYTES / 3) * 4;
