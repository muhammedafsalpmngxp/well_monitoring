# Alerts on answers

Watch an answer from **Ask your data** and get told when it needs attention. Needs the **Alerts** AI feature for your role (Settings → AI Features).

Works for answers on a dataset **and for Ask Data answers** (the answer's checked SQL is run again).

## Endpoints

| Method | Route | What it does |
|---|---|---|
| GET | `/api/ai/alerts` | Your alerts, newest first |
| GET | `/api/ai/alerts/options` | What the alert form may offer (see below) |
| POST | `/api/ai/alerts` | Watch an answer; the first check runs straight away and never notifies |
| POST | `/api/ai/alerts/{id}/check` | Check now; notifies if the alert starts firing |
| DELETE | `/api/ai/alerts/{id}` | Stop watching |

### Options

```json
{ "everyHours": [1, 24, 168], "defaultEveryHours": 24, "maxEmails": 10, "minHistory": 5 }
```

The form offers exactly these check intervals and e-mail limit; they are set by an admin in the server settings.

### Create

```json
{ "messageId": 518, "kind": "above", "threshold": 100, "everyHours": 24, "notifyEmails": "ops@company.com, lead@company.com" }
```

| `kind` | Fires when |
|---|---|
| `above` / `below` | The number (or any group's number) goes above / below `threshold` |
| `unusual` | A single number is far from its own past checks (after `minHistory` checks), or a group is far from the others |
| `change` | A single number moved by more than `threshold` percent since the last check (not for grouped answers) |

## Notifications

When an alert **starts** firing you get:
- a bell notification — clicking it opens the Ask AI panel on that alert;
- an e-mail to the alert's addresses (up to `maxEmails`), if any.

While it keeps firing nobody is notified again. The text is written by the AI in plain words, with the checked numbers always attached; if the AI is unavailable, the checked result alone is sent.

## Errors

`400` with a message for an unknown kind, a missing limit, a check interval that is not offered, too many or invalid e-mail addresses, change watching on a grouped answer, or an Ask Data answer whose steps are no longer kept (30 days). `404` when the answer is not yours.
