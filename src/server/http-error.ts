export class HttpError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (message: string) => new HttpError(404, message);
export const badRequest = (message: string) => new HttpError(400, message);
export const conflict = (message: string) => new HttpError(409, message);
export const unavailable = (message: string) => new HttpError(503, message);
