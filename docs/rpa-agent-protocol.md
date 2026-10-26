# Desktop automation agent protocol

Workflow Automation performs recorded steps through a desktop automation agent. Save its address and token in
Connections ("Desktop automation agent"). Until then the dashboard shows seeded demo workflows.

All requests carry `Authorization: Bearer <token>` and JSON bodies.

- `GET /health` -> `{ "ok": true, "version": "1.0" }`
- `POST /step` with `{ run, attempt, step: { kind, target, value, name } }` ->
  `{ ok, message, code?, screenshot? }`. `kind` is click, type, select, key, navigate or app.
  Use `code: "target-missing"` when the page layout changed. `screenshot` is a `data:image/png|jpeg|webp;base64,...` URL up to 200 KB.
- `GET /events?after=<cursor>` -> `{ events: [{ kind, target, value, page, app, at, field?, inputType?, screenshot? }], next }`
  (used by "Pull actions from the desktop agent" while recording).

Logins saved in Connections are available to steps as `{{login_user}}` and `{{login_password}}`.
Passwords typed while recording are never stored.
