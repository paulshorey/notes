export class ItemGroupNotFoundError extends Error {
  constructor() {
    super("Workspace or category not found.")
  }
}

export class ItemGroupConflictError extends Error {
  constructor(message = "This group changed. Review its current contents before trying again.") {
    super(message)
  }
}
