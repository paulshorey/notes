# Notes database migrations

Run the tracked Notes migration commands from the repository root. Follow the
[database management playbook](./management-playbook.md) for creating and
validating a migration, regenerating contracts, and handling a deployment.

Railway applies migrations in the app's pre-deploy step. Before a manual run,
verify that `DB_ITEMS_URL` points to the intended database. Use the
[backup and refresh guide](./backups.md) when moving data between environments.
