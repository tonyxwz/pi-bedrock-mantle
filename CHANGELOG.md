# Changelog

## [0.3.0]

### Added

- `bedrock_web_search` tool for models of other providers, which searches through a Mantle GPT
  model. Configure it with `webSearchTool`; Mantle's own GPT models do not get it.

### Changed

- Models outside the home Region keep their catalog name and add the Region, e.g.
  "GPT-6.2 Astra (us-east-1)".

## [0.2.0]

### Changed

- Region model lists no longer delay startup. Interactive pi reads them in the background and saves
  the resulting models in pi's model store; later starts, print mode and `--list-models` use the
  saved models.

## [0.1.0]

### Added

- `bedrock-mantle` provider for the OpenAI GPT models on Amazon Bedrock Mantle, signed with SigV4
  from the AWS credential chain.
- Server tools on every request, web search by default, configurable with `serverTools`.
- Web search calls kept across turns.
- Per-model Regions: `region`, `regions` and `models.<id>.region` settings.
