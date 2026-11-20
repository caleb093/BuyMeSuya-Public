// Thrown by functions not included in the public version of this repo
export class PrivateImplementationError extends Error {
  constructor(functionName: string) {
    super(`${functionName}() is not included in the public version of this repository.`);
    this.name = "PrivateImplementationError";
  }
}
