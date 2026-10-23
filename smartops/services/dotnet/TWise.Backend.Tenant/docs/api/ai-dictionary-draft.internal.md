# Draft the data dictionary with AI: internal notes

## Flow

`GovernanceController.DraftDataset` → `DraftDictionaryCommand` (validator: kind import | view, id > 0) → `DraftDictionaryHandler`:
1. `IAiAskService.FeatureOnAsync(tenant, AiFeatureCatalog.Dictionary)` (key `dictionary`, granted per role under AI Features; not granted to anyone by default).
2. `IGovernanceService.GetDatasetAsync`: the columns with their current documentation; null → 404.
3. `IGovernanceService.SampleRowsAsync`: rows already stored, no query (imports: `core.ImportedDataRows` by row index; views: `PreviewDataJson`).
4. One `IAiService.CompleteAsync` call, purpose `dictionary` (AI usage and quota as every feature). System text = prompt `dictionary` + the reply format added by code; user text = dataset name/kind/description and one line per column: name | type | current business name and description | examples.
5. The reply is parsed (code fences allowed). Kept: the dataset's own columns only, first entry per column (case-insensitive), dataset spelling; sensitivity outside public/internal/confidential/pii becomes internal; text cut to the `core.DataDictionary` column sizes (200 / 2000 / 500).

Nothing is written. The page fills empty fields only and saves through the existing PUT.

## Privacy

Columns whose current sensitivity is `pii` or `confidential` send no example values ("not shown: marked …"). Examples are distinct, non-empty, cut to `SampleValueLength`, at most `SampleValues` per column.

## Settings: `AiDictionary` (appsettings.json, no defaults in code)

| Setting | Used for |
|---|---|
| `SampleRows` | Stored rows read for examples |
| `SampleValues` | Distinct examples per column sent |
| `SampleValueLength` | Longest example sent |
| `MaxColumns` | Columns drafted per request (the first ones) |

Read by `AiDictionaryOptions.From` through `RequiredSettings`; a missing value stops startup with its name.

## Prompt

`AiPrompts.Dictionary` = `dictionary`, in `AiPromptCatalog` (group "AI features") and `Resources/ai-prompts.seed.json`. A tenant gets it on the first prompt read after deployment (the prompt store seeds catalog keys it does not have), so no SQL script is needed.

## Frontend

`GovernanceService.draftDataset`; `DataDictionaryComponent.draft()` / `applyDraft()`; button shown when `ai.features()` includes `dictionary`; filled columns kept in `aiDrafted` (highlight + "AI draft" badge) until Save or another dataset is opened.

## Tests

`DictionaryDraftTests`: reply filtering (unknown, duplicate, case, bad sensitivity), examples (cut, distinct, none for pii, MaxColumns), feature off, unreadable reply, missing dataset, no columns, validator, settings without defaults.
