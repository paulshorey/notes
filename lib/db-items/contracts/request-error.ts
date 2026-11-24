/**
 * A request the service refuses because of what it asks for: a missing field, a value
 * out of range, or a reference to something that is not there. Its message is written
 * for the caller and is answered as `400 invalid_request`.
 *
 * Any other error is a fault of the server. It is logged and answered without detail,
 * so throw this class, or a subclass, for everything a caller can correct.
 */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidRequestError"
  }
}
