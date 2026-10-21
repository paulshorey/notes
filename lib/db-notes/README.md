# Legacy deployment command adapter

The canonical backend is `@lib/db-items` in `lib/db-items`. This package only
forwards migration commands used by existing Railway deployment settings.
It contains no domain code. Remove it after every environment has adopted the
new pre-deploy command; no Railway settings are applied by this refactor.
